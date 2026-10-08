import type { Grade, ShortTaskKind, ShortTaskStatus, Specialization, TaskAssignmentStatus, TaskVerdict } from './enums';

/** ROTATION — регулярное предложение платформы; DIRECT — работодатель отправил задание лично. */
export type TaskAssignmentSource = 'ROTATION' | 'DIRECT';

// ───────────────────────────── Короткие задания работодателей ─────────────────────────────

/** Задание в кабинете работодателя. Верный ответ виден только автору. */
export interface EmployerTaskView {
  id: string;
  title: string;
  prompt: string;
  specialization: Specialization;
  specializationTitle: string;
  /** Пусто — подходит любому подтверждённому грейду. */
  allowedGrades: Grade[];
  kind: ShortTaskKind;
  kindTitle: string;
  options: string[];
  correctIndex: number | null;
  explanation: string | null;
  status: ShortTaskStatus;
  statusTitle: string;
  publishedAt: string | null;
  closedAt: string | null;
  deadlineAt: string | null;
  offeredCount: number;
  submittedCount: number;
  /** Текстовые разборы без оценки автора. */
  pendingReviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  prompt: string;
  specialization: Specialization;
  allowedGrades?: Grade[];
  kind: ShortTaskKind;
  /** Только QUIZ: 2–6 вариантов. */
  options?: string[];
  /** Только QUIZ: индекс верного варианта. */
  correctIndex?: number;
  explanation?: string | null;
  deadlineAt?: string | null;
  /** true — сразу опубликовать. */
  publish?: boolean;
}

/** Редактировать можно только черновик: у опубликованного задания условие не меняется. */
export type UpdateTaskRequest = Partial<Omit<CreateTaskRequest, 'publish'>>;

/** Ответ кандидата для автора задания. Без ФИО и контактов: только псевдоним и подтверждённый грейд. */
export interface TaskSubmissionItem {
  id: string;
  candidateId: string;
  candidateAlias: string;
  confirmedGrade: Grade | null;
  confirmedGradeTitle: string | null;
  submittedAt: string;
  selectedIndex: number | null;
  answerText: string | null;
  isCorrect: boolean | null;
  needsReview: boolean;
  source: TaskAssignmentSource;
  verdict: TaskVerdict | null;
  verdictTitle: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
}

export interface TaskSubmissionsResponse {
  page: number;
  pageSize: number;
  total: number;
  task: EmployerTaskView;
  /** Только QUIZ. */
  quiz: { answered: number; correct: number } | null;
  items: TaskSubmissionItem[];
}

export interface AssignTaskRequest {
  candidateId: string;
  note?: string;
}

export interface TaskAssignmentReceipt {
  id: string;
  candidateId: string;
  candidateAlias: string;
  taskId: string;
  taskTitle: string;
  offeredAt: string;
  dueAt: string;
}

export interface ReviewSubmissionRequest {
  verdict: TaskVerdict;
  comment?: string | null;
}

// ───────────────────────────── Кабинет кандидата ─────────────────────────────

/** Результат ответа. Верный вариант раскрывается только после отправки. */
export interface CandidateTaskResult {
  selectedIndex: number | null;
  answerText: string | null;
  isCorrect: boolean | null;
  correctIndex: number | null;
  explanation: string | null;
  verdict: TaskVerdict | null;
  verdictTitle: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
}

export interface CandidateTaskView {
  /** Идентификатор предложения (не задания). */
  id: string;
  status: TaskAssignmentStatus;
  statusTitle: string;
  source: TaskAssignmentSource;
  /** Сообщение компании к адресному заданию. */
  note: string | null;
  offeredAt: string;
  dueAt: string;
  submittedAt: string | null;
  canSubmit: boolean;
  task: {
    title: string;
    prompt: string;
    kind: ShortTaskKind;
    kindTitle: string;
    /** Варианты (QUIZ) без отметки верного. */
    options: string[];
    specialization: Specialization;
    specializationTitle: string;
    companyName: string;
    /** Компания прошла добровольную проверку (метка доверия). */
    companyVerified: boolean;
    closed: boolean;
  };
  result: CandidateTaskResult | null;
}

export type TaskOfferBlocker = 'NOT_DISCOVERABLE' | 'PAUSED' | 'NO_CONFIRMED_QUALIFICATION';

export interface CandidateTasksResponse {
  /** Задание, ожидающее ответа. Новое предлагается не чаще раза в `intervalDays` дней, пока нет неотвеченного. */
  current: CandidateTaskView | null;
  /** Неотвеченные задания, которые работодатели отправили лично (не зависят от недельного периода). */
  direct: CandidateTaskView[];
  history: CandidateTaskView[];
  intervalDays: number;
  /** Когда можно ждать следующее задание; null — если есть текущее или предложений нет по причине из `blocker`. */
  nextOfferAt: string | null;
  /** Почему задания не предлагаются (null — предлагаются). */
  blocker: TaskOfferBlocker | null;
  blockerMessage: string | null;
  /** Регулярность: сколько заданий решено за 90 дней. Подтверждённый грейд и подбор от неё не зависят. */
  practice: { solvedLast90Days: number; lastSubmittedAt: string | null };
}

export interface SubmitTaskRequest {
  selectedIndex?: number;
  answerText?: string;
}
