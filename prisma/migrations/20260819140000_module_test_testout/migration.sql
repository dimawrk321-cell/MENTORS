-- Заход C.1: экстерн становится явной настройкой теста.
--
-- Обратная совместимость: обе колонки NOT NULL с DEFAULT, повторяющим прежнее
-- поведение — экстерн был доступен всегда (решал только гейтинг курса), порог
-- жил код-константой TESTOUT_THRESHOLD = 90. Поэтому существующие строки после
-- миграции ведут себя ровно как до неё, и данных-фикса не требуется.
ALTER TABLE "module_tests"
  ADD COLUMN "testout_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "testout_threshold" INTEGER NOT NULL DEFAULT 90;
