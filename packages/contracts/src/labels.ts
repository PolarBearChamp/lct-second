import type {
  AttemptStatus,
  Availability,
  ContactChannel,
  FspLinkState,
  Grade,
  HiringNeedStatus,
  InvitationStatus,
  SkillEvidenceStatus,
  SkillRequirementMode,
  Specialization,
  WorkFormat,
} from './enums';

/** Русские подписи перечислений для интерфейса. */

export const GRADE_LABELS: Record<Grade, string> = { JUNIOR: 'Junior', MIDDLE: 'Middle', SENIOR: 'Senior' };

export const SPECIALIZATION_LABELS: Record<Specialization, string> = {
  FRONTEND: 'Frontend-разработчик',
  BACKEND: 'Backend-разработчик',
  ML_ENGINEER: 'ML-инженер',
  MANUAL_QA: 'Инженер по ручному тестированию',
};

export const SPECIALIZATION_SHORT: Record<Specialization, string> = {
  FRONTEND: 'Frontend',
  BACKEND: 'Backend',
  ML_ENGINEER: 'ML',
  MANUAL_QA: 'Manual QA',
};

export const WORK_FORMAT_LABELS: Record<WorkFormat, string> = { REMOTE: 'Удалённо', HYBRID: 'Гибрид', OFFICE: 'Офис' };

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  ACTIVE: 'Рассматриваю предложения',
  PAUSED: 'Поиск приостановлен',
};

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  EMAIL: 'Email',
  PHONE: 'Телефон',
  MESSENGER: 'Мессенджер',
};

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  IN_PROGRESS: 'В процессе',
  PASSED: 'Пройден',
  FAILED: 'Не пройден',
  EXPIRED: 'Время истекло',
  ABANDONED: 'Прерван',
};

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  SENT: 'Отправлено',
  VIEWED: 'Просмотрено',
  ACCEPTED: 'Принято',
  DECLINED: 'Отклонено',
  WITHDRAWN: 'Отозвано',
  EXPIRED: 'Истёк срок',
};

export const NEED_STATUS_LABELS: Record<HiringNeedStatus, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Активна',
  ARCHIVED: 'В архиве',
};

export const SKILL_MODE_LABELS: Record<SkillRequirementMode, string> = {
  SELF_REPORTED_ALLOWED: 'Достаточно самоописания',
  VERIFIED_ONLY: 'Только подтверждённый тестом',
};

export const FSP_STATE_LABELS: Record<FspLinkState, string> = {
  NOT_LINKED: 'Не привязан',
  LINKED_WITH_HISTORY: 'Привязан, есть история',
  LINKED_WITHOUT_HISTORY: 'Привязан, истории нет',
  SYNC_ERROR: 'Ошибка синхронизации',
};

export const SKILL_EVIDENCE_LABELS: Record<SkillEvidenceStatus, string> = {
  CONFIRMED: 'Подтверждён тестом',
  BELOW_THRESHOLD: 'Ниже порога',
  INSUFFICIENT_DATA: 'Недостаточно данных',
};
