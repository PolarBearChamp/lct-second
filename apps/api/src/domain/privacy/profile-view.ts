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
import { isMinor } from '../candidate/age';

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

/** Дополнительные данные для показа нескольких категорий кандидата. */
export interface ProfileViewExtras {
  /** Специализация, по которой показывается квалификация (по умолчанию — активная). */
  focusSpecialization?: string | null;
  /** Все подтверждённые квалификации кандидата (показанная исключается автоматически). */
  otherQualifications?: QualificationSource[];
}

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
  birthDate: Date | null;
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
  /** Итог оценки сигналов честности попытки, подтвердившей квалификацию (JSON попытки). */
  integrity?: unknown;
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
  /** Как проходилась попытка: информация, на грейд не влияет. null — оценки нет (старые попытки). */
  integrity: { level: 'NONE' | 'NOTE' | 'ATTENTION'; signals: Array<{ code: string; severity: 'NOTE' | 'ATTENTION'; text: string; value: number }> } | null;
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
  /** Остальные подтверждённые категории кандидата (кроме показанной в `qualification`). */
  otherCategories: Array<{ specialization: string; specializationTitle: string; grade: string; gradeTitle: string; overallScore: number }>;
  experienceMonths: number | null;
  /** 16–17 лет (во всех режимах: работодателю нужно для законного предложения). Дата рождения не раскрывается. */
  minor: boolean;
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

/** Сводка сигналов без счётчиков: работодателю и в PDF — только уровень и нейтральные формулировки. */
export function parseIntegrity(value: unknown): QualificationView['integrity'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { level?: unknown; signals?: unknown };
  if (raw.level !== 'NONE' && raw.level !== 'NOTE' && raw.level !== 'ATTENTION') return null;
  const signals = Array.isArray(raw.signals)
    ? raw.signals
        .filter((s): s is { code: string; severity: 'NOTE' | 'ATTENTION'; text: string; value: number } => !!s && typeof s === 'object' && 'code' in s && 'text' in s)
        .map((s) => ({ code: String(s.code), severity: s.severity === 'ATTENTION' ? ('ATTENTION' as const) : ('NOTE' as const), text: String(s.text), value: Number(s.value) }))
    : [];
  return { level: raw.level, signals };
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
  extras: ProfileViewExtras = {},
): CandidateProfileView {
  const isOwner = mode === 'OWNER';
  const isGranted = mode === 'EMPLOYER_GRANTED';
  if (isGranted && !grant) throw new Error('EMPLOYER_GRANTED требует действующего доступа');

  // Показанная категория — активная специализация или явно выбранная (карточка по потребности другой специализации).
  const specCode = extras.focusSpecialization ?? profile.activeSpecializationCode;
  const spec = specCode ? getSpecialization(specCode) : undefined;
  const isActiveFocus = specCode === profile.activeSpecializationCode;
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
          integrity: parseIntegrity(activeQualification.integrity),
        }
      : null,
    otherCategories: (extras.otherQualifications ?? [])
      .filter((q) => q.specializationCode !== specCode)
      .map((q) => ({
        specialization: q.specializationCode,
        specializationTitle: getSpecialization(q.specializationCode)?.title ?? q.specializationCode,
        grade: q.confirmedGrade,
        gradeTitle: GRADE_TITLES[q.confirmedGrade as GradeCode] ?? q.confirmedGrade,
        overallScore: q.overallScore,
      })),
    // Заявленный грейд относится к активной специализации; для другой категории он не показывается.
    declaredGrade: profile.declaredGrade && isActiveFocus
      ? { code: profile.declaredGrade, title: GRADE_TITLES[profile.declaredGrade as GradeCode] ?? profile.declaredGrade }
      : null,
    experienceMonths: profile.experienceMonths,
    minor: isMinor(profile.birthDate, new Date()),
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
