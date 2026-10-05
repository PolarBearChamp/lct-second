import type { MatchingFormula } from '../../config/policies';
import type { SpecializationCode } from '../catalog/catalog';

/**
 * Версионируемый справочник релевантности достижений ФСП специализациям (fsp-relevance-v1).
 * Дисциплина задаёт круг специализаций; если в записи указана роль в команде,
 * релевантность сужается до специализаций этой роли.
 */
export const FSP_RELEVANCE_VERSION = 'fsp-relevance-v1';

export const FSP_DISCIPLINES: Array<{ code: string; title: string; specializations: SpecializationCode[] }> = [
  { code: 'PRODUCT', title: 'Продуктовое программирование', specializations: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] },
  { code: 'ALGORITHMIC', title: 'Алгоритмическое программирование', specializations: ['BACKEND', 'ML_ENGINEER'] },
  { code: 'SECURITY', title: 'Программирование систем информационной безопасности', specializations: ['BACKEND', 'MANUAL_QA'] },
  { code: 'ROBOTICS', title: 'Программирование робототехники', specializations: ['ML_ENGINEER'] },
  { code: 'UAV', title: 'Программирование беспилотных авиационных систем', specializations: ['ML_ENGINEER', 'BACKEND'] },
];

export const FSP_TEAM_ROLES: Array<{ code: string; title: string; specializations: SpecializationCode[] | null }> = [
  { code: 'FRONTEND', title: 'Frontend-разработчик', specializations: ['FRONTEND'] },
  { code: 'BACKEND', title: 'Backend-разработчик', specializations: ['BACKEND'] },
  { code: 'FULLSTACK', title: 'Fullstack-разработчик', specializations: ['FRONTEND', 'BACKEND'] },
  { code: 'ML', title: 'ML-инженер', specializations: ['ML_ENGINEER'] },
  { code: 'QA', title: 'Тестировщик', specializations: ['MANUAL_QA'] },
  { code: 'CAPTAIN', title: 'Капитан', specializations: null },
];

export const FSP_EVENT_LEVELS: Array<{ code: string; title: string }> = [
  { code: 'INTERNATIONAL', title: 'Международный' },
  { code: 'NATIONAL', title: 'Всероссийский' },
  { code: 'INTERREGIONAL', title: 'Межрегиональный' },
  { code: 'REGIONAL', title: 'Региональный' },
];

export const FSP_PARTICIPATION_TYPES: Array<{ code: string; title: string }> = [
  { code: 'INDIVIDUAL', title: 'Личное участие' },
  { code: 'TEAM', title: 'Командное участие' },
];

export type AchievementOutcome = 'WIN' | 'PRIZE' | 'PARTICIPATION';

/** Победа — 1 место, призёр — 2–3 место, иначе — участие (в том числе, если место неизвестно). */
export function achievementOutcome(place: number | null): AchievementOutcome {
  if (place === 1) return 'WIN';
  if (place === 2 || place === 3) return 'PRIZE';
  return 'PARTICIPATION';
}

export function isRelevantAchievement(discipline: string | null, specialization: string, teamRole?: string | null): boolean {
  const disc = FSP_DISCIPLINES.find((d) => d.code === discipline);
  if (!disc || !disc.specializations.includes(specialization as SpecializationCode)) return false;
  const role = FSP_TEAM_ROLES.find((r) => r.code === teamRole);
  if (role?.specializations) return role.specializations.includes(specialization as SpecializationCode);
  return true;
}

export interface FspAchievementFacts {
  externalId: string;
  eventId: string | null;
  discipline: string | null;
  place: number | null;
  teamRole: string | null;
}

export interface FspEvidence {
  /** 0..1 */
  value: number;
  points: number;
  relevantEvents: number;
  totalAchievements: number;
}

/**
 * Ограниченный бонус ФСП: участие — 1, призёр — 2, победа — 3 балла; по одному мероприятию
 * учитывается сильнейшая запись; нормировка min(sum / normalizer, 1). Нерелевантные записи не дают бонуса.
 */
export function fspEvidence(achievements: FspAchievementFacts[], specialization: string, formula: MatchingFormula): FspEvidence {
  const best = new Map<string, number>();
  for (const a of achievements) {
    if (!isRelevantAchievement(a.discipline, specialization, a.teamRole)) continue;
    const outcome = achievementOutcome(a.place);
    const points =
      outcome === 'WIN' ? formula.fsp.winPoints : outcome === 'PRIZE' ? formula.fsp.prizePoints : formula.fsp.participationPoints;
    const eventKey = a.eventId ?? `record:${a.externalId}`;
    best.set(eventKey, Math.max(best.get(eventKey) ?? 0, points));
  }
  const points = [...best.values()].reduce((sum, p) => sum + p, 0);
  return {
    value: Math.min(points / formula.fsp.normalizer, 1),
    points,
    relevantEvents: best.size,
    totalAchievements: achievements.length,
  };
}

export const disciplineTitle = (code: string | null) => FSP_DISCIPLINES.find((d) => d.code === code)?.title ?? code ?? '—';
export const eventLevelTitle = (code: string | null) => FSP_EVENT_LEVELS.find((l) => l.code === code)?.title ?? code ?? '—';
