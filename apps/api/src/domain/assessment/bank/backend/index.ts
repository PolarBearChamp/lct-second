import type { AnyFamilyDefinition } from '../../types';
import { dataModelingFamily } from './data-modeling';
import { httpSemanticsFamily } from './http-semantics';
import { idempotencyFamily } from './idempotency';
import { reliabilityPatternsFamily } from './reliability-patterns';
import { sqlQueryResultFamily } from './sql-query-result';
import { txIsolationFamily } from './tx-isolation';

export const BACKEND_FAMILIES: AnyFamilyDefinition[] = [
  httpSemanticsFamily,
  idempotencyFamily,
  sqlQueryResultFamily,
  dataModelingFamily,
  txIsolationFamily,
  reliabilityPatternsFamily,
];
