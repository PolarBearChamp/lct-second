import type { AnyFamilyDefinition } from '../../types';
import { boundaryValuesFamily } from './boundary-values';
import { decisionTablesFamily } from './decision-tables';
import { minimalSuiteFamily } from './minimal-suite';
import { requirementDefectsFamily } from './requirement-defects';
import { severityPriorityFamily } from './severity-priority';
import { testCasesFamily } from './test-cases';

export const QA_FAMILIES: AnyFamilyDefinition[] = [
  requirementDefectsFamily,
  decisionTablesFamily,
  boundaryValuesFamily,
  minimalSuiteFamily,
  severityPriorityFamily,
  testCasesFamily,
];
