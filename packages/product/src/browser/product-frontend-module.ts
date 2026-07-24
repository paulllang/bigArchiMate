import { ApplicationShell, ApplicationShellOptions, FrontendApplication, WidgetFactory } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
   GettingStartedPreferenceContribution,
   GettingStartedPreferenceSchema
} from '@theia/getting-started/lib/common/getting-started-preferences';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { ThemeServiceWithDB } from '@theia/monaco/lib/browser/monaco-indexed-db';
import '../../style/custom-welcome-widget.css';
import { CustomWelcomeWidget } from './custom-welcome-widget';
import { CustomFrontendApplication } from './frontend-application';
import { ThemeService } from './theme-service';

const welcomeAlwaysSchema = {
   ...GettingStartedPreferenceSchema,
   properties: {
      ...GettingStartedPreferenceSchema.properties,
      'workbench.startupEditor': {
         ...GettingStartedPreferenceSchema.properties?.['workbench.startupEditor'],
         default: 'welcomePage'
      }
   }
};

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
   bind(ThemeService).toSelf().inSingletonScope();
   rebind(ThemeServiceWithDB).toService(ThemeService);

   rebind(FrontendApplication).to(CustomFrontendApplication).inSingletonScope();
   rebind(ApplicationShellOptions).toConstantValue(<ApplicationShell.Options>{
      bottomPanel: {
         initialSizeRatio: 0.25 // default: 0.382
      }
   });

   rebind(GettingStartedPreferenceContribution).toConstantValue({ schema: welcomeAlwaysSchema });

   bind(CustomWelcomeWidget).toSelf();

   bind(WidgetFactory)
      .toDynamicValue(ctx => ({
         id: GettingStartedWidget.ID,
         createWidget: () => ctx.container.get(CustomWelcomeWidget)
      }))
      .inSingletonScope();
});
