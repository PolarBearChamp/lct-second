-- CreateEnum
CREATE TYPE "ShortTaskKind" AS ENUM ('QUIZ', 'APPROACH');

-- CreateEnum
CREATE TYPE "ShortTaskStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaskAssignmentStatus" AS ENUM ('OFFERED', 'SUBMITTED', 'SKIPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaskVerdict" AS ENUM ('STRONG', 'ACCEPTABLE', 'WEAK');

-- CreateTable
CREATE TABLE "ShortTask" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "allowedGrades" "Grade"[],
    "kind" "ShortTaskKind" NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER,
    "explanation" TEXT,
    "status" "ShortTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "deadlineAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShortTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "TaskAssignmentStatus" NOT NULL DEFAULT 'OFFERED',
    "offeredAt" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "answerText" TEXT,
    "selectedIndex" INTEGER,
    "isCorrect" BOOLEAN,
    "submittedAt" TIMESTAMPTZ(3),
    "skippedAt" TIMESTAMPTZ(3),
    "verdict" "TaskVerdict",
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortTask_companyId_status_idx" ON "ShortTask"("companyId", "status");

-- CreateIndex
CREATE INDEX "ShortTask_status_specializationCode_publishedAt_idx" ON "ShortTask"("status", "specializationCode", "publishedAt");

-- CreateIndex
CREATE INDEX "TaskAssignment_candidateId_offeredAt_idx" ON "TaskAssignment"("candidateId", "offeredAt");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_status_submittedAt_idx" ON "TaskAssignment"("taskId", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_candidateId_key" ON "TaskAssignment"("taskId", "candidateId");

-- AddForeignKey
ALTER TABLE "ShortTask" ADD CONSTRAINT "ShortTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortTask" ADD CONSTRAINT "ShortTask_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ShortTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ограничения, которые не выражаются в Prisma Schema.

-- QUIZ: 2–6 вариантов и верный индекс внутри диапазона; APPROACH: без вариантов.
ALTER TABLE "ShortTask" ADD CONSTRAINT "ShortTask_kind_check" CHECK (
  ("kind" = 'QUIZ' AND cardinality("options") BETWEEN 2 AND 6 AND "correctIndex" IS NOT NULL AND "correctIndex" >= 0 AND "correctIndex" < cardinality("options"))
  OR ("kind" = 'APPROACH' AND cardinality("options") = 0 AND "correctIndex" IS NULL)
);

-- Не более одного неотвеченного задания на кандидата — ограничение держится даже при параллельных запросах.
CREATE UNIQUE INDEX "TaskAssignment_one_offered_per_candidate" ON "TaskAssignment" ("candidateId") WHERE "status" = 'OFFERED';

-- Ответ присутствует ровно у отправленных заданий.
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_answer_check" CHECK (
  ("status" = 'SUBMITTED' AND "submittedAt" IS NOT NULL AND ("answerText" IS NOT NULL OR "selectedIndex" IS NOT NULL))
  OR ("status" <> 'SUBMITTED' AND "submittedAt" IS NULL AND "answerText" IS NULL AND "selectedIndex" IS NULL)
);
