import {
   CloseModelArgs,
   CrossReference,
   CrossReferenceContext,
   ModelConflictError,
   ModelSavedEvent,
   ModelUpdatedEvent,
   OpenModelArgs,
   ReferenceableElement,
   SaveModelArgs,
   SystemInfo,
   SystemInfoArgs,
   SystemUpdatedEvent,
   UpdateModelArgs
} from '@big-archimate/protocol';
import { AstNode, Deferred, DocumentState, isAstNode } from 'langium';
import { Disposable, OptionalVersionedTextDocumentIdentifier, Range, TextDocumentEdit, TextEdit, uinteger } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI, Utils as UriUtils } from 'vscode-uri';
import { ArchiMateRoot, isArchiMateRoot } from '../language-server/generated/ast.js';
import { Services, SharedServices } from '../language-server/module.js';
import { PACKAGE_JSON } from '../language-server/package-manager.js';
import { findDocument } from '../language-server/util/ast-util.js';
import { AstArchiMateDocument } from './open-text-document-manager.js';
import { LANGUAGE_CLIENT_ID, OpenableTextDocuments } from './openable-text-documents.js';

/**
 * State of the server-to-language-client text channel for a single document.
 */
interface LanguageClientPush {
   /** Latest text waiting to be pushed. Undefined when nothing is queued. */
   queued?: string;
   /** Text of the last confirmed push, i.e. what the language client is believed to hold. */
   applied?: string;
   /** True while a drain loop is running for this document. */
   draining: boolean;
}

/**
 * The model service serves as a facade to access and update semantic models from the language server as a non-LSP client.
 * It provides a simple open-request-update-save/close lifecycle for documents and their semantic model.
 */
export class ModelService {
   /** Per-document state of the serialized text channel to the language client, keyed by normalized URI. */
   protected languageClientPushes = new Map<string, LanguageClientPush>();

   constructor(
      protected shared: SharedServices,
      protected documentManager = shared.workspace.TextDocumentManager,
      protected documents = shared.workspace.LangiumDocuments,
      protected documentBuilder = shared.workspace.DocumentBuilder,
      protected fileSystemProvider = shared.workspace.FileSystemProvider,
      // explicitly typed: on the intersected shared services the inherited signatures would win
      // and hide the per-client events this service relies on
      protected textDocuments: OpenableTextDocuments<TextDocument> = shared.workspace.TextDocuments
   ) {
      // sync updates with language client
      this.documentBuilder.onBuildPhase(DocumentState.Validated, (allChangedDocuments, _token) => {
         for (const changedDocument of allChangedDocuments) {
            const sourceClientId = this.documentManager.getSourceClientId(changedDocument, allChangedDocuments);
            if (sourceClientId === LANGUAGE_CLIENT_ID) {
               continue;
            }
            const textDocument = changedDocument.textDocument;
            if (this.documentManager.isOpenInLanguageClient(textDocument.uri)) {
               // we only want to apply a text edit if the editor is already open
               // because opening and updating at the same time might cause problems as the open call resets the document to filesystem
               this.queueLanguageClientPush(textDocument.uri, textDocument.getText());
            }
         }
      });

      // An edit authored by the language client itself means we no longer know what it holds.
      this.textDocuments.onDidChangeContent(event => {
         if (event.clientId !== LANGUAGE_CLIENT_ID) {
            return;
         }
         const push = this.languageClientPushes.get(this.normalizedUri(event.document.uri));
         if (push && event.document.getText() !== push.applied) {
            // Not the echo of one of our own pushes but a genuine client-side edit,
            // so the next push must go out unconditionally.
            push.applied = undefined;
         }
      });

      // Once the language client drops the document we know nothing about its buffer anymore.
      this.textDocuments.onDidClose(event => {
         if (event.clientId === LANGUAGE_CLIENT_ID) {
            this.languageClientPushes.delete(this.normalizedUri(event.document.uri));
         }
      });
   }

   /**
    * Queues a full-document text update for the language client.
    *
    * Pushes are serialized per document and coalesced: while a `workspace/applyEdit` is in flight, any further
    * update only replaces the queued text. A burst of n updates therefore produces one edit per completed
    * round-trip instead of n concurrent ones. Firing them concurrently lets the client apply our replaces
    * against a buffer state they were not computed against, which corrupts that buffer - and since the client
    * echoes its content back as the new truth, the corruption reaches the document store and the file.
    */
   protected queueLanguageClientPush(uri: string, text: string): void {
      const key = this.normalizedUri(uri);
      let push = this.languageClientPushes.get(key);
      if (!push) {
         push = { draining: false };
         this.languageClientPushes.set(key, push);
      }
      if (text === push.applied) {
         // The client already holds this text. A build reports a document as changed even when only one of its
         // dependencies changed, so pushing here would just manufacture a spurious client-side edit.
         return;
      }
      push.queued = text;
      if (!push.draining) {
         push.draining = true;
         // Deliberately not awaited: the build phase must not block on client round-trips.
         this.drainLanguageClientPushes(uri, push).catch(error =>
            this.shared.logger.ClientLogger.error(`Text sync for '${uri}' stopped unexpectedly: ${error}`)
         );
      }
   }

   /** Sends queued texts for a document one after the other until the queue is empty. */
   protected async drainLanguageClientPushes(uri: string, push: LanguageClientPush): Promise<void> {
      try {
         while (push.queued !== undefined) {
            const text = push.queued;
            push.queued = undefined;
            // Only remember the text once the client confirmed it, otherwise the next push must be unconditional.
            push.applied = (await this.applyEditToLanguageClient(uri, text)) ? text : undefined;
         }
      } finally {
         push.draining = false;
      }
   }

   /** Replaces the whole document in the language client. Resolves to true if the client applied the edit. */
   protected async applyEditToLanguageClient(uri: string, text: string): Promise<boolean> {
      const connection = this.shared.lsp.Connection;
      if (!connection) {
         return false;
      }
      // Register the text before sending it, so the store can recognise the echo that comes back
      // instead of mistaking it for a genuine client-side edit and writing it over newer content.
      this.textDocuments.stagePushedContent(uri, text);
      try {
         const result = await connection.workspace.applyEdit({
            label: 'Update Model',
            documentChanges: [
               // we use a null version to indicate that the version is known
               // eslint-disable-next-line no-null/no-null
               TextDocumentEdit.create(OptionalVersionedTextDocumentIdentifier.create(uri, null), [
                  TextEdit.replace(Range.create(0, 0, uinteger.MAX_VALUE, uinteger.MAX_VALUE), text)
               ])
            ]
         });
         return result.applied;
      } catch (error: unknown) {
         this.shared.logger.ClientLogger.error(`Could not update '${uri}' in the language client: ${error}`);
         return false;
      }
   }

   /**
    * Opens the document with the given URI for modification.
    *
    * @param uri document URI
    */
   async open(args: OpenModelArgs): Promise<Disposable> {
      return this.documentManager.open(args);
   }

   isOpen(uri: string): boolean {
      return this.documentManager.isOpen(uri);
   }

   /**
    * Current version of the document with the given URI, or undefined if it is not open.
    * Callers pass this back as `baseVersion` on a later update to detect intervening writes.
    */
   version(uri: string): number | undefined {
      return this.textDocuments.get(this.normalizedUri(uri))?.version;
   }

   /**
    * Closes the document with the given URI for modification.
    *
    * @param uri document URI
    */
   async close(args: CloseModelArgs): Promise<void> {
      if (this.documentManager.isOnlyOpenInClient(args.uri, args.clientId)) {
         // we need to restore the original state without any unsaved changes
         await this.update({ ...args, model: await this.documentManager.readFile(args.uri) });
      }
      return this.documentManager.close(args);
   }

   /**
    * Waits until the document with the given URI has reached the given state.
    * @param state minimum state the document should have before returning
    * @param uri document URI
    */
   async ready(state = DocumentState.Validated, uri?: string): Promise<void> {
      await this.documentBuilder.waitUntil(state, uri ? URI.parse(uri) : undefined);
   }

   /**
    * Requests the semantic model stored in the document with the given URI.
    * If the document was not already open for modification, it will be opened automatically.
    *
    * @param uri document URI
    * @param state minimum state the document should have before returning
    */
   async request(uri: string, state = DocumentState.Validated): Promise<AstArchiMateDocument | undefined> {
      const documentUri = URI.parse(uri);
      await this.documentBuilder.waitUntil(state, documentUri);
      const document = await this.documents.getOrCreateDocument(documentUri);
      const root = document.parseResult.value;
      return isArchiMateRoot(root) ? { root, diagnostics: document.diagnostics ?? [], uri } : undefined;
   }

   /**
    * Updates the semantic model stored in the document with the given model or textual representation of a model.
    * Any previous content will be overridden.
    * If the document was not already open for modification, it will be opened automatically.
    *
    * @param uri document URI
    * @param model semantic model or textual representation of it
    * @returns the stored semantic model
    */
   async update(args: UpdateModelArgs<ArchiMateRoot>): Promise<AstArchiMateDocument> {
      await this.open(args);
      const documentUri = URI.parse(args.uri);
      const document = await this.documents.getOrCreateDocument(documentUri);
      const root = document.parseResult.value;
      if (!isAstNode(root)) {
         throw new Error(`No AST node to update exists in '${args.uri}'`);
      }
      const textDocument = document.textDocument;
      if (args.baseVersion !== undefined && textDocument.version !== args.baseVersion) {
         // Someone else wrote while the caller was preparing this update, so applying it blindly would
         // discard their change. The caller decides what to do about it.
         throw new ModelConflictError(args.uri, args.baseVersion, textDocument.version);
      }
      const text = typeof args.model === 'string' ? args.model : this.serialize(documentUri, args.model);
      if (text === textDocument.getText()) {
         return {
            diagnostics: document.diagnostics ?? [],
            root: document.parseResult.value as ArchiMateRoot,
            uri: args.uri
         };
      }
      const newVersion = textDocument.version + 1;
      const pendingUpdate = new Deferred<AstArchiMateDocument>();
      const listener = this.documentBuilder.onBuildPhase(DocumentState.Validated, (allChangedDocuments, _token) => {
         // `>=` rather than `===`: another client may legitimately write while we wait (a user typing in
         // the text editor), which advances the shared version past ours. Our text is already in the
         // store by then, so any validated build at or beyond our version means the update went through.
         const updatedDocument = allChangedDocuments.find(
            doc => doc.uri.toString() === documentUri.toString() && doc.textDocument.version >= newVersion
         );
         if (updatedDocument) {
            pendingUpdate.resolve({
               diagnostics: updatedDocument.diagnostics ?? [],
               root: updatedDocument.parseResult.value as ArchiMateRoot,
               uri: args.uri
            });
            listener.dispose();
         }
      });
      const timeout = new Promise<AstArchiMateDocument>((_, reject) =>
         setTimeout(() => {
            listener.dispose();
            reject('Update timed out.');
         }, 5000)
      );
      this.documentManager.update(args.uri, newVersion, text, args.clientId);
      return Promise.race([pendingUpdate.promise, timeout]);
   }

   onModelUpdated(uri: string, listener: (model: ModelUpdatedEvent<AstArchiMateDocument>) => void): Disposable {
      return this.documentManager.onUpdate(uri, listener);
   }

   onModelSaved(uri: string, listener: (model: ModelSavedEvent<AstArchiMateDocument>) => void): Disposable {
      return this.documentManager.onSave(uri, listener);
   }

   /**
    * Overrides the document with the given URI with the given semantic model or text.
    *
    * @param uri document uri
    * @param model semantic model or text
    */
   async save(args: SaveModelArgs<ArchiMateRoot>): Promise<void> {
      // sync: implicit update of internal data structure to match file system (similar to workspace initialization)
      const text = typeof args.model === 'string' ? args.model : this.serialize(URI.parse(args.uri), args.model);
      if (this.documents.hasDocument(URI.parse(args.uri))) {
         await this.update(args);
      } else {
         this.documents.createDocument(URI.parse(args.uri), text);
      }
      return this.documentManager.save(args.uri, text, args.clientId);
   }

   /**
    * Serializes the given semantic model by using the serializer service for the corresponding language.
    *
    * @param uri document uri
    * @param model semantic model
    */
   protected serialize(uri: URI, model: AstNode): string {
      const serializer = this.shared.ServiceRegistry.getServices(uri).serializer.Serializer;
      return serializer.serialize(model);
   }

   /** Canonical key for a document URI, so the same document is never tracked under two spellings. */
   protected normalizedUri(uri: string): string {
      return URI.parse(uri).toString();
   }

   getId(node: AstNode, uri = findDocument(node)?.uri): string | undefined {
      if (uri) {
         const services = this.shared.ServiceRegistry.getServices(uri) as Services;
         return services.references.IdProvider.getLocalId(node);
      }
      return undefined;
   }

   getGlobalId(node: AstNode, uri = findDocument(node)?.uri): string | undefined {
      if (uri) {
         const services = this.shared.ServiceRegistry.getServices(uri) as Services;
         return services.references.IdProvider.getGlobalId(node);
      }
      return undefined;
   }

   async findReferenceableElements(args: CrossReferenceContext): Promise<ReferenceableElement[]> {
      return this.shared.ServiceRegistry.services.references.ScopeProvider.complete(args);
   }

   async resolveCrossReference(args: CrossReference): Promise<AstNode | undefined> {
      return this.shared.ServiceRegistry.services.references.ScopeProvider.resolveCrossReference(args);
   }

   async getSystemInfos(): Promise<SystemInfo[]> {
      return this.shared.workspace.PackageManager.getPackageInfos().map(info =>
         this.shared.workspace.PackageManager.convertPackageInfoToSystemInfo(info)
      );
   }

   async getSystemInfo(args: SystemInfoArgs): Promise<SystemInfo | undefined> {
      const contextUri = URI.parse(args.contextUri);
      const packageInfo =
         this.shared.workspace.PackageManager.getPackageInfoByURI(contextUri) ??
         this.shared.workspace.PackageManager.getPackageInfoByURI(UriUtils.joinPath(contextUri, PACKAGE_JSON));
      if (!packageInfo) {
         return undefined;
      }
      return this.shared.workspace.PackageManager.convertPackageInfoToSystemInfo(packageInfo);
   }

   onSystemUpdated(listener: (event: SystemUpdatedEvent) => void): Disposable {
      return this.shared.workspace.PackageManager.onUpdate(listener);
   }
}
