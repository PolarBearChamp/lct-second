import type { AnyFamilyDefinition } from '../../types';
import { confusionMetricsFamily } from './confusion-metrics';
import { imbalanceMetricsFamily } from './imbalance-metrics';
import { leakageFamily } from './leakage';
import { modelOpsFamily } from './model-ops';
import { pandasPrepFamily } from './pandas-prep';
import { validationSchemesFamily } from './validation-schemes';

export const ML_FAMILIES: AnyFamilyDefinition[] = [
  leakageFamily,
  pandasPrepFamily,
  confusionMetricsFamily,
  imbalanceMetricsFamily,
  validationSchemesFamily,
  modelOpsFamily,
];
