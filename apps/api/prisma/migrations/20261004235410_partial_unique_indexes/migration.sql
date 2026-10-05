-- Явная миграция ограничений, которые не выражаются средствами Prisma Schema.

-- 1. У кандидата не более одной активной (IN_PROGRESS) попытки тестирования.
--    Защищает от конкурентного старта двух попыток: вторая вставка получит unique violation.
CREATE UNIQUE INDEX "AssessmentAttempt_one_active_per_candidate"
  ON "AssessmentAttempt" ("candidateId")
  WHERE "status" = 'IN_PROGRESS';

-- 2. Не более одного активного (SENT/VIEWED) приглашения от компании одному кандидату.
CREATE UNIQUE INDEX "Invitation_one_active_per_pair"
  ON "Invitation" ("companyId", "candidateId")
  WHERE "status" IN ('SENT', 'VIEWED');

-- 3. Индекс для фильтрации по подтверждённым навыкам.
CREATE INDEX "CandidateQualification_verifiedSkills_gin"
  ON "CandidateQualification" USING GIN ("verifiedSkills");

-- 4. Целостность значений, которые Prisma не проверяет.
ALTER TABLE "HiringNeed"
  ADD CONSTRAINT "HiringNeed_salary_range_check"
  CHECK ("salaryFrom" > 0 AND "salaryTo" > 0 AND "salaryFrom" <= "salaryTo");

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_salary_range_check"
  CHECK ("salaryFrom" > 0 AND "salaryTo" > 0 AND "salaryFrom" <= "salaryTo");

ALTER TABLE "CandidateProfile"
  ADD CONSTRAINT "CandidateProfile_salary_range_check"
  CHECK (
    ("salaryFrom" IS NULL OR "salaryFrom" > 0)
    AND ("salaryTo" IS NULL OR "salaryTo" > 0)
    AND ("salaryFrom" IS NULL OR "salaryTo" IS NULL OR "salaryFrom" <= "salaryTo")
  );

ALTER TABLE "CandidateProfile"
  ADD CONSTRAINT "CandidateProfile_experience_check"
  CHECK ("experienceMonths" IS NULL OR "experienceMonths" >= 0);

ALTER TABLE "AssessmentAnswer"
  ADD CONSTRAINT "AssessmentAnswer_revision_check"
  CHECK ("revision" >= 1);
