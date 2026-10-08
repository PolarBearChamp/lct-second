import type { AchievementView, CandidateProfileView, CodeTitle, ContentBlock, PublicPart } from './api';
import type {
  ContactChannel,
  FspLinkState,
  Grade,
  HiringNeedStatus,
  InvitationStatus,
  SkillRequirementMode,
  Specialization,
  WorkFormat,
} from './enums';

// ───────────────────────────── Приглашения ─────────────────────────────

export interface InvitationBase {
  id: string;
  status: InvitationStatus;
  title: string;
  companyName: string;
  companyIndustry: string | null;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
  workFormat: WorkFormat;
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  /** Работодатель подтвердил особые условия труда для кандидата 16–17 лет. */
  minorConditionsAcknowledged: boolean;
}

export interface InvitationEventView {
  fromStatus: InvitationStatus | null;
  toStatus: InvitationStatus;
  occurredAt: string;
}

export interface CandidateInvitationDetail extends InvitationBase {
  description: string;
  employerContactType: ContactChannel;
  employerContact: string;
  company: { name: string; industry: string | null; industryTitle: string | null; website: string | null; description: string | null };
  /** Компания прошла добровольную проверку (метка доверия). */
  companyVerified: boolean;
  events: InvitationEventView[];
  disclosure: { fullName: string | null; channels: Array<{ channel: ContactChannel; value: string | null }>; alsoShared: string[] };
  contactAccess: { active: boolean; grantedAt: string; revokedAt: string | null; channels: ContactChannel[] } | null;
}

export interface EmployerInvitationItem extends InvitationBase {
  candidateId: string;
  candidateAlias: string;
  needId: string | null;
  needTitle: string | null;
  hasContactAccess: boolean;
}

export interface EmployerInvitationDetail extends InvitationBase {
  description: string;
  employerContactType: ContactChannel;
  employerContact: string;
  candidateId: string;
  candidateAlias: string;
  needId: string | null;
  needTitle: string | null;
  events: InvitationEventView[];
  contactAccess: { active: boolean; grantedAt: string; revokedAt: string | null; fromThisInvitation: boolean } | null;
}

export interface SendInvitationRequest {
  candidateId: string;
  needId?: string;
  title: string;
  description: string;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
  workFormat: WorkFormat;
  employerContactType: ContactChannel;
  employerContact: string;
  /** Обязательно true для кандидатов 16–17 лет (ТК РФ, гл. 42). */
  minorConditionsAcknowledged?: boolean;
}

export interface ContactAccessItem {
  companyId: string;
  companyName: string;
  channels: ContactChannel[];
  grantedAt: string;
  revokedAt: string | null;
  active: boolean;
  /** Принятое приглашение, которым выдан доступ (null — доступ выдан самостоятельным откликом). */
  sourceInvitationId: string | null;
  /** Отклик на вакансию, которым выдан доступ (null — доступ выдан принятием приглашения). */
  sourceApplicationId: string | null;
}

// ───────────────────────────── ФСП ─────────────────────────────

export interface FspStateResponse {
  provider: string;
  demo: boolean;
  notice: string | null;
  state: FspLinkState;
  externalId: string | null;
  linkedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  achievements: AchievementView[];
}

// ───────────────────────────── Компания и потребности ─────────────────────────────

export interface CompanyView {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  industryTitle: string | null;
  website: string | null;
  contactPersonName: string | null;
  contactChannelType: ContactChannel | null;
  contactValue: string | null;
  /** Добровольная метка доверия пройдена. */
  verified: boolean;
  verification: CompanyVerificationView;
  updatedAt: string;
}

export interface CompanyVerificationView {
  status: 'NOT_REQUESTED' | 'VERIFIED' | 'REJECTED';
  statusTitle: string;
  inn: string | null;
  verifiedAt: string | null;
  checks: Array<{ code: 'INN_FORMAT' | 'REGISTRY_FOUND' | 'NAME_MATCH' | 'EMAIL_DOMAIN'; passed: boolean; text: string }>;
  /** Проверка по демонстрационному реестру, а не по ЕГРЮЛ. */
  demo: true;
}

export interface VerifyCompanyRequest {
  inn: string;
}

export interface HiringNeedView {
  id: string;
  title: string;
  description: string;
  specialization: Specialization;
  specializationTitle: string;
  allowedGrades: Grade[];
  requiredSkills: CodeTitle[];
  preferredSkills: Array<CodeTitle & { mode: SkillRequirementMode }>;
  workFormat: WorkFormat;
  city: string | null;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
  status: HiringNeedStatus;
  version: number;
  selectionsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HiringNeedInput {
  title: string;
  description: string;
  specialization: Specialization;
  allowedGrades: Grade[];
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: SkillRequirementMode }>;
  workFormat: WorkFormat;
  city: string | null;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
  status?: HiringNeedStatus;
}

export interface RequirementCoverage {
  skill: string;
  title: string;
  kind: 'REQUIRED' | 'PREFERRED';
  mode?: SkillRequirementMode;
  status: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN_SKILL';
  bankFamilies: Array<{ familyId: string; title: string; group: string }>;
  casesInPlan: number;
  note: string;
}

export interface AssessmentPreviewResponse {
  needId: string;
  needVersion: number;
  specialization: Specialization;
  notice: string;
  grades: Array<{
    grade: Grade;
    gradeTitle: string;
    blueprint: {
      version: string;
      specialization: Specialization;
      grade: Grade;
      slots: Array<{ position: number; groupCode: string; groupTitle: string; familyId: string; familyTitle: string; familyDescription: string; covers: string[] }>;
      coverage: RequirementCoverage[];
      bankNotes: string[];
    };
    samples: Array<{ position: number; familyTitle: string; groupTitle: string; task: { title: string; context: ContentBlock[]; parts: PublicPart[] } }>;
  }>;
}

// ───────────────────────────── Подбор ─────────────────────────────

export interface CandidateSummary {
  candidateId: string;
  alias: string;
  displayName: string;
  specialization: Specialization;
  /** Подтверждённый тестом грейд; null — грейд не подтверждён (кандидат показывается после подтверждённых, с пометкой). */
  grade: Grade | null;
  gradeTitle: string | null;
  gradeConfirmed: boolean;
  /** Заявленный кандидатом грейд (самоописание). */
  declaredGrade: Grade | null;
  declaredGradeTitle: string | null;
  overallScore: number | null;
  groupScores: Array<{ group: string; title: string; score: number }>;
  verifiedSkills: CodeTitle[];
  selfReportedSkillsCount: number;
  city: string | null;
  workFormats: WorkFormat[];
  salary: { from: number | null; to: number | null } | null;
  salaryHidden: boolean;
  fsp: { achievements: number; relevantEvents: number; points: number };
  bookmarked: boolean;
  activeInvitation: { id: string; status: InvitationStatus } | null;
  hasContactAccess: boolean;
  /** 16–17 лет: особые условия трудоустройства (ТК РФ, гл. 42). */
  minor: boolean;
}

export interface BankResponse {
  /** bankScore = null у кандидатов без подтверждённого грейда; category = «SPEC:UNCONFIRMED» для них. */
  items: Array<CandidateSummary & { bankScore: number | null; category: string }>;
  total: number;
  page: number;
  pageSize: number;
  formulaVersion: string;
  sorting: string;
  durationMs: number;
}

export interface ComponentBreakdown {
  value: number;
  weight: number;
  contribution: number;
}

export interface MatchExplanation {
  why: string[];
  notVerified: string[];
  passedRequirements: Array<{ code: string; text: string }>;
  matchedPreferred: Array<{ skill: string; title: string; evidence: 'VERIFIED' | 'SELF_REPORTED'; credit: number }>;
  unmatchedPreferred: Array<{ skill: string; title: string; reason: 'NOT_PRESENT' | 'SELF_REPORTED_NOT_ACCEPTED' }>;
  salary: { status: 'OVERLAP' | 'NOT_SPECIFIED' | 'HIDDEN'; text: string };
  components: {
    preferredFit: ComponentBreakdown;
    assessmentQuality: ComponentBreakdown;
    fspEvidence: ComponentBreakdown & { relevantEvents: number; points: number };
  };
}

export interface SelectionRefinements {
  onlyWithFsp?: boolean;
  minOverallScore?: number;
  extraRequiredSkills?: string[];
  cities?: string[];
}

export interface SelectionRunSummary {
  id: string;
  createdAt: string;
  needVersion: number;
  formulaVersion: string;
  filters: SelectionRefinements;
  parentRunId: string | null;
  totalConsidered: number;
  totalMatched: number;
  totalUnconfirmed: number;
}

export type SelectionItem =
  | { rank: number; unavailable: true }
  /** gradeConfirmed=false — блок «без подтверждённого грейда» после всех подтверждённых: score = null. */
  | { rank: number; unavailable: false; gradeConfirmed: boolean; score: number | null; candidate: CandidateSummary; explanation: MatchExplanation };

export interface SelectionRunView {
  id: string;
  needId: string;
  needVersion: number;
  currentNeedVersion: number | null;
  needSnapshot: HiringNeedView;
  filters: SelectionRefinements;
  formulaVersion: string;
  /** Снимок формулы, по которой построена подборка. */
  formula: {
    version: string;
    algorithm: string;
    needWeights: { preferredFit: number; assessmentQuality: number; fspEvidence: number };
    bankWeights: { assessmentQuality: number; fspEvidence: number };
    selfReportedCredit: number;
    fsp: { participationPoints: number; prizePoints: number; winPoints: number; normalizer: number; relevanceVersion: string };
  };
  parentRunId: string | null;
  createdAt: string;
  totalConsidered: number;
  totalMatched: number;
  /** Кандидаты без подтверждённого грейда, показанные после подтверждённых (не входят в totalMatched). */
  totalUnconfirmed: number;
  durationMs: number;
  emptyReasons: Array<{ reason: string; text: string; count: number }>;
  rejectedBySkill: Array<{ skill: string; title: string; count: number }>;
  page: number;
  pageSize: number;
  total: number;
  items: SelectionItem[];
}

export interface EmployerCandidateResponse {
  profile: CandidateProfileView;
  bookmarked: boolean;
  invitations: Array<{ id: string; status: InvitationStatus; title: string; createdAt: string; expiresAt: string }>;
  match: { needId: string; needTitle: string; gradeConfirmed: boolean; passes: boolean; violations: string[]; score: number | null; explanation: MatchExplanation | null } | null;
}

export type BookmarkItem =
  | { candidateId: string; createdAt: string; unavailable: false; candidate: CandidateSummary }
  | { candidateId: string; createdAt: string; unavailable: true; hasContactAccess: boolean };
