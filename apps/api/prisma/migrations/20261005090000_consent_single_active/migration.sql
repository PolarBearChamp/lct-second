-- У пользователя не более одного действующего (не отозванного) согласия каждого типа.
-- Защищает от двойного клика по переключателю публикации: параллельная вставка получит unique violation,
-- а решение «согласие действует» не зависит от порядка записей с одинаковой меткой времени.
CREATE UNIQUE INDEX "ConsentRecord_one_active_per_type"
  ON "ConsentRecord" ("userId", "type")
  WHERE "withdrawnAt" IS NULL;
