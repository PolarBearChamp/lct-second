import {
  getSkill,
  GRADE_TITLES,
  INDUSTRIES,
  SOFT_SKILLS,
  TEAM_ROLES,
  TIMEZONES,
  titleOf,
  type GradeCode,
} from '../catalog/catalog';
import { getSpecialization } from '../catalog/catalog';
import { isRelevantAchievement, achievementOutcome } from '../matching/fsp-relevance';

/**
 * Единый сервис представления профиля кандидата.
 *
 * Режимы:
 *  - OWNER — владелец видит все свои данные;
 *  - EMPLOYER_REDACTED — обезличенная карточка до выдачи доступа: только явно перечисленные структурированные поля;
 *  - EMPLOYER_GRANTED — после принятия приглашения: дополнительно ФИО, разрешённые каналы связи, ссылки, описание опыта.
 *
 * DTO собираются из явного списка разрешённых полей, а не фильтрацией ORM-объекта, поэтому
 * новое поле в БД не попадёт наружу случайно. Тот же результат используется для PDF.
 */

export type ProfileViewMode = 'OWNER' | 'EMPLOYER_REDACTED' | 'EMPLOYER_GRANTED';

export interface ProfileSource {
  id: string;
  alias: string;
  fullName: string | null;
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  city: string | null;
  timezone: string | null;
  workFormats: string[];
  availability: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  industries: string[];
  activeSpecializationCode: string | null;
  declaredGrade: string | null;
  experienceMonths: number | null;
  teamRoles: string[];
  experienceDescription: string | null;
  softSkills: string[];
  externalLinks: string[];
  showSalaryToEmployers: boolean;
  showFspToEmployers: boolean;
  skills: Array<{ skillCode: string; months: number | null }>;
  updatedAt: Date;
}

export interface QualificationSource {
  specializationCode: string;
  confirmedGrade: string;
  overallScore: number;
  groupScores: unknown;
  skillEvidence: unknown;
  confirmedAt: Date;
  nextReassessmentAt: Date;
  policyVersion: string;
}

export interface FspSource {
  state: string;
  linkedAt: Date;
  lastSuccessfulSyncAt: Date | null;
  externalId: string;
  achievements: Array<{
    externalId: string;
    eventTitle: string | null;
    discipline: string | null;
    eventLevel: string | null;
    eventDate: Date | null;
    participationType: string | null;
    place: number | null;
    teamRole: string | null;
    skillTags: string[];
    isDemo: boolean;
  }>;
}

export interface GrantSource {
  channels: string[];
  grantedAt: Date;
}

export interface SkillView {
  code: string;
  title: string;
  /** Источник: SELF_REPORTED — указано кандидатом; VERIFIED — проверено тестом. */
  source: 'SELF_REPORTED' | 'VERIFIED';
  months: number | null;
}

export interface SkillEvidenceView {
  skill: string;
  title: string;
  score: number;
  cases: number;
  status: 'CONFIRMED' | 'BELOW_THRESHOLD' | 'INSUFFICIENT_DATA';
}

export interface QualificationView {
  specialization: string;
  specializationTitle: string;
  grade: string;
  gradeTitle: string;
  overallScore: number;
  groupScores: Array<{ group: string; title: string; score: number }>;
  skillEvidence: SkillEvidenceView[];
  confirmedAt: string;
}

export interface AchievementView {
  /** Обезличенные поля доступны во всех режимах. */
  discipline: string | null;
  participationType: string | null;
  eventLevel: string | null;
  place: number | null;
  outcome: 'WIN' | 'PRIZE' | 'PARTICIPATION';
  year: number | null;
  skillTags: Array<{ code: string; title: string }>;
  relevantToSpecialization: boolean;
  isDemo: boolean;
  /** Только OWNER и EMPLOYER_GRANTED. */
  eventTitle?: string | null;
  eventDate?: string | null;
  teamRole?: string | null;
}

export interface CandidateProfileView {
  mode: ProfileViewMode;
  candidateId: string;
  /** «Кандидат A17F». */
  displayName: string;
  alias: string;
  specialization: { code: string; title: string } | null;
  qualification: QualificationView | null;
  declaredGrade: { code: string; title: string } | null;
  experienceMonths: number | null;
  city: string | null;
  workFormats: string[];
  salaryExpectation: { from: number | null; to: number | null; currency: 'RUB'; period: 'MONTH'; gross: true } | null;
  industries: Array<{ code: string; title: string }>;
  teamRoles: Array<{ code: string; title: string }>;
  softSkills: Array<{ code: string; title: string }>;
  skills: SkillView[];
  fsp: { linked: boolean; state: string | null; achievements: AchievementView[]; demoNotice: string | null };
  /** Только EMPLOYER_GRANTED и OWNER. */
  personal?: {
    fullName: string | null;
    timezone: string | null;
    externalLinks: string[];
    experienceDescription: string | null;
  };
  /** Только EMPLOYER_GRANTED (выбранные кандидатом каналы) и OWNER (все). */
  contacts?: Array<{ channel: 'EMAIL' | 'PHONE' | 'MESSENGER'; value: string }>;
  grant?: { grantedAt: string; channels: string[] };
  updatedAt: string;
}

const codeTitles = (codes: string[], list: Array<{ code: string; title: string }>) =>
  codes.map((code) => ({ code, title: titleOf(list, code) }));

function parseGroupScores(value: unknown): Array<{ group: string; title: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((g): g is { group: string; title: string; score: number } => !!g && typeof g === 'object' && 'group' in g && 'score' in g)
    .map((g) => ({ group: String(g.group), title: String(g.title ?? g.group), score: Number(g.score) }));
}

function parseSkillEvidence(value: unknown): SkillEvidenceView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is SkillEvidenceView => !!s && typeof s === 'object' && 'skill' in s && 'status' in s)
    .map((s) => ({
      skill: String(s.skill),
      title: getSkill(String(s.skill))?.title ?? String(s.skill),
      score: Number(s.score),
      cases: Number(s.cases),
      status: s.status,
    }));
}

export const FSP_DEMO_NOTICE =
  'Демонстрационная интеграция: достижения синтетические и не подтверждены Федерацией спортивного программирования.';

export function buildProfileView(
  mode: ProfileViewMode,
  profile: ProfileSource,
  qualification: QualificationSource | null,
  fsp: FspSource | null,
  grant: GrantSource | null = null,
): CandidateProfileView {
  const isOwner = mode === 'OWNER';
  const isGranted = mode === 'EMPLOYER_GRANTED';
  if (isGranted && !grant) throw new Error('EMPLOYER_GRANTED требует действующего доступа');

  const specCode = profile.activeSpecializationCode;
  const spec = specCode ? getSpecialization(specCode) : undefined;
  // Квалификация показывается только по активной специализации.
  const activeQualification = qualification && qualification.specializationCode === specCode ? qualification : null;
  const evidence = activeQualification ? parseSkillEvidence(activeQualification.skillEvidence) : [];
  const verified = new Set(evidence.filter((e) => e.status === 'CONFIRMED').map((e) => e.skill));

  const skills: SkillView[] = profile.skills
    .map((s) => ({
      code: s.skillCode,
      title: getSkill(s.skillCode)?.title ?? s.skillCode,
      source: verified.has(s.skillCode) ? ('VERIFIED' as const) : ('SELF_REPORTED' as const),
      months: s.months,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  // Навыки, подтверждённые тестом, но не указанные кандидатом, тоже показываются как проверенные.
  for (const skill of verified) {
    if (!skills.some((s) => s.code === skill)) {
      skills.push({ code: skill, title: getSkill(skill)?.title ?? skill, source: 'VERIFIED', months: null });
    }
  }

  const showFsp = isOwner || profile.showFspToEmployers;
  const achievements: AchievementView[] =
    fsp && showFsp
      ? fsp.achievements
          .map((a) => {
            const base: AchievementView = {
              discipline: a.discipline,
              participationType: a.participationType,
              eventLevel: a.eventLevel,
              place: a.place,
              outcome: achievementOutcome(a.place),
              year: a.eventDate ? a.eventDate.getUTCFullYear() : null,
              skillTags: a.skillTags.map((code) => ({ code, title: getSkill(code)?.title ?? code })),
              relevantToSpecialization: specCode ? isRelevantAchievement(a.discipline, specCode, a.teamRole) : false,
              isDemo: a.isDemo,
            };
            if (isOwner || isGranted) {
              base.eventTitle = a.eventTitle;
              base.eventDate = a.eventDate ? a.eventDate.toISOString().slice(0, 10) : null;
              base.teamRole = a.teamRole;
            }
            return base;
          })
          .sort((x, y) => (y.year ?? 0) - (x.year ?? 0))
      : [];

  const showSalary = isOwner || profile.showSalaryToEmployers;
  const view: CandidateProfileView = {
    mode,
    candidateId: profile.id,
    displayName: isOwner || isGranted ? (profile.fullName ?? `Кандидат ${profile.alias}`) : `Кандидат ${profile.alias}`,
    alias: profile.alias,
    specialization: spec ? { code: spec.code, title: spec.title } : null,
    qualification: activeQualification
      ? {
          specialization: activeQualification.specializationCode,
          specializationTitle: spec?.title ?? activeQualification.specializationCode,
          grade: activeQualification.confirmedGrade,
          gradeTitle: GRADE_TITLES[activeQualification.confirmedGrade as GradeCode] ?? activeQualification.confirmedGrade,
          overallScore: activeQualification.overallScore,
          groupScores: parseGroupScores(activeQualification.groupScores),
          skillEvidence: evidence,
          confirmedAt: activeQualification.confirmedAt.toISOString(),
        }
      : null,
    declaredGrade: profile.declaredGrade
      ? { code: profile.declaredGrade, title: GRADE_TITLES[profile.declaredGrade as GradeCode] ?? profile.declaredGrade }
      : null,
    experienceMonths: profile.experienceMonths,
    city: profile.city,
    workFormats: profile.workFormats,
    salaryExpectation:
      showSalary && (profile.salaryFrom !== null || profile.salaryTo !== null)
        ? { from: profile.salaryFrom, to: profile.salaryTo, currency: 'RUB', period: 'MONTH', gross: true }
        : null,
    industries: codeTitles(profile.industries, INDUSTRIES),
    teamRoles: codeTitles(profile.teamRoles, TEAM_ROLES),
    softSkills: codeTitles(profile.softSkills, SOFT_SKILLS),
    skills,
    fsp: {
      linked: Boolean(fsp) && showFsp,
      state: fsp && showFsp ? fsp.state : null,
      achievements,
      demoNotice: fsp && showFsp && fsp.achievements.some((a) => a.isDemo) ? FSP_DEMO_NOTICE : null,
    },
    updatedAt: profile.updatedAt.toISOString(),
  };

  if (isOwner || isGranted) {
    view.personal = {
      fullName: profile.fullName,
      timezone: profile.timezone ? titleOf(TIMEZONES, profile.timezone) : null,
      externalLinks: [...profile.externalLinks],
      experienceDescription: profile.experienceDescription,
    };
    const allowed = new Set(isOwner ? ['EMAIL', 'PHONE', 'MESSENGER'] : grant!.channels);
    const contacts: CandidateProfileView['contacts'] = [];
    if (allowed.has('EMAIL') && profile.contactEmail) contacts.push({ channel: 'EMAIL', value: profile.contactEmail });
    if (allowed.has('PHONE') && profile.phone) contacts.push({ channel: 'PHONE', value: profile.phone });
    if (allowed.has('MESSENGER') && profile.messenger) contacts.push({ channel: 'MESSENGER', value: profile.messenger });
    view.contacts = contacts;
  }
  if (isGranted && grant) view.grant = { grantedAt: grant.grantedAt.toISOString(), channels: [...grant.channels] };
  return view;
}
