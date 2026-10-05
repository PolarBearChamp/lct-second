import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import {
  type AssessmentPolicy,
  getAssessmentPolicy,
  getInvitationPolicy,
  getMatchingFormula,
  type InvitationPolicy,
  type MatchingFormula,
} from '../config/policies';

/** Доступ к активным версиям политик, выбранным через конфигурацию окружения. */
@Injectable()
export class PolicyService {
  readonly assessment: AssessmentPolicy;
  readonly matching: MatchingFormula;
  readonly invitation: InvitationPolicy;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.assessment = getAssessmentPolicy(env.ASSESSMENT_POLICY_VERSION);
    this.matching = getMatchingFormula(env.MATCHING_FORMULA_VERSION);
    this.invitation = getInvitationPolicy(env.INVITATION_POLICY_VERSION);
  }
}
