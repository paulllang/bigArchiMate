/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation and EclipseSource. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
// eslint-disable-next-line header/header
import { NormalizedTextDocuments } from 'langium/lsp';
import { basename } from 'path';
import {
   CancellationToken,
   DidChangeTextDocumentParams,
   DidCloseTextDocumentParams,
   DidOpenTextDocumentParams,
   DidSaveTextDocumentParams,
   Disposable,
   Emitter,
   Event,
   HandlerResult,
   RequestHandler,
   TextDocumentChangeEvent,
   TextDocumentsConfiguration,
   TextDocumentSyncKind,
   TextDocumentWillSaveEvent,
   TextEdit,
   WillSaveTextDocumentParams
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { SharedServices } from '../language-server/module.js';

export const LANGUAGE_CLIENT_ID = 'language-client';

/**
 * Upper bound on remembered pushes per document. Echoes normally come back within milliseconds and
 * consume their entry; a queue this deep means the client stopped echoing, so drop instead of leaking.
 */
const PENDING_PUSH_CAP = 32;

/**
 * Cheap, stable, non-cryptographic content hash (cyrb53). It only has to make an accidental match
 * between two different revisions of the same document practically impossible, which 53 well-mixed
 * bits achieve without pulling in `node:crypto`.
 */
function contentHash(text: string): string {
   let h1 = 0xdeadbeef;
   let h2 = 0x41c6ce57;
   for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
   }
   h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
   h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
   return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}:${text.length}`;
}

export interface ClientTextDocumentChangeEvent<T> extends TextDocumentChangeEvent<T> {
   clientId: string;
}

/**
 * This subclass of `TextDocuments` supports multiple clients to open the same document and sync their state.
 */
export class OpenableTextDocuments<T extends TextDocument> extends NormalizedTextDocuments<T> {
   protected __clientDocuments = new Map<string, Set<string>>();
   protected __changeHistory = new Map<string, string[]>();

   /**
    * Last version id each client declared for a document, per URI and client id.
    *
    * Version ids on the wire are owned by the client - Monaco numbers its own buffer and knows nothing
    * about writes the model service makes. They therefore only ever serve as a per-client staleness
    * guard and never feed the shared version sequence, which the server assigns and which routinely
    * runs ahead of any client's ids. Comparing an incoming id against the shared version instead drops
    * genuine edits for as long as the server is ahead.
    */
   protected __clientVersions = new Map<string, Map<string, number>>();

   /**
    * Content hashes of texts pushed to the language client whose echo has not come back yet, per URI.
    *
    * Pushes and their echoes are uncorrelated on the wire, so an echo of push N can arrive after the
    * store already holds push N+1. Such an echo differs from the current content but provably equals
    * one of our own pushes, so it must be consumed rather than written over newer content.
    */
   protected __pendingPushHashes = new Map<string, string[]>();

   public constructor(
      protected configuration: TextDocumentsConfiguration<T>,
      protected services: SharedServices,
      protected logger = services.logger.ClientLogger
   ) {
      super(configuration);
   }

   protected get __syncedDocuments(): Map<string, T> {
      return this['_syncedDocuments'];
   }

   protected get __onDidChangeContent(): Emitter<ClientTextDocumentChangeEvent<T>> {
      return this['_onDidChangeContent'];
   }

   override get onDidChangeContent(): Event<ClientTextDocumentChangeEvent<T>> {
      return this.__onDidChangeContent.event;
   }

   protected get __onDidOpen(): Emitter<ClientTextDocumentChangeEvent<T>> {
      return this['_onDidOpen'];
   }

   override get onDidOpen(): Event<ClientTextDocumentChangeEvent<T>> {
      return this.__onDidOpen.event;
   }

   protected get __onDidClose(): Emitter<ClientTextDocumentChangeEvent<T>> {
      return this['_onDidClose'];
   }

   override get onDidClose(): Event<ClientTextDocumentChangeEvent<T>> {
      return this.__onDidClose.event;
   }

   protected get __onDidSave(): Emitter<ClientTextDocumentChangeEvent<T>> {
      return this['_onDidSave'];
   }

   override get onDidSave(): Event<ClientTextDocumentChangeEvent<T>> {
      return this['__onDidSave'].event;
   }

   protected get __onWillSave(): Emitter<TextDocumentWillSaveEvent<T>> {
      return this['_onWillSave'];
   }

   protected get __willSaveWaitUntil(): RequestHandler<TextDocumentWillSaveEvent<T>, TextEdit[], void> | undefined {
      return this['_willSaveWaitUntil'];
   }

   public override listen(connection: any): Disposable {
      (<any>connection).__textDocumentSync = TextDocumentSyncKind.Incremental;
      const disposables: Disposable[] = [];
      disposables.push(
         connection.onDidOpenTextDocument(async (event: DidOpenTextDocumentParams) => {
            await this.services.workspace.WorkspaceManager.workspaceInitialized;
            this.notifyDidOpenTextDocument(event);
         })
      );
      disposables.push(
         connection.onDidChangeTextDocument((event: DidChangeTextDocumentParams) => {
            this.notifyDidChangeTextDocument(event);
         })
      );
      disposables.push(
         connection.onDidCloseTextDocument((event: DidCloseTextDocumentParams) => {
            this.notifyDidCloseTextDocument(event);
         })
      );
      disposables.push(
         connection.onWillSaveTextDocument((event: WillSaveTextDocumentParams) => {
            this.notifyWillSaveTextDocument(event);
         })
      );
      disposables.push(
         connection.onWillSaveTextDocumentWaitUntil((event: WillSaveTextDocumentParams, token: CancellationToken) =>
            this.notifyWillSaveTextDocumentWaitUntil(event, token)
         )
      );
      disposables.push(
         connection.onDidSaveTextDocument((event: DidSaveTextDocumentParams) => {
            this.notifyDidSaveTextDocument(event);
         })
      );
      return Disposable.create(() => {
         disposables.forEach(disposable => disposable.dispose());
      });
   }

   public notifyDidChangeTextDocument(event: DidChangeTextDocumentParams, clientId = LANGUAGE_CLIENT_ID): void {
      const td = event.textDocument;
      const changes = event.contentChanges;
      if (changes.length === 0) {
         return;
      }

      const { version } = td;
      // eslint-disable-next-line no-null/no-null
      if (version === null || version === undefined) {
         throw new Error(`Received document change event for ${td.uri} without valid version identifier`);
      }

      let document = this.__syncedDocuments.get(td.uri);
      if (document === undefined) {
         return;
      }

      // Staleness is judged per client, against the last id THAT client declared. See __clientVersions.
      // A client that never opened the document (a protocol anomaly) falls back to the shared version.
      const clientVersions = this.clientVersionsFor(td.uri);
      const lastSeen = clientVersions.get(clientId) ?? document.version;
      if (lastSeen >= td.version) {
         this.log(document.uri, `Update is out of date (${lastSeen} >= ${td.version}): Ignore update by ${clientId}`);
         return;
      }
      clientVersions.set(clientId, td.version);

      // The shared version is server-assigned and advances only when the content really changes, so it
      // stays a meaningful content revision number independent of any client's buffer numbering.
      // Note that `configuration.update` mutates the document in place, so the changes have to be
      // applied to learn the resulting text and then rolled back if this update turns out to be a
      // no-op. Leaving a bumped version behind would break callers waiting for a specific version.
      const previousText = document.getText();
      const sharedVersion = document.version;
      document = this.configuration.update(document, changes, sharedVersion + 1);
      const newText = document.getText();

      if (clientId === LANGUAGE_CLIENT_ID) {
         const pending = this.__pendingPushHashes.get(td.uri);
         if (pending && pending.length > 0) {
            const matchIndex = pending.indexOf(contentHash(newText));
            if (matchIndex >= 0) {
               // Echo of one of our own pushes, possibly one that has since been superseded. Consume it
               // together with every older entry it supersedes, and undo the content and version bump.
               pending.splice(0, matchIndex + 1);
               document = this.configuration.update(document, [{ text: previousText }], sharedVersion);
               this.__syncedDocuments.set(td.uri, document);
               this.log(document.uri, `Ignore echo of pushed content by ${clientId} (client version ${td.version})`);
               return;
            }
            // The buffer diverged from every text we pushed, so no outstanding echo can match again.
            pending.length = 0;
         }
      }

      if (newText === previousText) {
         // Content is identical, so only the version needs rolling back.
         document = this.configuration.update(document, [], sharedVersion);
         this.__syncedDocuments.set(td.uri, document);
         this.log(document.uri, `Ignore update by ${clientId}: content unchanged (client version ${td.version})`);
         return;
      }

      this.__syncedDocuments.set(td.uri, document);
      const changeHistory = this.__changeHistory.get(td.uri) || [];
      changeHistory[document.version] = clientId;
      this.__changeHistory.set(td.uri, changeHistory);
      this.log(document.uri, `Update to version ${document.version} by ${clientId}`);
      this.__onDidChangeContent.fire(Object.freeze({ document, clientId }));
   }

   /**
    * Records a text pushed to the language client so that its echo can be told apart from a genuine
    * client-side edit. Called by the writer that owns the `workspace/applyEdit` channel.
    */
   stagePushedContent(uri: string, text: string): void {
      const key = URI.parse(uri).toString();
      const pending = this.__pendingPushHashes.get(key) ?? [];
      pending.push(contentHash(text));
      while (pending.length > PENDING_PUSH_CAP) {
         pending.shift();
      }
      this.__pendingPushHashes.set(key, pending);
   }

   protected clientVersionsFor(uri: string): Map<string, number> {
      let versions = this.__clientVersions.get(uri);
      if (!versions) {
         versions = new Map();
         this.__clientVersions.set(uri, versions);
      }
      return versions;
   }

   public notifyDidCloseTextDocument(event: DidCloseTextDocumentParams, clientId = LANGUAGE_CLIENT_ID): void {
      if (!this.isOpenInClient(event.textDocument.uri, clientId)) {
         return;
      }
      this.__clientDocuments.get(event.textDocument.uri)?.delete(clientId);
      this.__clientVersions.get(event.textDocument.uri)?.delete(clientId);
      if (clientId === LANGUAGE_CLIENT_ID) {
         // No client left to echo our pushes, so any outstanding entry can never be consumed.
         this.__pendingPushHashes.delete(event.textDocument.uri);
      }
      const syncedDocument = this.__syncedDocuments.get(event.textDocument.uri);
      if (syncedDocument !== undefined) {
         this.log(syncedDocument.uri, `Closed synced document: ${syncedDocument.version} by ${clientId}`);
         this.__onDidClose.fire(Object.freeze({ document: syncedDocument, clientId }));

         if (!this.__clientDocuments.get(event.textDocument.uri)?.size) {
            // last client closed the document, delete sync state
            this.log(syncedDocument.uri, `Remove synced document: ${syncedDocument.version} (no client left)`);
            this.__syncedDocuments.delete(event.textDocument.uri);
            this.__changeHistory.delete(event.textDocument.uri);
            this.__clientVersions.delete(event.textDocument.uri);
            this.__pendingPushHashes.delete(event.textDocument.uri);
         }
      }
   }

   public notifyWillSaveTextDocument(event: WillSaveTextDocumentParams): void {
      const syncedDocument = this.__syncedDocuments.get(event.textDocument.uri);
      if (syncedDocument !== undefined) {
         this.__onWillSave.fire(Object.freeze({ document: syncedDocument, reason: event.reason }));
      }
   }

   public notifyWillSaveTextDocumentWaitUntil(
      event: WillSaveTextDocumentParams,
      token: CancellationToken
   ): HandlerResult<TextEdit[], void> {
      const syncedDocument = this.__syncedDocuments.get(event.textDocument.uri);
      if (syncedDocument !== undefined && this.__willSaveWaitUntil) {
         return this.__willSaveWaitUntil(Object.freeze({ document: syncedDocument, reason: event.reason }), token);
      } else {
         return [];
      }
   }

   public notifyDidSaveTextDocument(event: DidSaveTextDocumentParams, clientId = LANGUAGE_CLIENT_ID): void {
      const syncedDocument = this.__syncedDocuments.get(event.textDocument.uri);
      if (syncedDocument !== undefined) {
         this.log(syncedDocument.uri, `Saved synced document: ${syncedDocument.version} by ${clientId}`);
         this.__onDidSave.fire(Object.freeze({ document: syncedDocument, clientId }));
      }
   }

   public notifyDidOpenTextDocument(event: DidOpenTextDocumentParams, clientId = LANGUAGE_CLIENT_ID): void {
      if (this.isOpenInClient(event.textDocument.uri, clientId)) {
         return;
      }
      const td = event.textDocument;
      let document = this.__syncedDocuments.get(td.uri);
      const clients = this.__clientDocuments.get(td.uri) || new Set();
      clients.add(clientId);
      this.__clientDocuments.set(td.uri, clients);
      // Baseline for this client's staleness guard: everything it declares from here on must be newer.
      this.clientVersionsFor(td.uri).set(clientId, td.version);
      if (!document) {
         // no synced document yet, create new one
         this.log(td.uri, `Opened new document: ${td.version} by ${clientId}`);
         document = this.configuration.create(td.uri, td.languageId, td.version, td.text);
         this.__syncedDocuments.set(td.uri, document);
         this.__changeHistory.set(td.uri, [clientId]);
         const toFire = Object.freeze({ document, clientId });
         this.__onDidOpen.fire(toFire);
         this.__onDidChangeContent.fire(toFire);
      } else {
         // document was already synced, so we just change a content change
         this.log(td.uri, `Opened synced document: ${td.version} by ${clientId}`);
         const toFire = Object.freeze({ document, clientId });
         this.__onDidChangeContent.fire(toFire);
      }
   }

   getChangeSource(uri: string, version?: number): string | undefined {
      const history = this.__changeHistory.get(uri);
      // given version or last entry
      return version ? history?.[version] : history?.at(-1);
   }

   isOpen(uri: string): boolean {
      return this.__syncedDocuments.has(uri);
   }

   isOpenInClient(uri: string, client: string): boolean {
      return !!this.__clientDocuments.get(uri)?.has(client);
   }

   isOpenInLanguageClient(uri: string): boolean {
      return this.isOpenInClient(uri, LANGUAGE_CLIENT_ID);
   }

   isOnlyOpenInClient(uri: string, client: string): boolean {
      return this.__clientDocuments.get(uri)?.size === 1 && this.isOpenInClient(uri, client);
   }

   protected log(uri: string, message: string): void {
      const full = URI.parse(uri);
      this.logger.info(`[Documents][${basename(full.fsPath)}] ${message}`);
   }
}
