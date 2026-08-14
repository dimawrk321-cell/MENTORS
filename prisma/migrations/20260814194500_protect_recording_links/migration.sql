-- Interview recordings must be opened through Library so its privacy checklist,
-- watermark and access trail cannot be bypassed by a raw Я.Диск URL.
-- Keep ordinary Я.Диск lectures intact: this migration is scoped to the three
-- published legacy materials confirmed by the pilot audit.

WITH cleaned AS (
  SELECT
    id,
    regexp_replace(
      regexp_replace(
        content_md,
        E'(?im)^.*https?://(www\\.)?disk\\.yandex\\.ru/i/[^\\n]*\\r?\\n?',
        '',
        'g'
      ),
      E'(?im)^[[:space:]]*(парол(ь|я|ем)?|password|код[[:space:]]+доступа)[[:space:]]*[:=—-][^\\n]*\\r?\\n?',
      '',
      'g'
    ) AS content_md
  FROM lessons
  WHERE title = 'Шаг 3: Просмотр реального лайфкодинга'
    AND content_md ~* 'disk\\.yandex\\.ru/i/'
)
UPDATE lessons AS lesson
SET
  content_md = rtrim(cleaned.content_md) || E'\n\n:::callout{type="warning"}\nЗапись доступна только через [Библиотеку](/library). Там публикуются анонимизированные материалы после проверки согласия; прямые ссылки и пароли в уроках не показываются.\n:::',
  content_updated_at = now(),
  updated_at = now()
FROM cleaned
WHERE lesson.id = cleaned.id;

WITH cleaned AS (
  SELECT
    id,
    regexp_replace(
      regexp_replace(
        content_md,
        E'(?im)^.*https?://(www\\.)?disk\\.yandex\\.ru/i/[^\\n]*\\r?\\n?',
        '',
        'g'
      ),
      E'(?im)^[[:space:]]*(парол(ь|я|ем)?|password|код[[:space:]]+доступа)[[:space:]]*[:=—-][^\\n]*\\r?\\n?',
      '',
      'g'
    ) AS content_md
  FROM guides
  WHERE slug IN ('tehnicheskaya-chast-layfkoding', 'kak-pravilno-spisyvat')
    AND content_md ~* 'disk\\.yandex\\.ru/i/'
)
UPDATE guides AS guide
SET
  content_md = rtrim(cleaned.content_md) || E'\n\n:::callout{type="warning"}\nЗапись доступна только через [Библиотеку](/library). Там публикуются анонимизированные материалы после проверки согласия; прямые ссылки и пароли в уроках не показываются.\n:::',
  updated_at = now()
FROM cleaned
WHERE guide.id = cleaned.id;
