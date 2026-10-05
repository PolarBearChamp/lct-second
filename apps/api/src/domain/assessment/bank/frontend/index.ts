import type { AnyFamilyDefinition } from '../../types';
import { eventLoopFamily } from './event-loop';
import { httpClientErrorsFamily } from './http-client-errors';
import { promiseCombinatorsFamily } from './promise-combinators';
import { reactEffectsFamily } from './react-effects';
import { requestRacesFamily } from './request-races';
import { uiStateFamily } from './ui-state';

export const FRONTEND_FAMILIES: AnyFamilyDefinition[] = [
  eventLoopFamily,
  promiseCombinatorsFamily,
  uiStateFamily,
  reactEffectsFamily,
  httpClientErrorsFamily,
  requestRacesFamily,
];
