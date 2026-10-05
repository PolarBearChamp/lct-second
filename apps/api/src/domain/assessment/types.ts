import type { GradeCode, SpecializationCode } from '../catalog/catalog';

/**
 * Контракт банка заданий.
 *
 * Семейство (family) — проверенный шаблон задачи с параметрами. Экземпляр генерируется
 * детерминированно из (id семейства, версия, грейд, серверный seed). Экземпляр состоит из
 * публичной части (условия и схема ответа — единственное, что уходит клиенту) и закрытого ключа.
 */

export type AnswerFormat = 'SINGLE_CHOICE' | 'MULTI_SELECT' | 'NUMERIC' | 'MATCHING' | 'ORDERING';

// ───────────── Содержимое условий ─────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; caption?: string; columns: string[]; rows: Array<Array<string | number | null>> }
  | { type: 'list'; items: string[] };

// ───────────── Авторская (семантическая) форма задания ─────────────
// Варианты имеют семантические ключи; при выдаче ключи заменяются непрозрачными идентификаторами,
// а порядок вариантов перемешивается. Семантические ключи на клиент не попадают.

export interface AuthoredOption {
  key: string;
  label: string;
}

interface AuthoredPartBase {
  /** Идентификатор части внутри задания, например "p1". */
  id: string;
  prompt: string;
  /** Навыки, которые реально проверяет эта часть (подмножество skillTags семейства). */
  skillTags: string[];
  /** Пояснение для ревью банка. Никогда не отдаётся кандидату. */
  explanation?: string;
}

export interface AuthoredSingleChoice extends AuthoredPartBase {
  format: 'SINGLE_CHOICE';
  options: AuthoredOption[];
  correct: string;
}

export interface AuthoredMultiSelect extends AuthoredPartBase {
  format: 'MULTI_SELECT';
  options: AuthoredOption[];
  correct: string[];
}

export interface AuthoredNumeric extends AuthoredPartBase {
  format: 'NUMERIC';
  correct: number;
  /** Абсолютный допуск. Для целых ответов — 0. */
  tolerance: number;
  integer: boolean;
  unit?: string;
}

export interface AuthoredMatching extends AuthoredPartBase {
  format: 'MATCHING';
  left: AuthoredOption[];
  right: AuthoredOption[];
  /** Ключ левого элемента → ключ правого. Правые элементы могут повторяться. */
  correct: Record<string, string>;
}

export interface AuthoredOrdering extends AuthoredPartBase {
  format: 'ORDERING';
  items: AuthoredOption[];
  /** Ключи элементов в правильном порядке. */
  correct: string[];
}

export type AuthoredPart = AuthoredSingleChoice | AuthoredMultiSelect | AuthoredNumeric | AuthoredMatching | AuthoredOrdering;

export interface AuthoredTask {
  title: string;
  context: ContentBlock[];
  parts: AuthoredPart[];
}

// ───────────── Публичная форма (сериализуется клиенту) ─────────────

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

// ───────────── Закрытый ключ (хранится только на сервере) ─────────────

export type PartKey =
  | { partId: string; format: 'SINGLE_CHOICE'; skillTags: string[]; correctOptionId: string }
  | { partId: string; format: 'MULTI_SELECT'; skillTags: string[]; correctOptionIds: string[] }
  | { partId: string; format: 'NUMERIC'; skillTags: string[]; correctValue: number; tolerance: number; integer: boolean }
  | { partId: string; format: 'MATCHING'; skillTags: string[]; correctPairs: Record<string, string> }
  | { partId: string; format: 'ORDERING'; skillTags: string[]; correctOrder: string[] };

export interface PrivateKey {
  parts: PartKey[];
  /** Непрозрачный id → семантический ключ (для ревью и контрольных примеров). */
  semanticMap: Record<string, string>;
}

export interface PrivateTaskInstance {
  familyId: string;
  familyVersion: number;
  specialization: SpecializationCode;
  groupCode: string;
  grade: GradeCode;
  seed: string;
  /** Отпечаток значимых условий без учёта порядка вариантов. */
  fingerprint: string;
  skillTags: string[];
  /** Оценка структурной сложности экземпляра (для анализа разброса вариантов). */
  complexity: number;
  public: PublicTask;
  key: PrivateKey;
}

// ───────────── Ответы ─────────────

export type PartAnswer =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: number }
  | { pairs: Record<string, string> }
  | { order: string[] };

export interface ItemAnswer {
  parts: Record<string, PartAnswer | null | undefined>;
}

export interface PartEvaluation {
  partId: string;
  format: AnswerFormat;
  answered: boolean;
  correct: boolean;
  score: 0 | 1;
  skillTags: string[];
}

export interface ItemEvaluation {
  parts: PartEvaluation[];
  earned: number;
  total: number;
}

// ───────────── Семейство ─────────────

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  sample<T>(items: readonly T[], count: number): T[];
  bool(probability?: number): boolean;
}

export interface FamilyDefinition<P = unknown> {
  id: string;
  version: number;
  specialization: SpecializationCode;
  group: string;
  title: string;
  /** Что проверяет семейство (для отчёта покрытия и документации). */
  description: string;
  supportedGrades: GradeCode[];
  skillTags: string[];
  /** Чем отличаются грейды — по рассуждению и условиям, а не по размеру чисел. */
  gradeNotes: Record<GradeCode, string>;
  /** Случайные параметры для грейда (детерминированно от rng). */
  sample(rng: Rng, grade: GradeCode): P;
  /** Детерминированная сборка задания по параметрам. */
  build(params: P, grade: GradeCode): AuthoredTask;
  /** Каноническое представление значимых условий для отпечатка. По умолчанию — сами параметры. */
  canonical?(params: P, grade: GradeCode): unknown;
  /** Структурная сложность экземпляра (число шагов, ловушек и т. п.). */
  complexity?(params: P, grade: GradeCode): number;
}

/** Совместимое с ТЗ название контракта семейства. */
export type AssessmentFamily<P = unknown> = FamilyDefinition<P>;

/**
 * Семейство с произвольным типом параметров. Реестр хранит разнородные семейства; параметры видны только
 * самому семейству (sample → build/canonical/complexity вызываются только в паре), поэтому здесь нужен any.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFamilyDefinition = FamilyDefinition<any>;
