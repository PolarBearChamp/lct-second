-- Рекомендации организаторов (встреча с участниками): кандидаты без подтверждённого грейда в выдаче, адресные задания,
-- добровольная метка доверия компании, кандидаты 16–17 лет.

-- CreateEnum
CREATE TYPE "TaskAssignmentSource" AS ENUM ('ROTATION', 'DIRECT');

-- CreateEnum
CREATE TYPE "CompanyVerificationStatus" AS ENUM ('NOT_REQUESTED', 'VERIFIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'GUARDIAN_CONSENT';

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "guardianName" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "inn" TEXT,
ADD COLUMN     "verificationChecks" JSONB,
ADD COLUMN     "verificationStatus" "CompanyVerificationStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "verifiedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "minorConditionsAcknowledged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SelectionResult" ADD COLUMN     "gradeConfirmed" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "score" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SelectionRun" ADD COLUMN     "totalUnconfirmed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "assignedByUserId" UUID,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" "TaskAssignmentSource" NOT NULL DEFAULT 'ROTATION';

-- Ограничения, которые не выражаются в Prisma Schema.

-- «Не более одного неотвеченного задания» относится только к регулярным предложениям; адресные от работодателя — сверх него.
DROP INDEX "TaskAssignment_one_offered_per_candidate";
CREATE UNIQUE INDEX "TaskAssignment_one_offered_per_candidate" ON "TaskAssignment" ("candidateId") WHERE "status" = 'OFFERED' AND "source" = 'ROTATION';

-- Адресное задание всегда знает отправителя.
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_direct_sender_check" CHECK ("source" <> 'DIRECT' OR "assignedByUserId" IS NOT NULL);

-- Балл подбора есть ровно у кандидатов с подтверждённым грейдом.
ALTER TABLE "SelectionResult" ADD CONSTRAINT "SelectionResult_score_tier_check" CHECK (("gradeConfirmed" AND "score" IS NOT NULL) OR (NOT "gradeConfirmed" AND "score" IS NULL));

-- ИНН юрлица (10 цифр) или ИП (12 цифр).
ALTER TABLE "Company" ADD CONSTRAINT "Company_inn_format_check" CHECK ("inn" IS NULL OR "inn" ~ '^([0-9]{10}|[0-9]{12})$');
