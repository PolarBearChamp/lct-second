-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CANDIDATE', 'EMPLOYER');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('JUNIOR', 'MIDDLE', 'SENIOR');

-- CreateEnum
CREATE TYPE "WorkFormat" AS ENUM ('REMOTE', 'HYBRID', 'OFFICE');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'PHONE', 'MESSENGER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_PROCESSING', 'PROFILE_PUBLICATION');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QualificationEventType" AS ENUM ('CONFIRMED', 'RECONFIRMED', 'RAISED', 'LOWERED_BY_CHOICE');

-- CreateEnum
CREATE TYPE "HiringNeedStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FspLinkState" AS ENUM ('LINKED_WITH_HISTORY', 'LINKED_WITHOUT_HISTORY', 'SYNC_ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "withdrawnAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialization" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "catalogVersion" TEXT NOT NULL,

    CONSTRAINT "Specialization_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CompetencyGroup" (
    "code" TEXT NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CompetencyGroup_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Skill" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "specializationCodes" TEXT[],
    "catalogVersion" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "fullName" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "messenger" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "workFormats" "WorkFormat"[],
    "availability" "Availability" NOT NULL DEFAULT 'ACTIVE',
    "salaryFrom" INTEGER,
    "salaryTo" INTEGER,
    "industries" TEXT[],
    "activeSpecializationCode" TEXT,
    "declaredGrade" "Grade",
    "experienceMonths" INTEGER,
    "teamRoles" TEXT[],
    "experienceDescription" TEXT,
    "softSkills" TEXT[],
    "externalLinks" TEXT[],
    "isDiscoverable" BOOLEAN NOT NULL DEFAULT false,
    "showSalaryToEmployers" BOOLEAN NOT NULL DEFAULT true,
    "showFspToEmployers" BOOLEAN NOT NULL DEFAULT true,
    "disclosureChannels" "ContactChannel"[],
    "survey" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "candidateId" UUID NOT NULL,
    "skillCode" TEXT NOT NULL,
    "months" INTEGER,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("candidateId","skillCode")
);

-- CreateTable
CREATE TABLE "CandidateQualification" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "confirmedGrade" "Grade" NOT NULL,
    "attemptId" UUID NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "groupScores" JSONB NOT NULL,
    "skillEvidence" JSONB NOT NULL,
    "verifiedSkills" TEXT[],
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "nextReassessmentAt" TIMESTAMPTZ(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CandidateQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationHistory" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "eventType" "QualificationEventType" NOT NULL,
    "grade" "Grade" NOT NULL,
    "previousGrade" "Grade",
    "attemptId" UUID NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "groupScores" JSONB NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QualificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "specializationCode" TEXT NOT NULL,
    "requestedGrade" "Grade" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "blueprintVersion" TEXT NOT NULL,
    "bankVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "clientRequestId" TEXT,
    "overallScore" INTEGER,
    "groupScores" JSONB,
    "skillEvidence" JSONB,
    "confident" BOOLEAN,
    "qualificationGranted" BOOLEAN NOT NULL DEFAULT false,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentItem" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "groupCode" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "familyVersion" INTEGER NOT NULL,
    "grade" "Grade" NOT NULL,
    "seed" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "skillTags" TEXT[],
    "publicSnapshot" JSONB NOT NULL,
    "privateKey" JSONB NOT NULL,

    CONSTRAINT "AssessmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAnswer" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "contactPersonName" TEXT,
    "contactChannelType" TEXT,
    "contactValue" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringNeed" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
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
    "status" "HiringNeedStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HiringNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "needId" UUID NOT NULL,
    "needVersion" INTEGER NOT NULL,
    "needSnapshot" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "formulaSnapshot" JSONB NOT NULL,
    "parentRunId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "totalConsidered" INTEGER NOT NULL,
    "totalMatched" INTEGER NOT NULL,
    "rejectionSummary" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "SelectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "components" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,

    CONSTRAINT "SelectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateBookmark" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "needId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "salaryFrom" INTEGER NOT NULL,
    "salaryTo" INTEGER NOT NULL,
    "workFormat" "WorkFormat" NOT NULL,
    "employerContactType" "ContactChannel" NOT NULL,
    "employerContact" TEXT NOT NULL,
    "companySnapshot" JSONB NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "viewedAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "clientRequestId" TEXT,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationEvent" (
    "id" UUID NOT NULL,
    "invitationId" UUID NOT NULL,
    "actorUserId" UUID,
    "fromStatus" "InvitationStatus",
    "toStatus" "InvitationStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "InvitationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAccessGrant" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "channels" "ContactChannel"[],
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "sourceInvitationId" UUID NOT NULL,

    CONSTRAINT "ContactAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FspLink" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "state" "FspLinkState" NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSyncAttemptAt" TIMESTAMPTZ(3),
    "lastSuccessfulSyncAt" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,

    CONSTRAINT "FspLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FspAchievement" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventId" TEXT,
    "eventTitle" TEXT,
    "discipline" TEXT,
    "eventLevel" TEXT,
    "eventDate" DATE,
    "participationType" TEXT,
    "place" INTEGER,
    "teamRole" TEXT,
    "skillTags" TEXT[],
    "source" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FspAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FspLinkCodeRedemption" (
    "codeHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "candidateId" UUID NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FspLinkCodeRedemption_pkey" PRIMARY KEY ("codeHash")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_createdAt_idx" ON "EmailVerificationToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_type_idx" ON "ConsentRecord"("userId", "type");

-- CreateIndex
CREATE INDEX "CompetencyGroup_specializationCode_idx" ON "CompetencyGroup"("specializationCode");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_alias_key" ON "CandidateProfile"("alias");

-- CreateIndex
CREATE INDEX "CandidateProfile_activeSpecializationCode_isDiscoverable_av_idx" ON "CandidateProfile"("activeSpecializationCode", "isDiscoverable", "availability");

-- CreateIndex
CREATE INDEX "CandidateSkill_skillCode_idx" ON "CandidateSkill"("skillCode");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateQualification_attemptId_key" ON "CandidateQualification"("attemptId");

-- CreateIndex
CREATE INDEX "CandidateQualification_specializationCode_confirmedGrade_idx" ON "CandidateQualification"("specializationCode", "confirmedGrade");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateQualification_candidateId_specializationCode_key" ON "CandidateQualification"("candidateId", "specializationCode");

-- CreateIndex
CREATE INDEX "QualificationHistory_candidateId_occurredAt_idx" ON "QualificationHistory"("candidateId", "occurredAt");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_candidateId_specializationCode_requestedG_idx" ON "AssessmentAttempt"("candidateId", "specializationCode", "requestedGrade", "finishedAt");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_candidateId_status_idx" ON "AssessmentAttempt"("candidateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_candidateId_clientRequestId_key" ON "AssessmentAttempt"("candidateId", "clientRequestId");

-- CreateIndex
CREATE INDEX "AssessmentItem_familyId_fingerprint_idx" ON "AssessmentItem"("familyId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentItem_attemptId_position_key" ON "AssessmentItem"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentItem_id_attemptId_key" ON "AssessmentItem"("id", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAnswer_attemptId_itemId_key" ON "AssessmentAnswer"("attemptId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_ownerUserId_key" ON "Company"("ownerUserId");

-- CreateIndex
CREATE INDEX "HiringNeed_companyId_status_idx" ON "HiringNeed"("companyId", "status");

-- CreateIndex
CREATE INDEX "SelectionRun_companyId_needId_createdAt_idx" ON "SelectionRun"("companyId", "needId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionResult_runId_candidateId_key" ON "SelectionResult"("runId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionResult_runId_rank_key" ON "SelectionResult"("runId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateBookmark_companyId_candidateId_key" ON "CandidateBookmark"("companyId", "candidateId");

-- CreateIndex
CREATE INDEX "Invitation_candidateId_status_idx" ON "Invitation"("candidateId", "status");

-- CreateIndex
CREATE INDEX "Invitation_companyId_status_createdAt_idx" ON "Invitation"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_companyId_clientRequestId_key" ON "Invitation"("companyId", "clientRequestId");

-- CreateIndex
CREATE INDEX "InvitationEvent_invitationId_occurredAt_idx" ON "InvitationEvent"("invitationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ContactAccessGrant_companyId_idx" ON "ContactAccessGrant"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAccessGrant_candidateId_companyId_key" ON "ContactAccessGrant"("candidateId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FspLink_candidateId_key" ON "FspLink"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "FspLink_provider_externalId_key" ON "FspLink"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FspAchievement_candidateId_provider_externalId_key" ON "FspAchievement"("candidateId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_idx" ON "AuditEvent"("objectType", "objectId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyGroup" ADD CONSTRAINT "CompetencyGroup_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_activeSpecializationCode_fkey" FOREIGN KEY ("activeSpecializationCode") REFERENCES "Specialization"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillCode_fkey" FOREIGN KEY ("skillCode") REFERENCES "Skill"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateQualification" ADD CONSTRAINT "CandidateQualification_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateQualification" ADD CONSTRAINT "CandidateQualification_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateQualification" ADD CONSTRAINT "CandidateQualification_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationHistory" ADD CONSTRAINT "QualificationHistory_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationHistory" ADD CONSTRAINT "QualificationHistory_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentItem" ADD CONSTRAINT "AssessmentItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_itemId_attemptId_fkey" FOREIGN KEY ("itemId", "attemptId") REFERENCES "AssessmentItem"("id", "attemptId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringNeed" ADD CONSTRAINT "HiringNeed_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringNeed" ADD CONSTRAINT "HiringNeed_specializationCode_fkey" FOREIGN KEY ("specializationCode") REFERENCES "Specialization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionRun" ADD CONSTRAINT "SelectionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionRun" ADD CONSTRAINT "SelectionRun_needId_fkey" FOREIGN KEY ("needId") REFERENCES "HiringNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionRun" ADD CONSTRAINT "SelectionRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "SelectionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionResult" ADD CONSTRAINT "SelectionResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SelectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionResult" ADD CONSTRAINT "SelectionResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateBookmark" ADD CONSTRAINT "CandidateBookmark_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateBookmark" ADD CONSTRAINT "CandidateBookmark_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_needId_fkey" FOREIGN KEY ("needId") REFERENCES "HiringNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationEvent" ADD CONSTRAINT "InvitationEvent_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAccessGrant" ADD CONSTRAINT "ContactAccessGrant_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAccessGrant" ADD CONSTRAINT "ContactAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FspLink" ADD CONSTRAINT "FspLink_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FspAchievement" ADD CONSTRAINT "FspAchievement_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
