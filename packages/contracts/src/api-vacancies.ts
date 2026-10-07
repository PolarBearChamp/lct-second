import type { CandidateProfileView, CodeTitle } from './api';
import type { MatchExplanation } from './api-employer';
import type { ApplicationStatus, ContactChannel, Grade, SkillRequirementMode, Specialization, VacancyStatus, WorkFormat } from './enums';

// ───────────────────────────── Вакансии ─────────────────────────────

export interface VacancyRequirements {
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
}

/** Вакансия в кабинете работодателя. */
export interface EmployerVacancyView extends VacancyRequirements {
  id: string;
  title: string;
  description: string;
  status: VacancyStatus;
  statusTitle: string;
  version: number;
  needId: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  applicationsCount: number;
  newApplicationsCount: number;
  activeApplicationsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVacancyRequest {
  needId?: string;
  publish?: boolean;
  title: string;
  description: string;
  specialization: Specialization;
  allowedGrades: Grade[];
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: SkillRequirementMode }>;
  workFormat: WorkFormat;
  city?: string | null;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
}

/** Соответствие кандидата требованиям вакансии (то же правило, что при подборе по потребности). */
export interface VacancyFitSummary {
  passes: boolean;
  violations: string[];
  score: number | null;
}

export interface VacancyFit extends VacancyFitSummary {
  explanation: MatchExplanation | null;
}

export interface ApplyBlockerView {
  code: 'VACANCY_NOT_OPEN' | 'QUALIFICATION_REQUIRED' | 'PROFILE_INCOMPLETE' | 'NO_CONTACT_CHANNEL' | 'ACTIVE_APPLICATION_EXISTS';
  message: string;
  missingFields?: string[];
}

/** Вакансия в общем списке кандидата. */
export interface CandidateVacancyItem extends VacancyRequirements {
  id: string;
  title: string;
  companyName: string;
  companyIndustry: string | null;
  publishedAt: string | null;
  myApplication: { id: string; status: ApplicationStatus } | null;
  fit: VacancyFitSummary | null;
  canApply: boolean;
}

export interface CandidateVacancyDetail extends VacancyRequirements {
  id: string;
  title: string;
  description: string;
  companyName: string;
  companyIndustry: string | null;
  publishedAt: string | null;
  status: VacancyStatus;
  company: { name: string; industry: string | null; industryTitle: string | null; website: string | null; description: string | null; contactType: string | null; contactValue: string | null; verified: false };
  myApplication: { id: string; status: ApplicationStatus } | null;
  fit: VacancyFit | null;
  canApply: boolean;
  blockers: ApplyBlockerView[];
  disclosure: { fullName: string | null; channels: Array<{ channel: ContactChannel; value: string | null }>; alsoShared: string[] };
}

export interface ApplyRequest {
  confirmDisclosure: true;
  coverNote?: string;
}

// ───────────────────────────── Отклики ─────────────────────────────

export interface ApplicationBase {
  id: string;
  status: ApplicationStatus;
  statusTitle: string;
  vacancyId: string;
  vacancyTitle: string;
  companyName: string;
  specialization: Specialization;
  specializationTitle: string;
  salaryFrom: number;
  salaryTo: number;
  salaryType: 'GROSS';
  workFormat: WorkFormat;
  createdAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
}

export interface ApplicationEventView {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  occurredAt: string;
}

export interface CandidateApplicationDetail extends ApplicationBase {
  /** Описание вакансии на момент отклика. */
  description: string;
  coverNote: string | null;
  company: { name: string; industry: string | null; industryTitle: string | null; website: string | null; description: string | null };
  companyContact: { type: string; value: string } | null;
  vacancyStatus: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  canWithdraw: boolean;
  events: ApplicationEventView[];
  contactAccess: { active: boolean; grantedAt: string; revokedAt: string | null; channels: ContactChannel[] } | null;
}

export interface EmployerApplicationItem extends ApplicationBase {
  candidateId: string;
  candidateAlias: string;
  /** ФИО — только при действующем доступе к контактам, иначе «Кандидат XXXX». */
  candidateName: string;
  hasContactAccess: boolean;
  hasCoverNote: boolean;
  grade: Grade | null;
  gradeTitle: string | null;
  overallScore: number | null;
  fit: VacancyFitSummary | null;
}

export interface EmployerApplicationList {
  page: number;
  pageSize: number;
  total: number;
  sorting: string;
  items: EmployerApplicationItem[];
}

export interface EmployerApplicationDetail extends ApplicationBase {
  description: string;
  coverNote: string | null;
  candidateId: string;
  candidateAlias: string;
  vacancyCurrentVersion: number;
  vacancyStatus: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  events: ApplicationEventView[];
  fit: VacancyFit | null;
  /** Карточка кандидата в объёме прав компании; null — кандидат скрыт и доступа нет. */
  profile: CandidateProfileView | null;
  canDecide: boolean;
}
