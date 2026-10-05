import type { AssessmentPolicy } from '../../config/policies';
import { getGroup, GRADE_ORDER, skillTitle, type GradeCode } from '../catalog/catalog';
import type { ItemEvaluation } from './types';

export interface ScoredItemInput {
  groupCode: string;
  evaluation: ItemEvaluation;
}

export interface GroupScore {
  group: string;
  title: string;
  /** 0..100, целое (округление вниз). */
  score: number;
  items: number;
  earnedParts: number;
  totalParts: number;
}

export type SkillEvidenceStatus = 'CONFIRMED' | 'BELOW_THRESHOLD' | 'INSUFFICIENT_DATA';

export interface SkillEvidence {
  skill: string;
  title: string;
  /** 0..100, доля верных частей с этим навыком. */
  score: number;
  /** Число разных кейсов (мини-кейсов), в которых навык оценивался. */
  cases: number;
  parts: number;
  status: SkillEvidenceStatus;
}

export interface AttemptScore {
  groups: GroupScore[];
  /** Среднее трёх групп, 0..100, округление вниз. */
  overall: number;
  passed: boolean;
  confident: boolean;
  skills: SkillEvidence[];
  failedGroups: string[];
}

const floorScore = (value: number) => Math.floor(value + 1e-9);

/**
 * Подсчёт результата попытки.
 *  - Балл кейса = доля верных частей; балл группы = среднее кейсов группы × 100.
 *  - Общий балл — среднее трёх групп.
 *  - Прохождение: общий ≥ passOverall и каждая группа ≥ passGroupMin.
 *  - «Уверенно»: общий ≥ confidentOverall и каждая группа ≥ confidentGroupMin.
 *  - Навык подтверждён, если он оценён минимум в skillEvidence.minCases кейсах и результат ≥ minScore.
 */
export function scoreAttempt(items: ScoredItemInput[], groupOrder: string[], policy: AssessmentPolicy): AttemptScore {
  const exactGroupScores = new Map<string, number>();
  const groups: GroupScore[] = groupOrder.map((groupCode) => {
    const groupItems = items.filter((item) => item.groupCode === groupCode);
    const exact = groupItems.length
      ? (100 * groupItems.reduce((sum, item) => sum + (item.evaluation.total ? item.evaluation.earned / item.evaluation.total : 0), 0)) /
        groupItems.length
      : 0;
    exactGroupScores.set(groupCode, exact);
    return {
      group: groupCode,
      title: getGroup(groupCode)?.title ?? groupCode,
      score: floorScore(exact),
      items: groupItems.length,
      earnedParts: groupItems.reduce((sum, item) => sum + item.evaluation.earned, 0),
      totalParts: groupItems.reduce((sum, item) => sum + item.evaluation.total, 0),
    };
  });

  const overallExact = groupOrder.length
    ? groupOrder.reduce((sum, code) => sum + (exactGroupScores.get(code) ?? 0), 0) / groupOrder.length
    : 0;
  const overall = floorScore(overallExact);
  const failedGroups = groups.filter((g) => g.score < policy.passGroupMin).map((g) => g.group);
  const passed = overall >= policy.passOverall && failedGroups.length === 0;
  const confident = passed && overall >= policy.confidentOverall && groups.every((g) => g.score >= policy.confidentGroupMin);

  return { groups, overall, passed, confident, skills: skillEvidence(items, policy), failedGroups };
}

export function skillEvidence(items: ScoredItemInput[], policy: AssessmentPolicy): SkillEvidence[] {
  const stats = new Map<string, { earned: number; parts: number; cases: Set<number> }>();
  items.forEach((item, itemIndex) => {
    for (const part of item.evaluation.parts) {
      for (const tag of part.skillTags) {
        const entry = stats.get(tag) ?? { earned: 0, parts: 0, cases: new Set<number>() };
        entry.earned += part.score;
        entry.parts += 1;
        entry.cases.add(itemIndex);
        stats.set(tag, entry);
      }
    }
  });
  return [...stats.entries()]
    .map(([skill, entry]) => {
      const score = floorScore((100 * entry.earned) / entry.parts);
      const cases = entry.cases.size;
      const status: SkillEvidenceStatus =
        cases < policy.skillEvidence.minCases
          ? 'INSUFFICIENT_DATA'
          : score >= policy.skillEvidence.minScore
            ? 'CONFIRMED'
            : 'BELOW_THRESHOLD';
      return { skill, title: skillTitle(skill), score, cases, parts: entry.parts, status };
    })
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

export interface Recommendation {
  kind: 'STUDY_GROUP' | 'STUDY_SKILL' | 'NEXT_GRADE' | 'RETRY_LOWER_GRADE' | 'RETRY_SAME_GRADE';
  message: string;
  grade?: GradeCode;
}

const NEXT_GRADE: Record<GradeCode, GradeCode | null> = { JUNIOR: 'MIDDLE', MIDDLE: 'SENIOR', SENIOR: null };
const LOWER_GRADE: Record<GradeCode, GradeCode | null> = { JUNIOR: null, MIDDLE: 'JUNIOR', SENIOR: 'MIDDLE' };

/** Рекомендации после теста. Высокий балл не присваивает следующий грейд — только предлагает отдельную проверку. */
export function recommendationsFor(score: AttemptScore, grade: GradeCode, policy: AssessmentPolicy): Recommendation[] {
  const result: Recommendation[] = [];
  for (const group of score.groups) {
    if (group.score < policy.confidentGroupMin) {
      result.push({ kind: 'STUDY_GROUP', message: `Повторите тему «${group.title}» (результат ${group.score} из 100).` });
    }
  }
  const weakSkills = score.skills.filter((s) => s.status === 'BELOW_THRESHOLD').map((s) => s.title);
  if (weakSkills.length) {
    result.push({ kind: 'STUDY_SKILL', message: `Навыки ниже порога подтверждения: ${weakSkills.join(', ')}.` });
  }
  if (score.confident && NEXT_GRADE[grade]) {
    result.push({
      kind: 'NEXT_GRADE',
      grade: NEXT_GRADE[grade]!,
      message: `Результат уверенный. Вы можете отдельно пройти оценку на уровень ${NEXT_GRADE[grade]} после даты, когда станет доступна новая оценка.`,
    });
  }
  if (!score.passed) {
    const lower = LOWER_GRADE[grade];
    if (lower) {
      result.push({
        kind: 'RETRY_LOWER_GRADE',
        grade: lower,
        message: `Можно сразу пройти тест на уровень ${lower}, если для него нет действующего ограничения.`,
      });
    }
    result.push({
      kind: 'RETRY_SAME_GRADE',
      grade,
      message: `Повторить тест на уровень ${grade} можно через ${policy.retryCooldownHours} ч.`,
    });
  }
  return result;
}

export const isHigherGrade = (a: GradeCode, b: GradeCode) => GRADE_ORDER[a] > GRADE_ORDER[b];
