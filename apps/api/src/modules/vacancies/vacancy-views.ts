import { getSkill, getSpecialization, INDUSTRIES, titleOf } from '../../domain/catalog/catalog';
import type { MatchingFormula } from '../../config/policies';
import {
  mandatoryViolations,
  rankForNeed,
  REJECTION_TEXTS,
  type MatchCandidate,
  type MatchExplanation,
  type NeedSpec,
} from '../../domain/matching/rank';
import type { Company, Vacancy } from '../../generated/prisma/client';
import { needSpecOf } from '../hiring-needs/hiring-needs.service';

type PreferredSkill = { skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' };

export interface VacancyCompanySnapshot {
  name: string;
  industry: string | null;
  industryTitle: string | null;
  website: string | null;
  description: string | null;
  contactType: string | null;
  contactValue: string | null;
}

/** Снимок вакансии и компании, который сохраняется в отклике: правки и закрытие вакансии историю отклика не меняют. */
export interface VacancySnapshot {
  title: string;
  description: string;
  specialization: string;
  allowedGrades: string[];
  requiredSkills: string[];
  workFormat: string;
  city: string | null;
  salaryFrom: number;
  salaryTo: number;
  company: VacancyCompanySnapshot;
}

export function companySnapshotOf(company: Company): VacancyCompanySnapshot {
  return {
    name: company.name,
    industry: company.industry,
    industryTitle: company.industry ? titleOf(INDUSTRIES, company.industry) : null,
    website: company.website,
    description: company.description,
    contactType: company.contactChannelType,
    contactValue: company.contactValue,
  };
}

export function vacancySnapshotOf(vacancy: Vacancy, company: Company): VacancySnapshot {
  return {
    title: vacancy.title,
    description: vacancy.description,
    specialization: vacancy.specializationCode,
    allowedGrades: vacancy.allowedGrades,
    requiredSkills: vacancy.requiredSkills,
    workFormat: vacancy.workFormat,
    city: vacancy.city,
    salaryFrom: vacancy.salaryFrom,
    salaryTo: vacancy.salaryTo,
    company: companySnapshotOf(company),
  };
}

export const vacancySpecOf = (vacancy: Vacancy): NeedSpec => needSpecOf(vacancy);

/** Требования вакансии для показа (кандидату и работодателю). */
export function vacancyRequirements(vacancy: Vacancy) {
  const preferred = (vacancy.preferredSkills as unknown as PreferredSkill[]) ?? [];
  return {
    specialization: vacancy.specializationCode,
    specializationTitle: getSpecialization(vacancy.specializationCode)?.title ?? vacancy.specializationCode,
    allowedGrades: vacancy.allowedGrades,
    requiredSkills: vacancy.requiredSkills.map((code) => ({ code, title: getSkill(code)?.title ?? code })),
    preferredSkills: preferred.map((p) => ({ code: p.skill, title: getSkill(p.skill)?.title ?? p.skill, mode: p.mode })),
    workFormat: vacancy.workFormat,
    city: vacancy.city,
    salaryFrom: vacancy.salaryFrom,
    salaryTo: vacancy.salaryTo,
    salaryType: 'GROSS' as const,
  };
}

export interface FitView {
  /** Все обязательные условия вакансии выполнены (по подтверждённым данным кандидата). */
  passes: boolean;
  /** Какие обязательные условия не выполнены — на понятном языке. */
  violations: string[];
  /** Оценка соответствия 0–100 (только если условия выполнены); относительная мера, не вероятность найма. */
  score: number | null;
  explanation: MatchExplanation | null;
}

/**
 * Соответствие кандидата требованиям вакансии — тем же правилом, что и подбор по потребности (rank-v1).
 * Отклик не блокируется несоответствием: кандидат сам проявляет инициативу, а работодатель видит, что именно не подтверждено.
 * Видимость профиля в поиске здесь не проверяется: откликнувшийся кандидат выбрал раскрыться этой компании сам.
 */
export function evaluateFit(candidate: MatchCandidate, spec: NeedSpec, formula: MatchingFormula, withExplanation: boolean): FitView {
  const subject: MatchCandidate = { ...candidate, discoverable: true };
  const violations = mandatoryViolations(subject, spec);
  const ranked = violations.length === 0 ? rankForNeed([subject], spec, formula).ranked[0] : undefined;
  return {
    passes: violations.length === 0,
    violations: violations.map((v) => REJECTION_TEXTS[v]),
    score: ranked?.score ?? null,
    explanation: withExplanation ? (ranked?.explanation ?? null) : null,
  };
}
