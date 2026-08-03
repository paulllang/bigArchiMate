import {
   Action,
   ActionDispatcher,
   ClientSession,
   ClientSessionListener,
   ClientSessionManager,
   DisposableCollection,
   EditMode,
   GLSPServerError,
   Logger,
   MaybePromise,
   ModelSubmissionHandler,
   RequestModelAction,
   SOURCE_URI_ARG,
   SaveModelAction,
   SetEditModeAction,
   SourceModelStorage
} from '@eclipse-glsp/server';
import { inject, injectable, postConstruct } from 'inversify';
import { AstUtils } from 'langium';
import debounce from 'p-debounce';
import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { ArchiMateRoot } from '../../language-server/generated/ast.js';
import { AstArchiMateDocument } from '../../model-server/open-text-document-manager.js';
import { ArchiMateModelState } from './model-state.js';

/**
 * Model storage implementation that loads the model through the ModelService extension in our language services.
 * This way we ensure that during loading we get the latest up-to-date version from the central language storage and
 * any saved changes are properly synced back to it.
 */
@injectable()
export class ArchiMateModelStorage implements SourceModelStorage, ClientSessionListener {
   @inject(Logger) protected logger!: Logger;
   @inject(ArchiMateModelState) protected state!: ArchiMateModelState;
   @inject(ClientSessionManager) protected sessionManager!: ClientSessionManager;
   @inject(ModelSubmissionHandler) protected submissionHandler!: ModelSubmissionHandler;
   @inject(ActionDispatcher) protected actionDispatcher: ActionDispatcher;

   protected toDispose = new DisposableCollection();

   @postConstruct()
   protected init(): void {
      this.sessionManager.addListener(this, this.state.clientId);
   }

   async loadSourceModel(action: RequestModelAction): Promise<void> {
      // load semantic model from document in language model service
      const sourceUri = this.getSourceUri(action);
      // Theia passes fsPath, VS Code passes file:// URIs. Normalize either to a canonical URI string.
      const rootUri = sourceUri.startsWith('file:') ? URI.parse(sourceUri).toString() : URI.file(sourceUri).toString();
      const document = await this.update(rootUri);
      if (!document) {
         return;
      }
      this.toDispose.push(await this.state.modelService.open({ uri: rootUri, clientId: this.state.clientId }));
      this.toDispose.push(
         this.state.modelService.onModelUpdated(rootUri, async event => {
            if (this.state.clientId !== event.sourceClientId || event.reason !== 'changed') {
               // The event document is deliberately not forwarded - see updateAndSubmit.
               const result = await this.updateAndSubmit(rootUri);
               this.actionDispatcher.dispatchAll(result);
            }
         })
      );
   }

   protected async update(uri: string): Promise<AstArchiMateDocument | undefined> {
      const doc = await this.state.modelService.request(uri);
      if (doc) {
         this.state.setSemanticRoot(uri, doc.root);
         const actions = await this.updateEditMode(doc);
         if (actions.length > 0) {
            setTimeout(() => this.actionDispatcher.dispatchAll(actions), 0);
         }
      } else {
         this.logger.error('Could not find model for ' + uri);
      }
      return doc;
   }

   protected async updateEditMode(document: AstArchiMateDocument): Promise<Action[]> {
      const actions = [];
      const prevEditMode = this.state.editMode;
      this.state.editMode =
         document.diagnostics.filter(diagnostic => diagnostic.severity === DiagnosticSeverity.Error).length > 0
            ? EditMode.READONLY
            : EditMode.EDITABLE;
      if (prevEditMode !== this.state.editMode) {
         if (this.state.isReadonly) {
            actions.push(SetEditModeAction.create(EditMode.READONLY));
         } else {
            actions.push(SetEditModeAction.create(EditMode.EDITABLE));
         }
      }
      return actions;
   }

   protected updateAndSubmit = debounce(async (rootUri: string): Promise<Action[]> => {
      // Never swap the semantic root while an operation is mid-flight: handlers mutate it in place, so
      // replacing it here would discard whatever they have attached but not yet serialized.
      await this.state.whenOperationsSettled();
      // Read the current document rather than the snapshot the triggering event carried. That snapshot
      // is already stale by the debounce interval, and during a burst of operations it can be dozens of
      // revisions old - adopting it rolls the model back to a state predating everything written since.
      const document = await this.update(rootUri);
      if (!document) {
         return [];
      }
      return [...(await this.submissionHandler.submitModel('external')), ...(await this.updateEditMode(document))];
   }, 250);

   saveSourceModel(action: SaveModelAction): MaybePromise<void> {
      const saveUri = this.getFileUri(action);

      // save document and all related documents
      this.state.modelService.save({ uri: saveUri, model: this.state.semanticRoot, clientId: this.state.clientId });
      AstUtils.streamReferences(this.state.semanticRoot)
         .map(refInfo => refInfo.reference.ref)
         .nonNullable()
         .map(ref => AstUtils.findRootNode(ref) as ArchiMateRoot)
         .forEach(root =>
            this.state.modelService.save({ uri: root.$document!.uri.toString(), model: root, clientId: this.state.clientId })
         );
   }

   sessionDisposed(_clientSession: ClientSession): void {
      this.toDispose.dispose();
   }

   protected getSourceUri(action: RequestModelAction): string {
      const sourceUri = action.options?.[SOURCE_URI_ARG];
      if (typeof sourceUri !== 'string') {
         throw new GLSPServerError(`Invalid RequestModelAction! Missing argument with key '${SOURCE_URI_ARG}'`);
      }
      return sourceUri;
   }

   protected getFileUri(action: SaveModelAction): string {
      const uri = action.fileUri ?? this.state.get(SOURCE_URI_ARG);
      if (!uri) {
         throw new GLSPServerError('Could not derive fileUri for saving the current source model');
      }
      return uri;
   }
}
