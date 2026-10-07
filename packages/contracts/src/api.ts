import type {
  AnswerFormat,
  AttemptStatus,
  Availability,
  ContactChannel,
  Grade,
  OnboardingStepKey,
  Role,
  SkillEvidenceStatus,
  Specialization,
  WorkFormat,
} from './enums';

// ───────────────────────────── Общее ─────────────────────────────

/** Единый формат ошибки API. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CodeTitle {
  code: string;
  title: string;
}

// ───────────────────────────── Auth ─────────────────────────────

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  done: boolean;
}

export interface DiscoverabilityIssue {
  code:
    | 'EMAIL_NOT_VERIFIED'
    | 'PROFILE_INCOMPLETE'
    | 'NO_CONTACT_CHANNEL'
    | 'NO_PUBLICATION_CONSENT'
    | 'NOT_DISCOVERABLE'
    | 'PAUSED'
    | 'NO_CONFIRMED_QUALIFICATION';
  message: string;
  missingFields?: string[];
}

export interface MeResponse {
  user: { id: string; email: string; role: Role; emailVerified: boolean; isDemo: boolean };
  candidate: {
    profileId: string;
    alias: string;
    activeSpecialization: Specialization | null;
    declaredGrade: Grade | null;
    confirmedGrade: Grade | null;
    onboarding: OnboardingStep[];
    nextStep: OnboardingStepKey | null;
    discoverable: boolean;
    discoverabilityIssues: DiscoverabilityIssue[];
    newInvitations: number;
  } | null;
  employer: {
    companyId: string | null;
    companyName: string | null;
    companyComplete: boolean;
    activeNeeds: number;
    /** Новые (непросмотренные) отклики на вакансии компании. */
    newApplications: number;
    /** Ответы кандидатов на короткие задания компании, ожидающие оценки (текстовые разборы). */
    pendingTaskReviews: number;
  } | null;
}

// ───────────────────────────── Справочники ─────────────────────────────

export interface SpecializationInfo {
  code: Specialization;
  title: string;
  description: string;
  groups: CodeTitle[];
}

export interface SkillInfo {
  code: string;
  title: string;
  category: string;
  specializations: Specialization[];
  /** Специализации, в тестах которых навык проверяется заданиями. */
  assessableIn: Specialization[];
}

export interface ReferenceCatalog {
  industries: CodeTitle[];
  teamRoles: CodeTitle[];
  softSkills: CodeTitle[];
  timezones: CodeTitle[];
  workFormats: CodeTitle[];
  grades: CodeTitle[];
}

export interface SurveyQuestion {
  code: string;
  title: string;
  hint?: string;
  kind: 'single' | 'multi';
  options: CodeTitle[];
  required: boolean;
}

export interface SurveyDefinition {
  version: string;
  questions: SurveyQuestion[];
}

export type SurveyAnswers = Record<string, string | string[]>;

export interface SurveyRecommendation {
  specialization: Specialization;
  grade: Grade;
  reasons: string[];
}

// ───────────────────────────── Профиль кандидата ─────────────────────────────

export interface ConsentState {
  active: boolean;
  policyVersion: string | null;
  acceptedAt: string | null;
  withdrawnAt: string | null;
  currentPolicyVersion: string;
}

export interface OwnProfile {
  id: string;
  alias: string;
  fullName: string | null;
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  city: string | null;
  timezone: string | null;
  workFormats: WorkFormat[];
  availability: Availability;
  salaryFrom: number | null;
  salaryTo: number | null;
  industries: string[];
  activeSpecialization: Specialization | null;
  declaredGrade: Grade | null;
  experienceMonths: number | null;
  skills: Array<{ code: string; title: string; months: number | null; verified: boolean }>;
  teamRoles: string[];
  experienceDescription: string | null;
  softSkills: string[];
  externalLinks: string[];
  isDiscoverable: boolean;
  showSalaryToEmployers: boolean;
  showFspToEmployers: boolean;
  disclosureChannels: ContactChannel[];
  updatedAt: string;
}

export interface OwnProfileResponse {
  profile: OwnProfile;
  survey: { version: string; answers: SurveyAnswers; completedAt: string; recommendation: SurveyRecommendation } | null;
  consents: { dataProcessing: ConsentState; profilePublication: ConsentState };
  discoverability: { discoverable: boolean; issues: DiscoverabilityIssue[] };
  qualification: QualificationView | null;
  verifiedSkills: string[];
}

export type ProfileUpdate = Partial<{
  fullName: string | null;
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  city: string | null;
  timezone: string | null;
  workFormats: WorkFormat[];
  availability: Availability;
  salaryFrom: number | null;
  salaryTo: number | null;
  industries: string[];
  activeSpecialization: Specialization | null;
  declaredGrade: Grade | null;
  experienceMonths: number | null;
  skills: Array<{ code: string; months?: number | null }>;
  teamRoles: string[];
  experienceDescription: string | null;
  softSkills: string[];
  externalLinks: string[];
  isDiscoverable: boolean;
  showSalaryToEmployers: boolean;
  showFspToEmployers: boolean;
  disclosureChannels: ContactChannel[];
}>;

// ───────────────────────────── Представление профиля (обезличенное / с доступом) ─────────────────────────────

export type ProfileViewMode = 'OWNER' | 'EMPLOYER_REDACTED' | 'EMPLOYER_GRANTED';

export interface SkillEvidenceView {
  skill: string;
  title: string;
  score: number;
  cases: number;
  status: SkillEvidenceStatus;
}

export interface QualificationView {
  specialization: Specialization;
  specializationTitle: string;
  grade: Grade;
  gradeTitle: string;
  overallScore: number;
  groupScores: Array<{ group: string; title: string; score: number }>;
  skillEvidence: SkillEvidenceView[];
  confirmedAt: string;
}

export interface AchievementView {
  discipline: string | null;
  participationType: string | null;
  eventLevel: string | null;
  place: number | null;
  outcome: 'WIN' | 'PRIZE' | 'PARTICIPATION';
  year: number | null;
  skillTags: CodeTitle[];
  relevantToSpecialization: boolean;
  isDemo: boolean;
  eventTitle?: string | null;
  eventDate?: string | null;
  teamRole?: string | null;
}

export interface CandidateProfileView {
  mode: ProfileViewMode;
  candidateId: string;
  displayName: string;
  alias: string;
  specialization: { code: Specialization; title: string } | null;
  qualification: QualificationView | null;
  declaredGrade: CodeTitle | null;
  experienceMonths: number | null;
  city: string | null;
  workFormats: WorkFormat[];
  salaryExpectation: { from: number | null; to: number | null; currency: 'RUB'; period: 'MONTH'; gross: true } | null;
  industries: CodeTitle[];
  teamRoles: CodeTitle[];
  softSkills: CodeTitle[];
  skills: Array<{ code: string; title: string; source: 'SELF_REPORTED' | 'VERIFIED'; months: number | null }>;
  fsp: { linked: boolean; state: string | null; achievements: AchievementView[]; demoNotice: string | null };
  personal?: { fullName: string | null; timezone: string | null; externalLinks: string[]; experienceDescription: string | null };
  contacts?: Array<{ channel: ContactChannel; value: string }>;
  grant?: { grantedAt: string; channels: ContactChannel[] };
  updatedAt: string;
}

/** Результат группы навыков в подтверждённой квалификации (с числом частей, из которых он получен). */
export interface GroupScoreDetail {
  group: string;
  title: string;
  score: number;
  items: number;
  earnedParts: number;
  totalParts: number;
}

export interface SkillEvidenceDetail extends SkillEvidenceView {
  /** Сколько частей заданий оценивали навык. */
  parts: number;
}

export interface QualificationsResponse {
  qualifications: Array<{
    specialization: Specialization;
    grade: Grade;
    overallScore: number;
    groupScores: GroupScoreDetail[];
    skillEvidence: SkillEvidenceDetail[];
    verifiedSkills: string[];
    confirmedAt: string;
    nextReassessmentAt: string;
    policyVersion: string;
    attemptId: string;
  }>;
  history: Array<{
    id: string;
    specialization: Specialization;
    eventType: 'CONFIRMED' | 'RECONFIRMED' | 'RAISED' | 'LOWERED_BY_CHOICE';
    grade: Grade;
    previousGrade: Grade | null;
    overallScore: number;
    attemptId: string;
    policyVersion: string;
    occurredAt: string;
  }>;
}

// ───────────────────────────── Тестирование ─────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; caption?: string; columns: string[]; rows: Array<Array<string | number | null>> }
  | { type: 'list'; items: string[] };

export interface PublicOption {
  id: string;
  label: string;
}

export type PublicPart =
  | { id: string; format: 'SINGLE_CHOICE'; prompt: string; options: PublicOption[] }
  | { id: string; format: 'MULTI_SELECT'; prompt: string; options: PublicOption[] }
  | { id: string; format: 'NUMERIC'; prompt: string; integer: boolean; unit?: string }
  | { id: string; format: 'MATCHING'; prompt: string; left: PublicOption[]; right: PublicOption[] }
  | { id: string; format: 'ORDERING'; prompt: string; items: PublicOption[] };

export interface PublicTask {
  title: string;
  context: ContentBlock[];
  parts: PublicPart[];
}

export type PartAnswer =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: number }
  | { pairs: Record<string, string> }
  | { order: string[] };

export interface ItemAnswer {
  parts: Record<string, PartAnswer | null>;
}

export type EligibilityReason = 'ACTIVE_ATTEMPT' | 'REASSESSMENT_LOCKED' | 'RETRY_COOLDOWN';

export interface GradeEligibility {
  grade: Grade;
  allowed: boolean;
  reason?: EligibilityReason;
  message: string;
  availableAt: string | null;
  activeAttemptId?: string;
  warnings: Array<{ code: 'REPLACES_WITH_LOWER_GRADE' | 'RECONFIRMS_GRADE' | 'RAISES_GRADE'; message: string }>;
}

export interface AssessmentRules {
  policyVersion: string;
  durationMinutes: number;
  cases: number;
  itemsPerGroup: number;
  minScoredParts: number;
  passOverall: number;
  passGroupMin: number;
  confidentOverall: number;
  confidentGroupMin: number;
  skillMinCases: number;
  skillMinScore: number;
  retryCooldownHours: number;
  reassessmentDays: number;
}

export interface EligibilityResponse {
  specialization: Specialization;
  specializationTitle: string;
  serverNow: string;
  qualification: { grade: Grade; overallScore: number; confirmedAt: string; nextReassessmentAt: string } | null;
  activeAttempt: { id: string; specialization: Specialization; grade: Grade; expiresAt: string } | null;
  grades: GradeEligibility[];
  rules: AssessmentRules;
}

export interface AttemptSummary {
  id: string;
  specialization: Specialization;
  specializationTitle: string;
  grade: Grade;
  status: AttemptStatus;
  startedAt: string;
  expiresAt: string;
  finishedAt: string | null;
  overallScore: number | null;
  confident: boolean | null;
  qualificationGranted: boolean;
  isSynthetic: boolean;
}

export interface AttemptItemView {
  id: string;
  position: number;
  groupCode: string;
  groupTitle: string;
  task: PublicTask;
  answer: ItemAnswer | null;
  revision: number;
  savedAt: string | null;
}

export interface AttemptView extends AttemptSummary {
  serverNow: string;
  durationMinutes: number;
  policyVersion: string;
  items: AttemptItemView[];
}

export interface SavedAnswer {
  itemId: string;
  revision: number;
  savedAt: string;
}

export interface AttemptResult extends AttemptSummary {
  passed: boolean;
  groups: Array<{ group: string; title: string; score: number; items: number; earnedParts: number; totalParts: number }>;
  skills: Array<{ skill: string; title: string; score: number; cases: number; parts: number; status: SkillEvidenceStatus }>;
  recommendations: Array<{ kind: string; message: string; grade?: Grade }>;
  thresholds: AssessmentRules;
  versions: { policy: string; bank: string; blueprint: string };
  eligibility: EligibilityResponse;
  statusMessage: string;
}

export type { AnswerFormat };

// ───────────────────────────── Автораспознавание резюме ─────────────────────────────

export type ResumeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ResumeFieldKey =
  | 'fullName'
  | 'contactEmail'
  | 'phone'
  | 'messenger'
  | 'city'
  | 'timezone'
  | 'externalLinks'
  | 'experienceMonths'
  | 'skills'
  | 'teamRoles'
  | 'softSkills'
  | 'industries'
  | 'activeSpecialization'
  | 'declaredGrade'
  | 'experienceDescription';

/** Предложения для профиля по тексту резюме. Ничего не применено: кандидат проверяет поля и применяет их обычным PATCH профиля. */
export interface ResumeSuggestion {
  fullName: string | null;
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  city: string | null;
  timezone: string | null;
  externalLinks: string[];
  experienceMonths: number | null;
  skills: Array<{ code: string; title: string; months: number | null }>;
  teamRoles: string[];
  softSkills: string[];
  industries: string[];
  activeSpecialization: Specialization | null;
  declaredGrade: Grade | null;
  experienceDescription: string | null;
  confidence: Partial<Record<ResumeFieldKey, ResumeConfidence>>;
  warnings: string[];
}

export interface ResumeAnalysisResponse {
  suggestion: ResumeSuggestion;
  source: { pages: number; characters: number; truncated: boolean; recognizedFields: number };
  notice: string;
}
