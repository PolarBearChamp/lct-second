// Перечисления, общие для API и веб-клиента. Значения совпадают с enum-ами Prisma и кодами справочников.

export const ROLES = ['CANDIDATE', 'EMPLOYER'] as const;
export type Role = (typeof ROLES)[number];

export const GRADES = ['JUNIOR', 'MIDDLE', 'SENIOR'] as const;
export type Grade = (typeof GRADES)[number];

export const SPECIALIZATIONS = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const;
export type Specialization = (typeof SPECIALIZATIONS)[number];

export const WORK_FORMATS = ['REMOTE', 'HYBRID', 'OFFICE'] as const;
export type WorkFormat = (typeof WORK_FORMATS)[number];

export const AVAILABILITY = ['ACTIVE', 'PAUSED'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const CONTACT_CHANNELS = ['EMAIL', 'PHONE', 'MESSENGER'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'PASSED', 'FAILED', 'EXPIRED', 'ABANDONED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const INVITATION_STATUSES = ['SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const VACANCY_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

export const APPLICATION_STATUSES = ['SENT', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const SHORT_TASK_KINDS = ['QUIZ', 'APPROACH'] as const;
export type ShortTaskKind = (typeof SHORT_TASK_KINDS)[number];

export const SHORT_TASK_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type ShortTaskStatus = (typeof SHORT_TASK_STATUSES)[number];

export const TASK_ASSIGNMENT_STATUSES = ['OFFERED', 'SUBMITTED', 'SKIPPED', 'EXPIRED'] as const;
export type TaskAssignmentStatus = (typeof TASK_ASSIGNMENT_STATUSES)[number];

export const TASK_VERDICTS = ['STRONG', 'ACCEPTABLE', 'WEAK'] as const;
export type TaskVerdict = (typeof TASK_VERDICTS)[number];

export const HIRING_NEED_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type HiringNeedStatus = (typeof HIRING_NEED_STATUSES)[number];

export const SKILL_REQUIREMENT_MODES = ['SELF_REPORTED_ALLOWED', 'VERIFIED_ONLY'] as const;
export type SkillRequirementMode = (typeof SKILL_REQUIREMENT_MODES)[number];

export const FSP_LINK_STATES = ['NOT_LINKED', 'LINKED_WITH_HISTORY', 'LINKED_WITHOUT_HISTORY', 'SYNC_ERROR'] as const;
export type FspLinkState = (typeof FSP_LINK_STATES)[number];

export const ANSWER_FORMATS = ['SINGLE_CHOICE', 'MULTI_SELECT', 'NUMERIC', 'MATCHING', 'ORDERING'] as const;
export type AnswerFormat = (typeof ANSWER_FORMATS)[number];

export const SKILL_EVIDENCE_STATUSES = ['CONFIRMED', 'BELOW_THRESHOLD', 'INSUFFICIENT_DATA'] as const;
export type SkillEvidenceStatus = (typeof SKILL_EVIDENCE_STATUSES)[number];

export const ONBOARDING_STEPS = ['EMAIL', 'PROFILE', 'SURVEY', 'ASSESSMENT', 'PUBLICATION'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];
