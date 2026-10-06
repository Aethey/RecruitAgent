import { t } from './i18n.js';
const categories = {algorithm:'ui.algorithmKnowledge',language:'ui.languagePatterns',concept:'ui.conceptsAndMethods',tools:'ui.engineeringToolsAndCLI',expression:'ui.focusedExpression'};
const domains = {patterns:'ui.designPatterns',architecture:'ui.architectureAndSystemDesign',workflow:'ui.developmentMethodsAndDelivery',flutter:'ui.flutterDartEngineering',jvm:'study.jvmDomain',apple:'ui.swiftAppleEngineering',web:'ui.webFrontendEngineering',backend:'ui.backendDataEngineering',cloud:'ui.cloudInfrastructure',quality:'ui.testingObservability'};

/** A quiz heading is interface text; its saved title and answers remain unchanged. */
export function studyTitle(batch) {
  const selection = batch.selection;
  const scope = selection?.breadth
    ? selection.breadth.domain === 'all' ? t('study.scopeBreadthAll') : t('study.scopeBreadth',{domain:t(domains[selection.breadth.domain])})
    : !selection || selection.category === 'all' ? t('study.scopeAll') : t('study.scopeCategory',{category:t(categories[selection.category])});
  return t('study.batchTitle',{scope,count:batch.items?.length ?? batch.total ?? 0});
}
