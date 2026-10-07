-- Вакансии и самостоятельные отклики кандидатов.
-- Часть ограничений не выражается средствами Prisma Schema и задана явно в конце файла.

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SENT', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "ContactAccessGrant" ADD COLUMN     "sourceApplicationId" UUID,
ALTER COLUMN "sourceInvitationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "needId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "allowedGrades" "Grade"[],
    "requiredSkills" TEXT[],
    "preferredSkills" JSONB NOT NULL,
    "workFormat" "WorkFormat" NOT NULL,
    "city" TEXT,
    "salaryFrom" INTEGER NOT NULL,
    "salaryTo" INTEGER NOT NULL,
    "status" "VacancyStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "vacancyId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SENT',
    "coverNote" TEXT,
    "vacancySnapshot" JSONB NOT NULL,
    "vacancyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "viewedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "actorUserId" UUID,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vacancy_companyId_status_idx" ON "Vacancy"("companyId", "status");

-- CreateIndex
CREATE INDEX "Vacancy_status_specializationCode_publishedAt_idx" ON "Vacancy"("status", "specializationCode", "publishedAt");

-- CreateIndex
CREATE INDEX "Application_candidateId_status_idx" ON "Application"("candidateId", "status");

-- CreateIndex
CREATE INDEX "Application_vacancyId_status_createdAt_idx" ON "Application"("vacancyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Application_companyId_status_idx" ON "Application"("companyId", "status");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_occurredAt_idx" ON "ApplicationEvent"("applicationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_needId_fkey" FOREIGN KEY ("needId") REFERENCES "HiringNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Инварианты, которые Prisma описать не может.

-- 1. Не более одного активного отклика кандидата на вакансию: двойной клик и параллельные запросы получат unique violation.
CREATE UNIQUE INDEX "Application_one_active_per_pair"
  ON "Application" ("vacancyId", "candidateId")
  WHERE "status" IN ('SENT', 'VIEWED', 'SHORTLISTED');

-- 2. Доступ к контактам выдан либо принятием приглашения, либо самостоятельным откликом — но не «ниоткуда».
ALTER TABLE "ContactAccessGrant"
  ADD CONSTRAINT "ContactAccessGrant_source_check"
  CHECK ("sourceInvitationId" IS NOT NULL OR "sourceApplicationId" IS NOT NULL);

-- 3. Корректная зарплатная вилка вакансии (как у потребности и приглашения).
ALTER TABLE "Vacancy"
  ADD CONSTRAINT "Vacancy_salary_range_check"
  CHECK ("salaryFrom" > 0 AND "salaryTo" > 0 AND "salaryFrom" <= "salaryTo");

-- 4. Фильтры списка вакансий: опубликованные по специализации и формату.
CREATE INDEX "Vacancy_published_listing_idx" ON "Vacancy" ("specializationCode", "workFormat", "publishedAt" DESC) WHERE "status" = 'PUBLISHED';
