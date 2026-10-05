import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { getSkill, GRADE_TITLES, isKnownSkill, type GradeCode } from '../../domain/catalog/catalog';
import { fspEvidence } from '../../domain/matching/fsp-relevance';
import {
  mandatoryViolations,
  MATCHING_ALGORITHM_VERSION,
  paginate,
  rankBank,
  rankForNeed,
  REJECTION_TEXTS,
  type BankFilters,
  type MatchCandidate,
  type MatchExplanation,
  type Refinements,
  type RejectionReason,
} from '../../domain/matching/rank';
import type { Company, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { needSpecOf, needView } from '../hiring-needs/hiring-needs.service';
import { HiringNeedsService } from '../hiring-needs/hiring-needs.service';
import { ProfileViewService } from '../profile-view/profile-view.service';
import { MatchingRepository } from './matching.repository';

export interface CandidateSummary {
  candidateId: string;
  alias: string;
  displayName: string;
  specialization: string;
  grade: GradeCode;
  gradeTitle: string;
  overallScore: number;
  groupScores: Array<{ group: string; title: string; score: number }>;
  verifiedSkills: Array<{ code: string; title: string }>;
  selfReportedSkillsCount: number;
  city: string | null;
  workFormats: string[];
  salary: { from: number | null; to: number | null } | null;
  salaryHidden: boolean;
  fsp: { achievements: number; relevantEvents: number; points: number };
  bookmarked: boolean;
  activeInvitation: { id: string; status: string } | null;
  hasContactAccess: boolean;
}

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MatchingRepository,
    private readonly policies: PolicyService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly needs: HiringNeedsService,
    private readonly views: ProfileViewService,
  ) {}

  /** Краткие карточки (без контактов и персональных данных) с состоянием отношений компании и кандидата. */
  private async summaries(company: Company, candidates: MatchCandidate[]): Promise<Map<string, CandidateSummary>> {
    const ids = candidates.map((c) => c.candidateId);
    const [bookmarks, invitations, grants] = await Promise.all([
      this.prisma.candidateBookmark.findMany({ where: { companyId: company.id, candidateId: { in: ids } }, select: { candidateId: true } }),
      this.prisma.invitation.findMany({
        where: { companyId: company.id, candidateId: { in: ids }, status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, candidateId: true, status: true },
      }),
      this.prisma.contactAccessGrant.findMany({ where: { companyId: company.id, candidateId: { in: ids }, revokedAt: null }, select: { candidateId: true } }),
    ]);
    const bookmarked = new Set(bookmarks.map((b) => b.candidateId));
    const granted = new Set(grants.map((g) => g.candidateId));
    const invitationOf = new Map<string, { id: string; status: string }>();
    for (const inv of invitations) if (!invitationOf.has(inv.candidateId)) invitationOf.set(inv.candidateId, { id: inv.id, status: inv.status });
    const formula = this.policies.matching;
    const result = new Map<string, CandidateSummary>();
    for (const c of candidates) {
      const q = c.qualification;
      if (!q) continue;
      const fsp = fspEvidence(c.fspAchievements, q.specialization, formula);
      result.set(c.candidateId, {
        candidateId: c.candidateId,
        alias: c.alias,
        displayName: `Кандидат ${c.alias}`,
        specialization: q.specialization,
        grade: q.grade,
        gradeTitle: GRADE_TITLES[q.grade],
        overallScore: q.overallScore,
        groupScores: q.groupScores,
        verifiedSkills: q.verifiedSkills.map((code) => ({ code, title: getSkill(code)?.title ?? code })),
        selfReportedSkillsCount: c.selfReportedSkills.filter((s) => !q.verifiedSkills.includes(s)).length,
        city: c.city,
        workFormats: c.workFormats,
        salary: c.salary,
        salaryHidden: c.salaryHidden,
        fsp: { achievements: c.fspAchievements.length, relevantEvents: fsp.relevantEvents, points: fsp.points },
        bookmarked: bookmarked.has(c.candidateId),
        activeInvitation: invitationOf.get(c.candidateId) ?? null,
        hasContactAccess: granted.has(c.candidateId),
      });
    }
    return result;
  }

  // ───────────────────────────── Общий банк ─────────────────────────────

  async bank(company: Company, filters: BankFilters, page: number, pageSize: number) {
    for (const skill of filters.skills ?? []) {
      if (!isKnownSkill(skill)) throw unprocessable('UNKNOWN_SKILL', `Навыка нет в справочнике: ${skill}`);
    }
    const started = process.hrtime.bigint();
    const candidates = await this.repository.load({ specialization: filters.specialization });
    const ranked = rankBank(candidates, filters, this.policies.matching);
    const pageItems = paginate(ranked, page, pageSize);
    const byId = new Map(candidates.map((c) => [c.candidateId, c]));
    const summaries = await this.summaries(company, pageItems.items.map((r) => byId.get(r.candidateId)!));
    return {
      ...pageItems,
      items: pageItems.items.map((r) => ({ ...summaries.get(r.candidateId)!, bankScore: r.bankScore, category: `${r.specialization}:${r.grade}` })),
      formulaVersion: this.policies.matching.version,
      sorting: 'Категория (специализация → грейд Senior→Junior), внутри категории: 95·балл теста + 5·бонус ФСП',
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    };
  }

  // ───────────────────────────── Карточка кандидата ─────────────────────────────

  async candidate(company: Company, userId: string, candidateId: string, needId: string | undefined, requestId: string) {
    const view = await this.views.employerView(company.id, candidateId);
    const [bookmark, invitations] = await Promise.all([
      this.prisma.candidateBookmark.findUnique({ where: { companyId_candidateId: { companyId: company.id, candidateId } } }),
      this.prisma.invitation.findMany({
        where: { companyId: company.id, candidateId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, title: true, createdAt: true, expiresAt: true },
      }),
    ]);
    let match: { needId: string; needTitle: string; passes: boolean; violations: string[]; score: number | null; explanation: MatchExplanation | null } | null = null;
    if (needId) {
      const need = await this.needs.getOwn(company, needId);
      const [candidate] = await this.repository.load({ ids: [candidateId], prefilter: false });
      if (candidate) {
        const spec = needSpecOf(need);
        const violations = mandatoryViolations(candidate, spec);
        const ranked = rankForNeed([candidate], spec, this.policies.matching);
        match = {
          needId: need.id,
          needTitle: need.title,
          passes: violations.length === 0,
          violations: violations.map((v: RejectionReason) => REJECTION_TEXTS[v]),
          score: ranked.ranked[0]?.score ?? null,
          explanation: ranked.ranked[0]?.explanation ?? null,
        };
      }
    }
    if (view.mode === 'EMPLOYER_GRANTED') {
      await this.audit.record({ actorUserId: userId, action: 'candidate.granted_profile_viewed', objectType: 'CandidateProfile', objectId: candidateId, requestId });
    }
    return {
      profile: view,
      bookmarked: Boolean(bookmark),
      invitations: invitations.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
      match,
    };
  }

  // ───────────────────────────── Подборки по потребности ─────────────────────────────

  async createSelection(company: Company, userId: string, needId: string, refinements: Refinements, parentRunId: string | undefined, requestId: string) {
    const need = await this.needs.getOwn(company, needId);
    if (need.status === 'ARCHIVED') throw unprocessable('NEED_ARCHIVED', 'Потребность в архиве — восстановите её, чтобы построить подборку');
    for (const skill of refinements.extraRequiredSkills ?? []) {
      if (!isKnownSkill(skill)) throw unprocessable('UNKNOWN_SKILL', `Навыка нет в справочнике: ${skill}`);
    }
    if (parentRunId) {
      const parent = await this.prisma.selectionRun.findFirst({ where: { id: parentRunId, companyId: company.id, needId } });
      if (!parent) throw notFound('SELECTION_NOT_FOUND', 'Исходная подборка не найдена');
    }
    const formula = this.policies.matching;
    const started = process.hrtime.bigint();
    const candidates = await this.repository.load({ specialization: need.specializationCode });
    const spec = needSpecOf(need);
    const result = rankForNeed(candidates, spec, formula, refinements);
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const now = this.clock.now();

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.selectionRun.create({
        data: {
          companyId: company.id,
          needId: need.id,
          needVersion: need.version,
          needSnapshot: needView(need) as unknown as Prisma.InputJsonValue,
          filters: refinements as unknown as Prisma.InputJsonValue,
          formulaVersion: formula.version,
          formulaSnapshot: { ...formula, algorithm: MATCHING_ALGORITHM_VERSION } as unknown as Prisma.InputJsonValue,
          parentRunId: parentRunId ?? null,
          createdByUserId: userId,
          createdAt: now,
          totalConsidered: result.considered,
          totalMatched: result.ranked.length,
          rejectionSummary: { reasons: result.rejections, requiredSkills: result.rejectedBySkill } as unknown as Prisma.InputJsonValue,
          durationMs,
        },
      });
      if (result.ranked.length) {
        // В снимок попадают только безопасные компоненты и объяснения — без контактов и персональных данных.
        await tx.selectionResult.createMany({
          data: result.ranked.map((r) => ({
            runId: created.id,
            candidateId: r.candidateId,
            rank: r.rank,
            score: r.score,
            components: r.explanation.components as unknown as Prisma.InputJsonValue,
            explanation: r.explanation as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      await this.audit.recordTx(tx, {
        actorUserId: userId,
        action: 'selection.created',
        objectType: 'SelectionRun',
        objectId: created.id,
        requestId,
        metadata: { needId: need.id, needVersion: need.version, matched: result.ranked.length, formula: formula.version },
      });
      return created;
    });
    return this.getSelection(company, run.id, 1, 20);
  }

  async listSelections(company: Company, needId: string) {
    await this.needs.getOwn(company, needId);
    const runs = await this.prisma.selectionRun.findMany({
      where: { companyId: company.id, needId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return runs.map((run) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      needVersion: run.needVersion,
      formulaVersion: run.formulaVersion,
      filters: run.filters,
      parentRunId: run.parentRunId,
      totalConsidered: run.totalConsidered,
      totalMatched: run.totalMatched,
    }));
  }

  /**
   * Сохранённая подборка. При каждом открытии заново проверяются права: кандидат, который сейчас скрыт,
   * показывается как недоступный без сохранённых деталей. Контакты в снимках не хранятся вовсе.
   */
  async getSelection(company: Company, runId: string, page: number, pageSize: number) {
    const run = await this.prisma.selectionRun.findFirst({ where: { id: runId, companyId: company.id } });
    if (!run) throw notFound('SELECTION_NOT_FOUND', 'Подборка не найдена');
    const total = await this.prisma.selectionResult.count({ where: { runId } });
    const results = await this.prisma.selectionResult.findMany({
      where: { runId },
      orderBy: { rank: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const current = await this.repository.load({ ids: results.map((r) => r.candidateId), prefilter: false });
    const visible = current.filter((c) => c.discoverable);
    const summaries = await this.summaries(company, visible);
    const need = await this.prisma.hiringNeed.findUnique({ where: { id: run.needId } });
    const rejection = run.rejectionSummary as { reasons: Record<RejectionReason, number>; requiredSkills: Record<string, number> };
    return {
      id: run.id,
      needId: run.needId,
      needVersion: run.needVersion,
      currentNeedVersion: need?.version ?? null,
      needSnapshot: run.needSnapshot,
      filters: run.filters,
      formulaVersion: run.formulaVersion,
      formula: run.formulaSnapshot,
      parentRunId: run.parentRunId,
      createdAt: run.createdAt.toISOString(),
      totalConsidered: run.totalConsidered,
      totalMatched: run.totalMatched,
      durationMs: run.durationMs,
      emptyReasons:
        run.totalMatched === 0
          ? Object.entries(rejection.reasons)
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => ({ reason, text: REJECTION_TEXTS[reason as RejectionReason], count }))
              .sort((a, b) => b.count - a.count)
          : [],
      rejectedBySkill: Object.entries(rejection.requiredSkills ?? {}).map(([skill, count]) => ({ skill, title: getSkill(skill)?.title ?? skill, count })),
      page,
      pageSize,
      total,
      items: results.map((r) => {
        const summary = summaries.get(r.candidateId);
        if (!summary) return { rank: r.rank, unavailable: true as const };
        return { rank: r.rank, unavailable: false as const, score: r.score, candidate: summary, explanation: r.explanation as unknown as MatchExplanation };
      }),
    };
  }

  // ───────────────────────────── Закладки ─────────────────────────────

  async addBookmark(company: Company, candidateId: string) {
    const [candidate] = await this.repository.load({ ids: [candidateId], prefilter: false });
    const hasGrant = Boolean(await this.views.activeGrant(candidateId, company.id));
    if (!candidate || (!candidate.discoverable && !hasGrant)) throw notFound('CANDIDATE_NOT_FOUND', 'Кандидат не найден или недоступен');
    await this.prisma.candidateBookmark.upsert({
      where: { companyId_candidateId: { companyId: company.id, candidateId } },
      create: { companyId: company.id, candidateId, createdAt: this.clock.now() },
      update: {},
    });
    return { candidateId, bookmarked: true };
  }

  async removeBookmark(company: Company, candidateId: string) {
    await this.prisma.candidateBookmark.deleteMany({ where: { companyId: company.id, candidateId } });
    return { candidateId, bookmarked: false };
  }

  /** Закладки с актуальной видимостью: скрытые кандидаты — без деталей. */
  async bookmarks(company: Company) {
    const bookmarks = await this.prisma.candidateBookmark.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' } });
    const current = await this.repository.load({ ids: bookmarks.map((b) => b.candidateId), prefilter: false });
    const summaries = await this.summaries(company, current.filter((c) => c.discoverable));
    const grants = await this.prisma.contactAccessGrant.findMany({
      where: { companyId: company.id, candidateId: { in: bookmarks.map((b) => b.candidateId) }, revokedAt: null },
      select: { candidateId: true },
    });
    const granted = new Set(grants.map((g) => g.candidateId));
    return bookmarks.map((b) => {
      const summary = summaries.get(b.candidateId);
      return summary
        ? { candidateId: b.candidateId, createdAt: b.createdAt.toISOString(), unavailable: false as const, candidate: summary }
        : { candidateId: b.candidateId, createdAt: b.createdAt.toISOString(), unavailable: true as const, hasContactAccess: granted.has(b.candidateId) };
    });
  }
}
