-- Сигналы честности прохождения теста (ответ организаторов FTT.4): счётчики интерфейса, итог оценки и время первого сохранения ответа.
-- На баллы и грейд не влияют.

-- AlterTable
ALTER TABLE "AssessmentAnswer" ADD COLUMN     "firstSavedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AssessmentAttempt" ADD COLUMN     "copyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "focusLossCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "integrity" JSONB,
ADD COLUMN     "pasteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tabHiddenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tabHiddenMs" INTEGER NOT NULL DEFAULT 0;

-- Счётчики неотрицательны; время со скрытой вкладкой не больше суток (защита от мусорных значений).
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_integrity_counters_check" CHECK (
  "tabHiddenCount" >= 0 AND "pasteCount" >= 0 AND "copyCount" >= 0 AND "focusLossCount" >= 0 AND "tabHiddenMs" >= 0 AND "tabHiddenMs" <= 86400000
);

-- У уже сохранённых ответов время первого сохранения — время последнего (точнее неизвестно).
UPDATE "AssessmentAnswer" SET "firstSavedAt" = "savedAt" WHERE "firstSavedAt" IS NULL;
