import { ModelConflictError } from '@big-archimate/protocol';
import { DefaultModelState, JsonModelState, ModelState, hasFunctionProp } from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { DocumentState } from 'langium';
import { URI } from 'vscode-uri';
import { LSPServices } from '../../integration.js';
import { ArchiMateRoot, Diagram } from '../../language-server/generated/ast.js';
import { IdProvider } from '../../language-server/id-provider.js';
import { ModelSerializer } from '../../model-server/model-serializer.js';
import { ModelService } from '../../model-server/model-service.js';
import { AstArchiMateDocument } from '../../model-server/open-text-document-manager.js';
import { ArchiMateGModelIndex } from './gmodel-index.js';

export interface SourceModel {
   text: string;
}

/**
 * Custom model state that does not only keep track of the GModel root but also the semantic root.
 * It also provides convenience methods for accessing specific language services.
 */
@injectable()
export class ArchiMateModelState extends DefaultModelState implements JsonModelState<SourceModel> {
   @inject(ArchiMateGModelIndex) override readonly index: ArchiMateGModelIndex;
   @inject(LSPServices) readonly services!: LSPServices;

   protected _semanticUri!: string;
   protected _semanticRoot!: ArchiMateRoot;
   protected _packageId!: string;

   /** Document version the current semantic root was read at, used as the base for the next write. */
   protected _baseVersion?: number;

   /** Number of model-mutating operations currently executing. */
   protected runningOperations = 0;
   protected operationWaiters: (() => void)[] = [];

   setSemanticRoot(uri: string, semanticRoot: ArchiMateRoot): void {
      this._semanticUri = uri;
      this._semanticRoot = semanticRoot;
      this._packageId = this.services.shared.workspace.PackageManager.getPackageIdByUri(URI.parse(uri));
      this._baseVersion = this.modelService.version(uri);
      this.index.indexSemanticRoot(this.semanticRoot);
   }

   /**
    * Runs a model-mutating operation, keeping external model reloads out of the way for its duration.
    *
    * Operation handlers mutate the semantic root in place, so a reload replacing that root mid-flight
    * silently discards whatever the handler had already attached to the old one.
    */
   async runOperation<T>(operation: () => Promise<T>): Promise<T> {
      this.runningOperations++;
      try {
         return await operation();
      } finally {
         this.runningOperations--;
         if (this.runningOperations === 0) {
            const waiters = this.operationWaiters;
            this.operationWaiters = [];
            waiters.forEach(resolve => resolve());
         }
      }
   }

   /** Resolves once no model-mutating operation is executing. */
   whenOperationsSettled(): Promise<void> {
      if (this.runningOperations === 0) {
         return Promise.resolve();
      }
      return new Promise<void>(resolve => this.operationWaiters.push(resolve));
   }

   get semanticUri(): string {
      return this._semanticUri;
   }

   get semanticRoot(): ArchiMateRoot {
      return this._semanticRoot;
   }

   get packageId(): string {
      return this._packageId;
   }

   get modelService(): ModelService {
      return this.services.shared.model.ModelService;
   }

   get semanticSerializer(): ModelSerializer<ArchiMateRoot> {
      return this.services.language.serializer.Serializer;
   }

   get idProvider(): IdProvider {
      return this.services.language.references.IdProvider;
   }

   get sourceModel(): SourceModel {
      return { text: this.semanticText() };
   }

   get diagram(): Diagram {
      return this.semanticRoot.diagram!;
   }

   async updateSourceModel(sourceModel: SourceModel): Promise<void> {
      const model = sourceModel.text ?? this.semanticRoot;
      let document: AstArchiMateDocument;
      try {
         document = await this.modelService.update({
            uri: this.semanticUri,
            model,
            clientId: this.clientId,
            baseVersion: this._baseVersion
         });
      } catch (error: unknown) {
         if (!ModelConflictError.is(error)) {
            throw error;
         }
         // Last-writer-wins for now: our source model is whole-document text, so there is nothing to
         // merge field-wise. Logged rather than silent so a lost concurrent edit is at least visible.
         this.services.shared.logger.ClientLogger.warn(
            `${error.message}. Overwriting with the diagram state - a concurrent text edit may be lost.`
         );
         document = await this.modelService.update({ uri: this.semanticUri, model, clientId: this.clientId });
      }
      this._semanticRoot = document.root;
      this._baseVersion = this.modelService.version(this.semanticUri);
      this.index.indexSemanticRoot(this.semanticRoot);
   }

   /** Textual representation of the current semantic root. */
   semanticText(): string {
      return this.services.language.serializer.Serializer.serialize(this.semanticRoot);
   }

   ready(state = DocumentState.Validated): Promise<void> {
      return this.modelService.ready(state, this.semanticUri);
   }
}

export namespace ArchiMateModelState {
   export function is(modelState: ModelState): modelState is ArchiMateModelState {
      return JsonModelState.is(modelState) && hasFunctionProp(modelState, 'setSemanticRoot');
   }
}
