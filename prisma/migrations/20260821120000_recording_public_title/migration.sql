-- Заход C.6, блок 2: у записи появляется ВТОРОЙ заголовок — тот, который видит
-- ученик. Существующий `title` остаётся внутренним (команда, админ-таблица,
-- аудит), новый `public_title` — единственное название записи на ученической
-- стороне. Nullable: у единственной существующей записи стенда он будет пустым,
-- и это штатное состояние, а не «не заполнили» (см. фолбэк ниже).
ALTER TABLE "recordings" ADD COLUMN "public_title" TEXT;

-- ---------------------------------------------------------------------------
-- FTS и trgm переезжают на ученическое название.
--
-- До захода вектор строился по ВНУТРЕННЕМУ `title`, а ученику в выдаче поиска
-- показывался `ts_headline` по нему же — то есть поле, подписанное «ученику не
-- показывается», ученику как раз показывалось, и по нему же можно было
-- проверить название компании (раздел 7.9: «Названия компаний НЕ публикуются»).
-- После захода ученический поиск видит ровно то, что видит ученик на карточке.
--
-- Цена названа прямо: запись без `public_title` текстовым поиском не находится
-- (каталог с фильтрами остаётся). Раньше она находилась по словам внутреннего
-- названия — это и был дефект.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recordings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('russian', coalesce(NEW.public_title, '')), 'A');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recordings_search_vector_trg ON recordings;
CREATE TRIGGER recordings_search_vector_trg
  BEFORE INSERT OR UPDATE OF public_title ON recordings
  FOR EACH ROW EXECUTE FUNCTION recordings_search_vector_update();

-- Пересборка вектора у существующих строк: без неё в индексе остались бы слова
-- внутренних названий, и старая выдача пережила бы смену триггера.
UPDATE recordings SET search_vector =
  setweight(to_tsvector('russian', coalesce(public_title, '')), 'A');

-- trgm-фолбэк по опечаткам — по тому же полю.
DROP INDEX IF EXISTS "recordings_title_trgm_idx";
CREATE INDEX "recordings_public_title_trgm_idx" ON "recordings" USING GIN ("public_title" gin_trgm_ops);
