# MENTORS — Техническое задание на разработку образовательной платформы

Версия 1.0 · Июль 2026 · Язык продукта: русский · Документ является единственным источником требований.

---

## 0. Принципы для исполнителя (Claude Code)

1. Реализуй ровно то, что описано. Не добавляй фичи, страницы и настройки сверх ТЗ. Если что-то кажется недостающим — выбери самое простое решение, не противоречащее документу, и зафиксируй его комментарием `// DECISION:` в коде.
2. Все тексты интерфейса — на русском языке. Код, имена переменных, комментарии — на английском.
3. При противоречии разделов приоритет: раздел 7 (бизнес-логика) → раздел 8 (страницы) → остальные.
4. Порядок реализации — строго по разделу 17 (этапы). Не начинай следующий этап, пока не выполнен Definition of Done текущего (раздел 19).
5. Название бренда — из `BRAND_NAME` (env, сейчас `MENTORS`). Не хардкодить нигде: письма, тайтлы, интерфейс.
6. Время: у каждого пользователя поле `timezone` (default `Europe/Moscow`). Стрик, дневная очередь, «сегодня», слоты — отображаются и считаются в TZ пользователя. В БД всё хранится в UTC.
7. Никаких сторонних платных сервисов, кроме указанных. Никакой телеметрии наружу.
8. Мобильный экран (360–430px) — первоклассный сценарий, не «ужатый десктоп». Проверяй каждый экран на 390px.

---

## 1. Продукт

MENTORS — закрытая менторская платформа подготовки к карьере в ML / DS / NLP / AI Engineering. Ученики получают доступ вручную (оплата происходит вне платформы), учатся в своём темпе по структурированным курсам, заучивают банк из ~350–400 реальных вопросов с собеседований через систему интервальных повторений, проходят мок-интервью с живыми интервьюерами (Дима, Егор) и смотрят библиотеку из 100+ анонимизированных записей реальных собеседований.

Масштаб: сейчас 25 учеников, через год 1000+. Команда: 3 человека (Owner + 2 ментора), из них 2 интервьюера.

**Четыре кита продукта:** Обучение (курсы) · Тренажёр (повторения + каталог вопросов) · Моки (запись, проведение, фидбек) · Справочник (гайды без прогрессии). Плюс Библиотека записей собеседований.

**Сознательно НЕ входит в продукт:** приём платежей, исполнение кода в браузере, домашние задания, мультиязычность, публичный маркетинговый сайт (публична только страница логина), нативные мобильные приложения (только адаптивный веб).

**Ключевой цикл ученика (ежедневный):** зашёл → закрыл очередь повторений (~5 мин) → продолжил текущий урок → квиз → серия и дневная цель закрыты. Ошибки из тестов и моков автоматически пополняют очередь повторений — платформа сама ведёт человека по его слабым местам к готовности к собеседованию.

---

## 2. Роли и права

| Возможность | student | mentor | admin | owner |
|---|---|---|---|---|
| Проходить обучение, тренажёр, моки, библиотеку, справочник | ✅ | — | — | — |
| Создавать/редактировать контент, вопросы, гайды | — | ✅ | ✅ | ✅ |
| Видеть список и карточки учеников (прогресс, статистика) | — | ✅ | ✅ | ✅ |
| Выдавать/продлевать/блокировать доступ, сбрасывать сессии | — | — | ✅ | ✅ |
| Управлять библиотекой записей | — | ✅ | ✅ | ✅ |
| Аналитика | — | ✅ (просмотр) | ✅ | ✅ |
| Объявления | — | — | ✅ | ✅ |
| Настройки платформы, рубрики, шаблоны уведомлений | — | — | ✅ | ✅ |
| Назначать роли, видеть аудит-лог | — | — | — | ✅ |
| Режим «глазами ученика» (impersonation, read-only) | — | — | ✅ | ✅ |

Дополнительный флаг `is_interviewer` (у Owner и одного ментора): открывает кабинет интервьюера — расписание, брони, экран проведения мока, фидбек. Роль хранится в `users.role` (enum `student | mentor | admin | owner`), owner ровно один.

Ученик не видит других учеников нигде (никаких лидербордов, списков, чужих профилей).

---

## 3. Технологический стек и архитектура

| Слой | Выбор | Причина |
|---|---|---|
| Фреймворк | Next.js 15 (App Router, RSC, Server Actions), TypeScript strict | один репозиторий, SSR, скорость разработки |
| Стили | Tailwind CSS + CSS-переменные (дизайн-токены), Radix UI primitives (headless) | полный контроль над видом, темы через токены |
| Анимации | CSS transitions + Framer Motion точечно (флип карточек, ритуальные моменты) | лёгкость |
| БД | PostgreSQL 16 | FTS с русской морфологией, надёжность |
| ORM | Prisma | скорость, миграции |
| Аутентификация | Собственная: argon2id + серверные сессии в БД, httpOnly cookie | требуется контроль одновременных сессий и устройств |
| Поиск | Postgres FTS (`russian` config) + `pg_trgm` | морфология без внешнего движка |
| Формулы | KaTeX (SSR-рендер) | стандарт |
| Подсветка кода | Shiki (build-time/SSR) | качество тем |
| Markdown | unified/remark + remark-directive (кастомные блоки `:::callout` и др.) | расширяемый контент |
| Email | Nodemailer через SMTP (env), HTML-шаблоны в `/emails` | независимость от провайдера |
| Фоновые задачи | Отдельный worker-процесс (node-cron) в том же репозитории | дайджесты, мониторы, генерация слотов |
| Иконки | Lucide | монохромная эстетика |
| Тесты | Vitest — юнит-тесты бизнес-логики (SRS, XP, стрик, слоты, доступ) обязательны | это ядро продукта |
| Деплой | Docker Compose: `web` (Next.js), `worker`, `postgres`, `caddy` (TLS) — на VPS | целевая аудитория в РФ, self-hosted |

**Архитектура — модульный монолит.** Поток: Компоненты (RSC + клиентские островки) → Server Actions / Route Handlers → сервисный слой `/lib/services/*` → Prisma → PostgreSQL. Правила:

- Вся бизнес-логика — только в сервисном слое. Компоненты и actions — тонкие.
- Все значимые действия проходят через единый диспетчер доменных событий `emitEvent(type, payload)` (`/lib/services/events.ts`): он атомарно пишет `analytics_events`, начисляет XP по карте правил, обновляет стрик, проверяет достижения, создаёт уведомления. Ни один модуль не начисляет XP напрямую (раздел 7.13).
- RBAC — через `requireRole()` / `requireInterviewer()` в каждом action и layout-guard'ах групп маршрутов.
- Мутации — Server Actions; Route Handlers (`/app/api/*`) — для поиска, крон-хуков, скачиваний, вебхуков.

---

## 4. Структура папок

```
/app
  /(auth)
    /login  /forgot  /reset/[token]  /invite/[token]
  /(student)                # layout: Sidebar (desktop) + BottomNav (mobile), гард: активный ученик
    /page.tsx               # Дашборд
    /onboarding
    /courses  /courses/[slug]
    /lessons/[id]
    /tests/[moduleId]
    /trainer  /trainer/session
    /questions  /questions/[id]
    /mocks  /mocks/book  /mocks/mine  /mocks/[bookingId]
    /library  /library/[id]
    /guides  /guides/[slug]
    /profile
    /expired                # экран истёкшего доступа (единственный доступный при soft-lock)
  /(interviewer)/interviewer
    /schedule  /bookings  /run/[bookingId]
  /(admin)/admin            # гард: mentor+ (разделы фильтруются по роли)
    /page.tsx               # Пульт
    /content  /content/lessons/[id]
    /questions
    /students  /students/[id]
    /interviews             # брони, страйки, рубрики
    /library
    /analytics
    /announcements
    /settings
    /audit
    /import
  /api
    /search  /cron/[job]  /notifications/unread  /events
/components
  /ui                       # кит: Button, Card, Input, Dialog, Toast, Tabs, Skeleton, EmptyState...
  /blocks                   # рендер контента: LessonRenderer, Callout, CodeBlock, VideoEmbed, PracticeBlock, KeyQuestions
  /features                 # QuizWidget, TestRunner, ReviewSession, FlipCard, GoalRing, Heatmap, SlotPicker,
                            # RubricForm, CommandPalette, NotificationBell, Watermark, RecordingCard, ModuleTree
/lib
  /services   # auth, sessions, access, content, questions, tests, srs, xp, streak, achievements,
              # mocks, slots, library, guides, search, notifications, events, analytics, audit
  /utils      # dates(tz), markdown, validation(zod-схемы), rate-limit
/prisma       # schema.prisma, migrations, seed.ts
/worker       # index.ts + /jobs: digest, youtubeCheck, slotsGenerate, expiryNotify,
              # streakProcess, waitlistHolds, sessionCleanup, linkRotationReminder
/scripts      # import-notion.ts (одноразовый импортер, раздел 7.14)
/emails       # шаблоны писем
/styles       # tokens.css, globals.css
```

---

## 5. Дизайн-система

Философия: «сдержанность снаружи, точность внутри». Эстетика Linear / Vercel / Raycast: один акцент, волосяные границы, воздух, быстрые тихие анимации. Никаких теней-градиентов-конфетти. Тёмная тема — родная, светлая — полноправная.

### 5.1 Токены (`/styles/tokens.css`, переключение через `data-theme` на `<html>`)

| Токен | Dark | Light |
|---|---|---|
| `--bg` | `#0B0C0E` | `#FAFAF9` |
| `--surface-1` (карточки) | `#131417` | `#FFFFFF` |
| `--surface-2` (поднятые слои, поповеры) | `#1A1C20` | `#FFFFFF` + тень `0 1px 3px rgb(0 0 0 / .06)` |
| `--border` | `rgb(255 255 255 / .08)` | `rgb(0 0 0 / .07)` |
| `--border-strong` (hover) | `rgb(255 255 255 / .14)` | `rgb(0 0 0 / .12)` |
| `--text-1` | `#EDEEF0` | `#17181A` |
| `--text-2` | `#9BA0A8` | `#5F646D` |
| `--text-3` (подсказки) | `#6B7078` | `#8A8F98` |
| `--accent` | `#5E6AD2` | `#4C57C4` |
| `--accent-hover` | `#6E7ADE` | `#4450B8` |
| `--success` | `#45A26F` | `#2E8B57` |
| `--warning` | `#C9973F` | `#B07E28` |
| `--danger` | `#D25353` | `#C03E3E` |
| `--gradient-accent` | `linear-gradient(135deg,#5E6AD2,#8B5CF6)` | тот же |

Градиент разрешён ровно в трёх местах: hero-кнопка «Продолжить» на дашборде, кольцо дневной цели, анимация нового уровня. Больше нигде.

Прочее: `--radius-card: 14px; --radius-control: 10px; --radius-pill: 999px; --dur-fast: 150ms; --dur-base: 200ms; --dur-slow: 250ms; --ease: cubic-bezier(.25,.46,.45,.94)`.

Метки категорий вопросов — 8 приглушённых пар (фон 12% прозрачности + текст): индиго `#7B87E8`, бирюза `#4FB3A9`, янтарь `#C9973F`, роза `#C77394`, шалфей `#7FA86B`, небо `#5B9BD1`, лаванда `#9B7FD1`, терракота `#C87E5A`. Присваиваются категориям по порядку.

Тема по умолчанию — системная (`prefers-color-scheme`), переключатель в профиле (система/тёмная/светлая). Анти-FOUC: инлайн-скрипт в `<head>` выставляет `data-theme` до первого рендера, выбор — в `localStorage`.

### 5.2 Типографика

- Основной: **Inter** (variable, self-hosted, subset cyrillic+latin). Body 16px / line-height 1.65. Заголовки weight 600, letter-spacing −0.01em…−0.02em.
- Шкала: 12 / 13 / 14 / 16 / 18 / 24 / 32 / 44.
- Читальная колонка урока и гайдов: `max-width: 680px`.
- Код: **JetBrains Mono** 14px (self-hosted). Формулы: KaTeX (стили и шрифты self-hosted, рендер на сервере).

### 5.3 Компоненты (кит `/components/ui` + features)

Button (primary заливка / secondary контур / ghost; нажатие scale .98), Card (surface-1, hairline, hover: подъём 1px + border-strong), Input/Select/Checkbox/Switch (Radix), Dialog/Sheet (мобильная шторка), Tabs, Tooltip, Toast (угол, авто-скрытие 4с), Skeleton (геометрия контента, shimmer), EmptyState (иконка + заголовок + текст + одно действие), Badge/Tag, ProgressBar, **GoalRing** (SVG-кольцо, заполнение градиентом, при закрытии — glow 500мс + haptic), **StreakBadge** (число + дни; состояние «под угрозой» после 20:00 — warning-цвет), **Heatmap** (GitHub-стиль, 26 недель desktop / 12 mobile, 5 градаций зелёного, tooltip с датой и действиями), **FlipCard** (3D-флип 250мс, свайпы), **CommandPalette** (Cmd+K / Ctrl+K, открытие <100мс, fuzzy + серверный FTS, группы: Действия/Уроки/Вопросы/Гайды/Записи, навигация с клавиатуры), **NotificationBell** (счётчик, поповер, «прочитать всё»), **VideoEmbed** (16:9, ленивый iframe youtube-nocookie, постер до клика; состояние `unavailable` → заглушка «Видео временно недоступно — текст урока полный», без серого квадрата YouTube), **Callout** (4 типа: совет `--accent` / важное `--warning` / предупреждение `--danger` / материал `--text-2`; полоса слева 2px, фон 6%), **CodeBlock** (Shiki, тема в тон, номер строк опционально, кнопка «Копировать» — код копируется свободно), **Watermark** (см. 5.7), **ModuleTree** (дерево курса: галки завершённых, точка текущего, замки закрытых, метка «необязательный»), **SlotPicker** (вертикальный список дней с чипами времени), **RubricForm** (критерии 1–5 + вердикт + текстовые поля, автосейв черновика), **StudentImpersonationBanner** (фиксированная плашка «Вы смотрите как {имя} — только чтение», кнопка выхода).

### 5.4 Анимации

150–250мс, `--ease`, только transform/opacity. Переходы страниц: fade + сдвиг 8px. Ховеры карточек: подъём 1–2px. Списки: stagger 20мс. Ритуалы (только три): закрытие кольца цели, новый уровень, достижение — мягкий glow ≤500мс + вибрация на мобильном (Vibration API, 10мс). Скелетоны вместо спиннеров на контенте; спиннер только в кнопках. `prefers-reduced-motion: reduce` → все анимации деградируют до opacity-фейдов, флип заменяется мгновенной сменой, ритуалы отключаются.

### 5.5 Пять состояний каждого экрана

Каждый экран обязан иметь: загрузку (скелетон), пустоту, ошибку, успех, офлайн (мобильный баннер «Нет соединения», ввод не теряется). Тексты пустых состояний — человеческие приглашения:

- Дашборд новичка: «Начни с первого урока — здесь появится твой прогресс».
- Пустая очередь: «Всё повторено. Следующие карточки — {дата}».
- Нет броней: «Забронируй первый мок — интервьюеры уже ждут».
- Ошибка (везде): «Что-то пошло не так. Попробуй ещё раз» + кнопка «Повторить». Никаких кодов и стектрейсов пользователю.

### 5.6 Иконки и графика

Lucide, stroke 1.5–1.75, размер 16–20. Достижения — монохромные глифы в круге (обесцвечены до получения). Никаких эмодзи в интерфейсе (в пользовательском контенте — допустимы).

### 5.7 Водяной знак

Компонент `<Watermark email={user.email}/>`: абсолютный слой поверх области контента урока/гайда и поверх плеера библиотеки; диагональный (−30°) повтор email, `opacity: .04` (dark) / `.05` (light), `pointer-events: none`, `user-select: none`, шаг сетки ~220×140px. Рендерится сервером (email берётся из сессии), присутствует в DOM всегда — юридически различим на скриншоте, глазу почти невидим.

---

## 6. Модель данных (PostgreSQL / Prisma)

Нотация: `поле:тип` (`?` — nullable). Везде `id: cuid`, `created_at`, `updated_at`. Все FK индексируются. Enum'ы указаны на месте.

**Пользователи и доступ**
- `users`: email(unique), password_hash, name, role(`student|mentor|admin|owner`), is_interviewer:bool, timezone(default `Europe/Moscow`), theme(`system|dark|light`), track(`ds|nlp|ai`?), daily_goal_xp(30|60|120, default 60), study_days:int[] (дни недели 1–7, default [1..7]), digest_time(default `09:00`), status(`invited|active|blocked|expired`), activated_at?, access_until?, avatar_color, last_seen_at?, mentor_note:text?
- `invites`: email, token(unique), invited_by→users, expires_at(7 дней), accepted_at?
- `password_resets`: user_id, token(unique), expires_at(1 час), used_at?
- `access_extensions`: user_id, days:int, new_access_until, granted_by→users, comment?
- `sessions`: user_id, token_hash(unique), device_id→devices, ip, city?, country?, expires_at(30 дней rolling), last_active_at, impersonator_id→users? (режим «глазами ученика»)
- `devices`: user_id, fingerprint_hash, label («Chrome · macOS»), first_seen_at, last_seen_at. Уникальность (user_id, fingerprint_hash)
- `security_flags`: user_id, type(`concurrent_geo|rapid_content|manual`), details:json, status(`open|resolved`), resolved_by?

**Контент**
- `courses`: slug(unique), title, description, order, gating(`strict|recommended|free`), status(`draft|published`), icon?
- `modules`: course_id, title, order, status
- `lessons`: module_id, slug, title, order, status(`draft|published`), difficulty(`intro|base|advanced`), is_optional:bool, content_md:text, reading_minutes:int (пересчёт при сохранении: слова/180), video_url?, video_status(`ok|unavailable|unchecked`), video_checked_at?, published_at?, content_updated_at (для метки «урок обновлён»)
- `tracks` (онбординг-треки): key(`ds|nlp|ai`), title, course_ids:json (упорядоченный список)
- `lesson_progress`: user_id, lesson_id, status(`in_progress|completed`), completed_at?, scroll_pos:float?, video_pos:int?, updated_at. Уникальность (user_id, lesson_id)
- `content_reports`: user_id, lesson_id?, question_id?, block_anchor?, type(`error|unclear`), text?, status(`open|resolved`), resolved_by?

**Вопросы и тесты**
- `question_categories`: title, slug, parent_id? (подкатегории), color_index:int, order
- `questions`: type(`open|single|multi|tf|short_text`), category_id, text_md, answer_md? (эталон открытого; может содержать изображения), explanation_md? (разбор закрытого), options:json? (`[{id,text,correct}]`), accepted_answers:json? (для short_text; сравнение: trim → lower → ё=е → схлопывание пробелов), difficulty(1–3), status(`draft|published`), needs_latex:bool (флаг импортера «ответ был картинкой»), source(`import|manual`)
- `question_lessons`: question_id, lesson_id, is_key:bool (ключевой вопрос урока → в SRS при завершении), in_quiz:bool (участвует в квизе урока)
- `module_tests`: module_id(unique), pool_size:int(10–20, default 12), threshold:int(default 80), cooldown_minutes:int(default 45), enabled:bool
- `test_attempts`: user_id, module_id, kind(`module|testout`), question_ids:json (зафиксированная выборка), score:int, passed:bool, started_at, finished_at?
- `test_attempt_answers`: attempt_id, question_id, answer:json, correct:bool
- `quiz_answers`: user_id, question_id, lesson_id, correct:bool, first:bool (для разовой выдачи XP)

**SRS (повторения)**
- `srs_cards`: user_id, question_id, step:int(0–5; 5 = «выучен»), next_review_at:date, added_from(`lesson_key|test_fail|quiz_fail|mock`), lapses:int, reviews_count:int, last_grade?(`again|hard|good`), suspended:bool(default false). Уникальность (user_id, question_id)
- `srs_reviews`: card_id, grade(`again|hard|good`), reviewed_at, prev_step, new_step

**Геймификация**
- `xp_events`: user_id, type, amount:int, ref_type?, ref_id?, day:date (по TZ пользователя). Идемпотентность: уникальный индекс (user_id, type, ref_type, ref_id)
- `streaks`: user_id(unique), current:int, best:int, freezes:int(0–2), last_counted_date:date?, paused:bool (при истёкшем доступе)
- `streak_events`: user_id, date, kind(`counted|freeze_used|reset|milestone`)
- `achievements` (справочник, сидится): key, title, description, hidden:bool, icon
- `user_achievements`: user_id, achievement_key, earned_at

**Моки**
- `interviewer_profiles`: user_id(unique), room_url (постоянная комната Телемоста), bio?, photo?, active:bool
- `availability_rules`: interviewer_id, weekday(1–7), start_time, end_time, active:bool
- `availability_exceptions`: interviewer_id, date, kind(`day_off|extra`), start_time?, end_time?
- `slots`: interviewer_id, starts_at, ends_at (60 мин), status(`open|booked|closed`). Генерация — worker (7.15). Уникальность (interviewer_id, starts_at)
- `bookings`: slot_id(unique), user_id, type(`theory|legend`), status(`booked|completed|cancelled_student|cancelled_interviewer|no_show`), cancelled_at?, notes_draft:text? (заметки интервьюера, автосейв), room_url (копия на момент брони)
- `booking_strikes`: user_id, booking_id, reason(`late_cancel|no_show`), created_at
- `waitlist`: user_id, type(`theory|legend`), interviewer_id? (null = любой), until_date, status(`waiting|offered|expired|converted`), offered_slot_id?, offer_expires_at?
- `rubric_templates`: type(`theory|legend`), criteria:json (`[{key,title}]`, редактируется в админке; дефолты — 7.8)
- `feedbacks`: booking_id(unique), interviewer_id, scores:json (`{key: 1–5}`), verdict(`ready|needs_work|not_ready`), strengths:text, growth:text, recommended_lesson_ids:json, status(`draft|published`), published_at?
- `mock_question_marks`: booking_id, question_id, mark(`answered|partial|failed`)

**Библиотека записей**
- `recordings`: title, stage(`screening|theory|livecoding|soft|final`), direction(`ds|nlp|ai|classic_ml`), grade(`junior|middle|senior`), outcome(`offer|reject|unknown`), company_type(`bigtech|fintech|product|startup`), duration_minutes, url (Я.Диск), embed_url?, link_updated_at, checklist:json (`{faces:bool,voice:bool,names:bool,consent:bool}`), status(`draft|published`) — публикация возможна только при всех true, chapters:json? (V1)
- `recording_views`: recording_id, user_id, opened_at
- Флаг `library_enabled:bool` на `users` (default true) — пер-ученический тумблер раздела.

**Справочник**
- `guides`: slug, section(`tools|resume|legend|stages|ask_interviewer|job_search`), title, order, content_md, status
- `bookmarks`: user_id, guide_id. Уникальность пары

**Коммуникации**
- `notifications`: user_id, type, title, body, url?, read_at?, created_at
- `notification_prefs`: user_id, type, email:bool, inapp:bool (сид по таблице 7.12)
- `announcements`: title, body_md, kind(`banner|notification`), segment(`all|course:{id}|mock_this_week`), created_by, starts_at, ends_at?
- `announcement_reads`: announcement_id, user_id

**Служебные**
- `analytics_events`: user_id?, type, payload:json, created_at (партиционировать по месяцам не нужно в MVP; индекс (type, created_at))
- `audit_log`: actor_id, action, entity_type, entity_id, before:json?, after:json?, created_at
- `app_settings`: key(unique), value:json (правила стрика, XP-карта, дефолты гейтинга, тексты — читаются сервисами с кешем 60с)

**FTS:** materialized-колонки `search_vector tsvector` на `lessons` (title + content), `questions` (text + answer), `guides`, `recordings` (title) + триггеры обновления + GIN-индексы. Конфигурация `russian`, дополнительно `pg_trgm` GIN по title для опечаток.

---

## 7. Бизнес-логика

### 7.1 Доступ и жизненный цикл ученика

1. **Инвайт.** Админ вводит email (+имя) → создаётся `users(status=invited)` + `invites.token` → письмо со ссылкой `/invite/[token]` (токен живёт 7 дней; можно перевыслать). Ученик открывает ссылку → ставит пароль (мин. 8 символов) → `status=active`, `activated_at=now`, `access_until = activated_at + 90 дней`. Отсчёт — с первого входа, не с момента инвайта.
2. **Отображение.** В профиле спокойная строка «Доступ до {дата}». Без таймеров.
3. **Напоминания.** За 14 дней, за 3 дня и в день окончания — email + колокольчик (тон информирующий: «Доступ действует до {дата}. Чтобы продлить — напиши {контакт из настроек}»).
4. **Ограничение наперёд.** Нельзя забронировать мок со стартом позже `access_until` (валидация при брони).
5. **Истечение** (worker, ежедневно): `status=expired`. Активные сессии остаются валидными, но middleware пускает только на `/expired`. Будущие брони отменяются (`cancelled_interviewer` не подходит — используем `cancelled_student` с system-пометкой в аудит), интервьюер получает уведомление, слот открывается и уходит в waitlist. Стрик: `paused=true` (не сгорает). Прогресс, XP, история — сохраняются полностью.
6. **Экран `/expired`.** Итоги: пройдено уроков, всего XP, рекорд серии, количество моков. Сообщение «Доступ завершён» + кнопка «Продлить» (mailto/телеграм-ссылка из настроек). Уважительное прощание, не захлопнутая дверь.
7. **Продление.** В карточке ученика: «+1 месяц», «+3 месяца», «до даты». Правило: `new_access_until = max(today, access_until) + срок` — мёртвые дни не съедаются. `status=active`, `paused=false`, брони не восстанавливаются. Запись в `access_extensions` + аудит.
8. **Блокировка.** `status=blocked` — мгновенный разлогин всех сессий, вход невозможен («Аккаунт заблокирован. Свяжись с {контакт}»).

### 7.2 Аутентификация и антишаринг

- Пароли: argon2id. Сессия: случайный токен 256 бит, в cookie httpOnly+Secure+SameSite=Lax, в БД — hash. Rolling 30 дней.
- **Одна одновременная сессия.** При логине все прочие сессии пользователя удаляются. Вытесненный при следующем запросе видит экран «Вход выполнен на другом устройстве» → /login. Это главный барьер бытового шаринга.
- **Два устройства.** `device fingerprint` = hash(UA-платформа + стабильные признаки, cookie-метка device_id). Логин с 3-го устройства: вытесняется самое старое по last_seen_at, ученику — уведомление «Выполнен вход с нового устройства {label}». Список устройств и «Выйти на всех» — в профиле.
- **Гео-флаг.** При логине пишем city (GeoIP по локальной базе, без внешних вызовов). Если за 24 часа входы из разных городов > 300 км — `security_flags(concurrent_geo)` в Пульт. Повторный флаг за 7 дней → авто-`blocked` + email «Замечена подозрительная активность, напиши нам» + алерт админам.
- **Rapid-content-флаг:** > 30 завершений уроков или > 400 открытий вопросов за час → флаг (не блок).
- Rate limit: /login и /forgot — 5 попыток / 15 мин на email+IP (ответ «Слишком много попыток, подожди»); API — 120 rpm/пользователя.
- Impersonation: admin+ открывает сессию с `impersonator_id`; баннер; все мутации отклоняются middleware (403 c текстом «Режим просмотра»); действие в аудит-лог.

### 7.3 Контент: курсы, уроки, гейтинг

- Иерархия: Курс → Модуль → Урок (3 уровня). Все опубликованные курсы доступны всем активным ученикам (закрытая платформа, enrollment не нужен).
- **Гейтинг per-course:** `strict` — урок открыт, только если предыдущий завершён (внутри модуля) и предыдущий модуль закрыт (все обязательные уроки завершены + модульный тест сдан, если включён); `recommended` — всё открыто, порядок подсвечен; `free` — всё открыто. Дефолты сида: технические курсы strict, «Soft Skills» и «Classic ML» — free. `is_optional` уроки не блокируют прогрессию и помечены в дереве.
- **Test-out:** на закрытом модуле (strict) доступна кнопка «Сдать модуль экстерном» → попытка `kind=testout` из того же пула, порог 90%. Успех: модуль зачитывается (все его уроки → completed с пометкой `via testout` в analytics), XP = 100 (как за тест, XP за уроки не начисляется). Провал — обычный кулдаун.
- **Контент урока** — Markdown + директивы:
  - `:::callout{type=tip|important|warning|material}` — коллауты;
  - `:::video{url="..." title="..."}` — дополнительные видео в теле (основное — `lessons.video_url`, рендерится под шапкой);
  - `:::practice` — блок «Практика» (внешние ссылки: karpov.courses и т.п.), список внутри;
  - таблицы GFM, KaTeX (`$...$`, `$$...$$`), код с указанием языка.
- **Анатомия страницы урока (сверху вниз):** шапка (хлебные крошки, название, чипы: {reading_minutes} мин · сложность · «необязательный»), VideoEmbed (если есть), тело (колонка 680px, watermark-слой), автоблок «Ключевые вопросы урока» (is_key-вопросы: раскрывающиеся карточки вопрос→эталон; подпись «Эти вопросы попадут в твои повторения»), квиз (если есть in_quiz-вопросы, 7.5), кнопка «Завершить урок» → ритуал не нужен, тихий чек + автопереход к следующему открытому. Prev/Next. Кнопка «⚑ Нашёл ошибку / непонятно» — плавающая, диалог с типом и комментарием → `content_reports`.
- **Позиция чтения:** debounce-сохранение scroll_pos и video_pos; «Продолжить» ведёт на точное место.
- **Завершение урока:** явное действие кнопкой. При `strict` кнопка активна всегда (тест — отдельный гейт модуля). Идемпотентно. Эмитится `lesson.completed`.
- **«Урок обновлён»:** если `content_updated_at > completed_at` — бейдж в дереве и на карточке урока у прошедших.
- **Мок-уроки Soft Skills:** урок с флагом-директивой `:::mock{type=legend}` рендерит CTA «Забронировать мок» и считается завершённым автоматически после `booking.completed` соответствующего типа (проверка при завершении мока: если у пользователя есть незавершённый мок-урок этого типа — закрыть его).

### 7.4 Банк вопросов

- ~350–400 вопросов, 8 корневых категорий (Classic ML, Python, А/Б-тесты и статистика, NLP, Production, RecSys, SQL, ML System Design) + подкатегории (parent_id). Цвет — по color_index.
- Типы: `open` (вопрос + эталонный ответ, может содержать изображения; основа SRS и подготовки к мокам), `single|multi|tf|short_text` (автопроверяемые: квизы и тесты).
- Каталог ученика `/questions`: поиск, фильтры (категория, тип, сложность, «мои западающие»), карточка вопроса = FlipCard с эталоном, кнопка «В повторения» (ручное добавление в SRS, added_from=manual — разрешено).
- Привязка к урокам: `question_lessons` (+ is_key, in_quiz). Один вопрос может быть привязан к нескольким урокам.

### 7.5 Квизы и модульные тесты

**Квиз урока** (формативный): все `in_quiz` закрытые вопросы урока, максимум 7 (если больше — случайные 7). Ошибаться можно; после каждого ответа сразу показывается верно/неверно + `explanation_md`. Ничего не блокирует. XP: +5 за каждый первый правильный ответ на вопрос (`quiz_answers.first`); повторные прохождения — без XP. Неверный ответ → карточка вопроса в SRS (added_from=quiz_fail, step=0, next_review=завтра; если карточка существует — сброс на step 0).

**Модульный тест** (экзамен): pool = все закрытые опубликованные вопросы уроков модуля; выборка `pool_size` случайных, варианты перемешиваются, выборка фиксируется в attempt. Порог `threshold` (80%). Прогресс-бар «вопрос 4 из 12», без таймера. Результат:
- **Провал:** экран «{score}% — нужно {threshold}%» + список тем (категорий) с ошибками, правильные ответы НЕ показываются. Пересдача через `cooldown_minutes` (таймер на кнопке), новая выборка.
- **Успех:** экран поздравления (сдержанный) + полный разбор всех вопросов с объяснениями. XP: +100, +50 если passed с первой попытки (attempts=1).
- Каждый неверный ответ (в любой попытке) → SRS (test_fail, сброс на step 0).
- Эмиты: `test.passed|failed`.

### 7.6 SRS — интервальные повторения

Ядро продукта. Единица — карточка `srs_cards` (пользователь × вопрос).

- **Лестница интервалов (дней до следующего показа):** `STEPS = [1, 3, 7, 16, 35]`, step 0..4; step 5 = «выучен», контрольный показ раз в 90 дней.
- **Оценки:** `again` («не знаю») → step = 0, next = завтра, lapses+1; `hard` («сомневаюсь») → step не меняется, next = today + STEPS[step]; `good` («знаю») → step+1 (cap 5), next = today + STEPS[new_step] (для step 5 — +90).
- **Новая карточка:** step 0, next_review = сегодня (попадает в ближайшую очередь). Источники: завершение урока (все is_key вопросы), ошибка квиза/теста, отметка `partial|failed` на моке, ручное добавление. Если карточка уже есть — сброс на step 0 (кроме ручного добавления поверх живой карточки — no-op).
- **Дневная очередь:** карточки с `next_review_at <= today(tz)` и `suspended=false`, сортировка: просроченные раньше, затем by next_review_at. Порция сессии — 15 карточек; после порции: «Осталось ещё N — продолжить?» Новых карточек в день — не более 20 (защита от лавины после импорта прогресса; остальные сдвигаются на завтра автоматически при построении очереди).
- **Оценка времени** на дашборде: `count × 25 сек`, округление до минут.
- **Сессия** (`/trainer/session`): полноэкранная карточка: категория-метка, вопрос (markdown, KaTeX) → «Показать ответ» → флип → эталон (+ссылка «Открыть урок») → три кнопки: Не знаю / Сомневаюсь / Знаю (на мобильном — внизу, зоны ≥44px; свайпы: влево=again, вниз=hard, вправо=good). Прогресс «6 / 15». Выход в любой момент — прогресс по отвеченным сохранён.
- **Закрытие очереди** (все на сегодня отвечены): экран «Готово» + `queue.completed` → +30 XP (раз в день) + день в стрик. XP начисляется за факт закрытия, НЕ за долю «знаю» — честные ответы не наказываются.
- V1: замена планировщика на FSRS (структура srs_reviews уже пишет историю — миграция безболезненна).

### 7.7 XP, уровни, стрик, дневная цель, достижения

**Карта XP** (константа в `app_settings`, применяется диспетчером событий; идемпотентность через уникальный индекс xp_events):

| Событие | XP | Правило разовости |
|---|---|---|
| lesson.completed | 20 | на урок |
| quiz.correct_first | 5 | на вопрос |
| test.passed | 100 | на модуль (kind=module) |
| test.passed_first_try | +50 | на модуль |
| testout.passed | 100 | на модуль |
| queue.completed | 30 | на день |
| mock.completed | 200 | на бронь (независимо от вердикта) |
| streak.milestone 7/30/100 | 50/250/1000 | на веху |

**Уровни:** считаются от суммарного XP. Порог перехода: `xp_to_next(L) = round(100 × 1.15^(L−1))`, кумулятивно (L1→2: 100; →3: 215; →4: 347; …). Отображение: «Уровень 12» + прогресс-бар до следующего. UI уровней/достижений — V1; события и подсчёт — с MVP (нужны для дневной цели).

**Дневная цель:** `daily_goal_xp` 30/60/120 («лайт/норма/интенсив»), выбирается в онбординге, меняется в профиле. Кольцо на дашборде = XP за сегодня (tz) / цель. Закрытие — ритуал.

**Стрик:** день засчитан, если за день (tz) случилось ≥1 из: lesson.completed, test.passed/failed (попытка), quiz с ≥1 ответом, queue.completed. Учитываются только `study_days` пользователя (настройка «учебные дни», default все 7; исключённые дни прозрачны — не рвут и не требуют активности). Worker в 00:05 tz: если вчера (учебный день) активности не было: есть freeze → freezes−1, серия сохранена, уведомление «Серия спасена заморозкой ({N} осталось)»; нет freeze → current=0 (без уведомления — негатив не шлём). Заморозки: +1 за каждые 7 подряд засчитанных дней, cap 2. Admin может подарить заморозку из карточки. Milestone-эмиты на 7/30/100/365. `paused=true` при expired — дни не считаются вовсе.

**Достижения** (сид; hidden не показываются до получения):

| key | Название | Условие |
|---|---|---|
| first_lesson / first_module / first_course / all_courses | Первый шаг / Модуль закрыт / Курс пройден / Вся программа | соответствующие завершения |
| perfect_test | Без единой ошибки | модульный тест 100% |
| five_first_try | С первого раза ×5 | 5 модульных тестов подряд сданы с 1-й попытки |
| cards_100 / cards_1000 | Сотня / Тысяча | 100 / 1000 отвеченных карточек |
| queue_month | Железная дисциплина | 30 учебных дней подряд закрытая очередь |
| first_mock / five_mocks | Боевое крещение / Ветеран моков | 1 / 5 завершённых моков |
| ready_theory / ready_legend | Готов: теория / Готов: легенда | вердикт ready в фидбеке |
| streak_7 / 30 / 100 / 365 | Неделя / Месяц / Сотня / Год | вехи серии |
| night_shift (hidden) | Ночная смена | урок завершён 00:00–05:00 |
| combo (hidden) | Комбо | урок + тест + очередь + мок в один день |

Выдача — атомарно в диспетчере событий; toast + вибрация; страница достижений — V1 (запись earned_at ведётся с MVP).

### 7.8 Мок-интервью

**Параметры:** длительность 60 мин, буфер 15 мин → сетка слотов с шагом 75 мин. Типы: `theory` («ML-теория»), `legend» («По легенде»). Комнаты: постоянные ссылки Телемоста в `interviewer_profiles.room_url`, копируются в бронь.

**Слоты.** Интервьюер задаёт повторяющиеся окна (`availability_rules`: «вт 18:00–21:00») и исключения (day_off / extra). Worker ежедневно материализует слоты на 14 дней вперёд: окно нарезается с шага 75 мин, пока `start + 60 ≤ end` (18:00–21:00 → 18:00 и 19:15). Изменение правил пересобирает только свободные будущие слоты. «Закрыть день»: открытые слоты → closed; забронированные — брони отменяются (`cancelled_interviewer`), ученикам уведомление + их waitlist-заявка встаёт в начало очереди.

**Бронирование** (`/mocks/book`): шаг 1 — тип (две карточки); шаг 2 — интервьюер (карточки с фото/bio) или «Первый свободный» (объединённый календарь); шаг 3 — SlotPicker: 14 дней вертикально, чипы времени в tz ученика; шаг 4 — подтверждение с правилами одной строкой («Отмена бесплатна за 24 часа. Неявка — страйк»). Транзакция: `SELECT ... FOR UPDATE` слота, проверка: слот open, старт в пределах access_until, у ученика нет активной брони (status=booked, starts_at>now — правило «одна активная бронь»), нет активного booking-lock. Успех → status=booked, уведомления обоим, эмит `mock.booked`.

**Карточка активной брони** (дашборд + /mocks/mine): дата/время, тип, интервьюер, обратный отсчёт; «Подключиться» (активна за 15 мин до старта, ведёт на room_url), «Перенести» (= отмена по тем же правилам + переход к выбору слота), «Отменить».

**Отмены и страйки.** Отмена ≥24ч до старта — свободно, слот открывается → waitlist. Отмена <24ч — confirm-диалог «До мока меньше 24 часов — отмена засчитает страйк» → страйк `late_cancel`. Неявка: кнопка «Не пришёл» у интервьюера активируется через 10 мин после старта → status=no_show, страйк. 2 страйка за скользящие 60 дней → бронирование заблокировано на 14 дней (`booking-lock`; вычисляется из booking_strikes; ученик видит дату разблокировки и причину). Правила показываются до брони — сюрпризов нет.

**Waitlist.** Кнопка «Свободных слотов нет — сообщить, когда появится» создаёт заявку (тип, интервьюер?, until_date = +14 дней). При открытии слота: первая подходящая заявка → status=offered, offer_expires_at=+2 часа, уведомление с ссылкой на бронь этого слота (hold: слот в это время недоступен другим). Не воспользовался — заявка переходит к следующему; заявка expired по until_date.

**Напоминания:** за 24 ч и за 1 ч (email + колокольчик).

**Экран проведения** (`/interviewer/run/[id]`): слева — карточка ученика (прогресс по курсам, прошлые моки с вердиктами, топ западающих категорий из SRS/тестов) + заметки (автосейв в notes_draft); справа — банк вопросов с фильтром по категориям; у каждого вопроса тумблер «ответил / частично / нет» → `mock_question_marks`. Кнопка «Завершить мок» → status=completed, эмит `mock.completed` (+200 XP ученику, закрытие мок-урока Soft Skills при наличии), отметки partial|failed → SRS (сброс/добавление step 0), переход к форме фидбека.

**Фидбек.** RubricForm по `rubric_templates[type]`. Дефолтные критерии — theory: базовый ML; метрики и валидация; ансамбли; DL-основы; NLP и трансформеры; структура и коммуникация ответов. legend: связность истории; глубина деталей проектов; устойчивость к каверзным вопросам; соответствие резюме; уверенность подачи. Оценки 1–5, вердикт ready/needs_work/not_ready, «Сильные стороны», «Зоны роста», рекомендованные уроки (мультиселект). Черновик автосейвится; «Опубликовать» → ученику уведомление «Фидбек по моку готов» → страница фидбека (оценки барами, вердикт, тексты, ссылки на уроки, список вопросов с отметками). Пока фидбек draft — у ученика статус «Ожидает фидбека».

### 7.9 Библиотека записей собеседований

100+ реальных собеседований учеников, анонимизированных ДО загрузки (лица скрыты, голос изменён). Названия компаний НЕ публикуются — только company_type.

- Каталог `/library`: фильтры этап/направление/грейд/исход/тип компании, карточки (title = «{Этап} · {Направление} · {грейд}», длительность, бейдж исхода). Пер-ученический тумблер `library_enabled`.
- Просмотр `/library/[id]`: если есть embed_url — iframe с Watermark-слоем поверх; иначе кнопка «Открыть запись» (новая вкладка). Любое открытие → `recording_views` + предупреждающая строка «Запись доступна лично тебе. Передача ссылки — нарушение условий доступа».
- Загрузка (админ/ментор): форма метаданных + чеклист из 4 пунктов (лица скрыты; голос изменён; имена и названия вырезаны; согласие донора получено). Кнопка «Опубликовать» disabled, пока не отмечены все — дисциплина, встроенная в интерфейс.
- Ротация ссылок: раз в месяц админ обновляет url на Я.Диске; Пульт показывает «Записей со ссылкой старше 30 дней: N» (по link_updated_at). V1: перенос на видеохостинг с подписанными URL и водяным знаком, таймкоды-главы.
- Связки из уроков: обычные markdown-ссылки на /library/[id] (пример: урок «Просмотр реального лайфкодинга»).

### 7.10 Справочник

Разделы: Инструменты индустрии (14 карточек), Резюме (10 страниц), Легенда, Гайд по этапам собеседований, Вопросы интервьюеру (3), Поиск работы. Страница гайда = та же читальная колонка с watermark, без прогрессии и галок. Закладка (иконка) → `bookmarks`, раздел «Закладки» в /guides. Навигация: сайдбар секций (desktop) / аккордеон (mobile).

### 7.11 Поиск

- CommandPalette: Cmd+K / Ctrl+K, иконка в шапке (mobile). Открытие <100 мс (компонент преклоширован, данные лениво).
- Первый экран (без запроса): Действия («Продолжить урок», «Начать повторения», «Забронировать мок», «Мои закладки») + 5 недавно открытых.
- Запрос ≥2 символов → `/api/search?q=`: Postgres FTS (russian) по lessons/questions/guides/recordings + trgm-fallback по заголовкам при пустом FTS. Ранжирование `ts_rank`, лимит 5 на группу, подсветка `ts_headline`. Группы: Уроки · Вопросы · Гайды · Записи · Действия. Debounce 150 мс. Enter — переход, стрелки — навигация.
- Права: только published; библиотека — только при library_enabled.

### 7.12 Уведомления

Каналы MVP: email + in-app (колокольчик). V1: Telegram-бот. Принцип: лучше недослать; ни одного маркетингового пуша.

| type | Триггер | Каналы default | Opt |
|---|---|---|---|
| digest | worker, в digest_time пользователя, если очередь >0: «Сегодня к повторению: N карточек (~M мин)» | email+inapp | выключаемо |
| mock_24h / mock_1h | напоминания о моке | email+inapp | выключаемо |
| mock_feedback | фидбек опубликован | email+inapp | всегда |
| mock_cancelled / waitlist_offer | отмена интервьюером / предложен слот (действует 2 часа) | email+inapp | всегда |
| streak_risk | 20:00 tz, день не засчитан, серия ≥3 | inapp (+email off) | **opt-in**, default off |
| freeze_used | заморозка применена | inapp | всегда |
| lesson_new / lesson_updated | публикация/обновление пройденного | inapp | выключаемо |
| access_14d / 3d / 0d | окончание доступа | email+inapp | всегда |
| new_device | вход с нового устройства | email | всегда |
| announcement | объявление (kind=notification) | inapp | всегда |
| achievement (V1) | достижение | inapp | выключаемо |

Настройки: матрица тумблеров по типам×каналам + «Тихие часы» (default 22:00–08:00: in-app копятся, email откладывается). Колокольчик: поповер последних 20, «Прочитать все», клик = переход по url.

### 7.13 События, XP, аналитика

`emitEvent(type, payload, {userId})` — единая точка: (1) `analytics_events`; (2) XP по карте 7.7 (идемпотентно); (3) стрик; (4) достижения; (5) нотификации по таблице 7.12. Всё в одной транзакции с вызывающим действием.

Типы событий (минимум): auth.login, lesson.started/completed, quiz.answered, test.started/passed/failed, testout.passed, card.reviewed, queue.completed, mock.booked/cancelled/completed/no_show, feedback.published, recording.opened, guide.opened, search.performed, report.created, access.extended/expired, session.evicted, security.flag.

Агрегаты для админ-аналитики считаются SQL-запросами по событиям и доменным таблицам (без отдельного OLAP): воронка курса (доля дошедших до каждого урока среди начавших курс), топ-20 проваливаемых вопросов (доля неверных в тестах), западающие категории (доля again в srs_reviews по категориям), активность по дням, время до фидбека. Кеш 10 мин.

### 7.14 Импортер Notion (одноразовый, `scripts/import-notion.ts`)

Вход: markdown-экспорт базы (один файл ~19К строк, вложенность = отступы по 4 пробела, узлы — `- **Название**`). Запуск: CLI `pnpm import -- --file=path --dry-run|--commit`, а также кнопка в /admin/import (загрузка файла, лог выполнения). Всё создаётся в статусе draft.

Алгоритм:
1. Парсинг дерева по отступам (4 пробела = уровень) и болд-маркерам.
2. Маппинг верхнего уровня: «Спринты» → курсы (7 шт. по таблице ниже); «Гайды по резюме и легенде», «Вопросы, которые нужно задать…», «Гайд по успешному прохождению…», «Пространство для поиска работы» → guides (секции resume/legend/ask_interviewer/stages/job_search); «Вопросы с собеседований» → банк вопросов; раздел «Собеседования» (ссылка на Я.Диск) — пропустить с пометкой в отчёте (библиотека наполняется вручную).
3. Курсы: Python + PyTorch; Алгоритмы и лайфкодинг; NLP: базовый курс («Простая мапа», 13 уроков; 2 с пометкой «ДОПОЛНИТЕЛЬНО…» → is_optional=true, пометку из названия убрать); NLP: продвинутый (ШАД, L1–L14); Основные инструменты → НЕ курс, а guides(section=tools, 14 страниц); ML System Design (9 уроков); Soft Skills (12 уроков; уроки с «mock» в названии получают `:::mock`-директиву); Classic ML (3 урока-хаба). Внутри трека узлы 3-го уровня = уроки; если у трека есть промежуточный уровень («Простая мапа»/«ШАД») — это модули, иначе один модуль «Основной».
4. Конверсия контента узла: первый YouTube-URL → lessons.video_url; остальные `:::video`; заголовки-эмодзи 🎬/📖 → убрать (секции становятся h3); блоки «**Практика**…» → `:::practice`; «**Материал:**» и списки ссылок → `:::callout{type=material}`; маркеры 🟠/🚩/⚡ → убрать, содержимое в обычные списки/`:::callout{type=important}`; «**Проверка себя:** …» → создать open-вопрос, привязать is_key=true к уроку; строка «**Категории вопросов для заучивания в базе:** A; B» → после импорта вопросов найти категории по названию (fuzzy, нормализация регистра/ё) и привязать все их вопросы к уроку (is_key=false, in_quiz=false).
5. Вопросы: уровень 2 = категории (8), уровень 3 = подкатегории ЛИБО вопросы (эвристика: узел с «?» или с непустым телом и без детей-болдов = вопрос на уровне подкатегории — привязать к родительской категории и включить в отчёт аномалий). Тело узла → answer_md. Если тело состоит только из изображений → needs_latex=true (44 шт. — контент-задача команды: переписать формулы в KaTeX). Изображения: экспорт «без файлов» содержит битые пути — заменить на плейсхолдер `![Изображение: загрузите вручную](TODO)` + флаг в отчёте.
6. Отчёт: создано курсов/модулей/уроков/гайдов/вопросов; аномалии (вопросы не на своём уровне, нераспознанные категории, needs_latex, TODO-изображения); ничего не публикуется автоматически — команда вычитывает черновики и публикует.

### 7.15 Фоновые задачи (worker, node-cron; каждая — идемпотентна, лог в stdout)

| Job | Расписание | Действие |
|---|---|---|
| slotsGenerate | 02:00 ежедневно | материализация слотов на 14 дней |
| streakProcess | каждые 30 мин | для пользователей, у кого локально «прошла полночь» — обработка вчерашнего дня (7.7) |
| digest | каждые 15 мин | пользователи, у кого digest_time в этом окне и очередь >0 |
| expiryNotify + expire | 09:00 ежедневно | напоминания 14/3/0 и перевод в expired (7.1) |
| youtubeCheck | 04:00 ежедневно | HEAD/oEmbed-проверка video_url всех published-уроков → video_status, флаг в Пульт |
| waitlistHolds | каждые 10 мин | истечение offer_expires_at → следующий в очереди |
| sessionCleanup | 05:00 | удаление истёкших sessions, password_resets, invites |
| linkRotationReminder | 1 число месяца | уведомление админам о записях со старыми ссылками |

---

## 8. Страницы и экраны

Формат: назначение → ключевые элементы → состояния (обязательные пять — 5.5 — не повторяются, указано только специфичное).

### 8.1 Аутентификация
- **/login** — единственная публичная страница. Логотип {BRAND_NAME}, email+пароль, «Забыл пароль». Ошибки: неверные данные (общий текст), blocked, rate-limit. Редирект по роли: student → «/», mentor+ → /admin.
- **/invite/[token]** — приветствие по имени, установка пароля (метр надёжности), чекбокс согласия с правилами доступа (текст из настроек) → авто-логин → /onboarding. Токен истёк → «Ссылка устарела, попроси новую».
- **/forgot, /reset/[token]** — стандартный сброс.

### 8.2 Онбординг (/onboarding, один раз)
Три экрана-карточки с прогресс-точками: 1) «Какая цель?» — DS / NLP / AI Engineering (пишет track, определяет порядок курсов на дашборде и «первый урок»); 2) «Сколько времени в день?» — лайт 15 мин / норма 30 / интенсив 60 → daily_goal_xp 30/60/120; 3) «Напоминания» — время дайджеста + тумблер. Кнопка «Начать обучение» → первый урок трека. Пропустить можно (дефолты).

### 8.3 Ученик
- **/ (Дашборд).** Блоки: приветствие + StreakBadge + GoalRing; hero «Продолжить» (карточка текущего урока: курс, название, прогресс модуля; градиентная кнопка) — при отсутствии начатого: «Начать обучение» с первым уроком трека; «Сегодня»: карточка очереди («14 карточек · ~6 мин» → /trainer/session; пустое: «Всё повторено…») + карточка ближайшего мока (countdown, «Подключиться» за 15 мин); прогресс по курсам (мини-карточки с % и кольцом); «Западающие темы» (топ-3 категории по доле again/ошибок за 30 дней, ссылки на уроки; скрыт при <20 ответов); Heatmap. Порядок на мобильном: стрик/цель → продолжить → очередь → мок → курсы.
- **/courses** — карточки курсов: название, описание, прогресс, метка гейтинга; порядок — по треку пользователя, затем остальные.
- **/courses/[slug]** — шапка курса + ModuleTree: модули с прогрессом, кнопка «Сдать экстерном» на закрытых strict-модулях (test-out), уроки с галками/замками/метками optional и «обновлён», строка модульного теста (сдан {score}% / доступен / закрыт).
- **/lessons/[id]** — анатомия по 7.3. Замок (strict, не открыт) → экран «Урок откроется после …» со ссылкой на нужный шаг.
- **/tests/[moduleId]** — интро (вопросов, порог, правила кулдауна) → TestRunner (один вопрос на экран, «Далее», прогресс) → экран результата (7.5). Обновление страницы не теряет попытку (attempt в БД).
- **/trainer** — хаб: карточка очереди + кнопка «Начать»; статистика (отвечено всего, выучено, точность 30 дней); ссылка в каталог; «Западающие темы».
- **/trainer/session** — сессия SRS (7.6).
- **/questions, /questions/[id]** — каталог и FlipCard-просмотр (7.4).
- **/mocks** — две карточки типов + активная бронь + booking-lock-плашка при страйках; «/mocks/book» — мастер (7.8); «/mocks/mine» — предстоящие и история (карточки со статусами и вердиктами); «/mocks/[bookingId]» — детали брони / опубликованный фидбек.
- **/library, /library/[id]** — (7.9).
- **/guides, /guides/[slug]** — (7.10).
- **/profile** — имя, email, смена пароля; тема; таймзона; учебные дни (чипы пн–вс); дневная цель; время дайджеста; матрица уведомлений + тихие часы; устройства (список, «Выйти на всех»); «Доступ до {дата}»; правила платформы.
- **/expired** — (7.1.6).

### 8.4 Интервьюер (флаг is_interviewer; вход через /admin-шапку «Интервью»)
- **/interviewer/schedule** — правила доступности (CRUD строк weekday+интервал), исключения-календарь, предпросмотр слотов на 2 недели, «Закрыть день».
- **/interviewer/bookings** — сегодня/неделя списком: время, ученик (ссылка на карточку), тип, статусы; кнопки «Открыть комнату», «Провести» → run.
- **/interviewer/run/[bookingId]** — экран проведения (7.8): доступен с −15 мин; «Не пришёл» через +10 мин; «Завершить» → форма фидбека (та же страница, шаг 2).

### 8.5 Админка (/admin; сайдбар разделов, у mentor скрыты недоступные)
- **Пульт** — метрики недели (активные, завершения уроков, сданные тесты, моки); красные флаги (списки-виджеты): «Пропали 7+ дней», «3 провала теста подряд», «Security-флаги», «Видео недоступны», «Доступ истекает ≤14 дней: N», «Записи со старыми ссылками», «Открытые репорты контента». Каждый флаг → переход к сущности.
- **/admin/content** — дерево курсов/модулей/уроков (drag-порядок, статусы); редактор урока: двухпанельный markdown ↔ live-preview (рендер идентичен ученическому), тулбар вставки директив, поля метаданных (video_url, difficulty, optional), привязка вопросов (поиск по банку, флаги is_key/in_quiz), настройка module_tests, кнопки «Черновик/Опубликовать», «Открыть как ученик».
- **/admin/questions** — таблица с фильтрами (категория, тип, статус, needs_latex), inline-создание категорий, редактор вопроса (тип-специфичные поля, предпросмотр KaTeX), массовые операции (сменить категорию, привязать к уроку, опубликовать).
- **/admin/students** — таблица (поиск, статус, доступ до, последний визит, стрик); карточка ученика: профиль и доступ (выдать/продлить/заблокировать, сессии и устройства + сброс, подарить заморозку, тумблер библиотеки, заметка ментора); вкладки: прогресс (курсы, уроки), тесты (попытки), повторения (статистика, западающие), моки (история, страйки, вердикты), события. Кнопки: «Глазами ученика», «Отправить инвайт повторно».
- **/admin/interviews** — все брони (фильтры), страйки и локи (снять страйк вручную), редактор рубрик (criteria обоих типов), waitlist.
- **/admin/library** — таблица записей + форма загрузки с чеклист-гейтом (7.9).
- **/admin/analytics** — воронка по курсу (селектор), топ проваливаемых вопросов, западающие категории, активность (график DAU/WAU), моки (проведено, средние оценки, время до фидбека). MVP-объём: воронка + провалы + активность; остальное V1.
- **/admin/announcements** — создание (banner показывается плашкой над контентом ученикам сегмента; notification — через колокольчик), список с охватом прочтений.
- **/admin/settings** — контакт для продления, тексты правил, XP-карта (read-only просмотр), дефолты гейтинга, шаблоны писем (предпросмотр), rubrics-ссылка, BRAND_NAME-подсказка (env).
- **/admin/audit** — (owner) таблица аудита с фильтрами по актору/сущности/датам.
- **/admin/import** — загрузка экспорта, dry-run отчёт, кнопка «Импортировать», лог.

---

## 9. API (логические контракты)

Мутации — Server Actions (валидация zod, RBAC, аудит внутри). Route Handlers — только где нужен URL. Ниже контракты по доменам; имена файлов сервисов — раздел 4.

**auth:** login(email,pwd) · logout() · acceptInvite(token,pwd) · requestReset(email) · resetPassword(token,pwd)
**profile:** updateProfile({name,timezone,theme,studyDays,goalXp,digestTime}) · updateNotificationPrefs(matrix) · changePassword(old,new) · revokeAllSessions() · listDevices()
**content (student):** GET курсов/курса/урока — RSC-загрузчики; completeLesson(lessonId) · savePosition(lessonId,{scroll,video}) · reportContent({lessonId?,questionId?,type,text})
**tests:** startModuleTest(moduleId,kind) → attempt · answer(attemptId,questionId,answer) · finish(attemptId) → результат; startQuiz(lessonId) отсутствует — квиз отвечается поштучно: answerQuiz(lessonId,questionId,answer) → {correct,explanation}
**srs:** GET /api/trainer/queue → {cards[],total,estimate} · reviewCard(cardId,grade) · addToSrs(questionId)
**mocks:** GET слотов (type,interviewer?,range) · book(slotId,type) · cancel(bookingId) · joinWaitlist({type,interviewerId?}) · claimOffer(waitlistId) — и интервьюерские: upsertAvailabilityRule · addException · closeDay(date) · markNoShow(bookingId) · saveNotes(bookingId,text) · setQuestionMark(bookingId,questionId,mark) · completeMock(bookingId) · saveFeedbackDraft(bookingId,data) · publishFeedback(bookingId)
**library:** GET каталога/записи · openRecording(id) (лог) — admin: upsertRecording(data) (валидация чеклиста при publish)
**guides:** GET · toggleBookmark(guideId)
**search:** GET /api/search?q= → {groups}
**notifications:** GET /api/notifications/unread · markRead(ids|all)
**admin:** inviteStudent(email,name) · resendInvite(userId) · extendAccess(userId,{days|untilDate}) · blockUser(userId) · resetSessions(userId) · giftFreeze(userId) · toggleLibrary(userId) · setMentorNote(userId,text) · impersonate(userId) / stopImpersonation() · CRUD courses/modules/lessons/questions/categories/guides/announcements/rubrics · resolveFlag(id) · resolveReport(id) · runImport(file,{dryRun}) · GET analytics-агрегатов
**cron:** POST /api/cron/[job] c `CRON_SECRET` (для внешнего триггера при необходимости; основной путь — worker)

Общие правила ответов action'ов: `{ok:true,data}` | `{ok:false,error:{code,message}}`; message — готовый русский текст для тоста.

---

## 10. Ключевые пользовательские сценарии (acceptance-флоу)

1. **Активация.** Админ приглашает → письмо → пароль → онбординг (3 экрана) → первый урок трека. `access_until = +90 дней от установки пароля`.
2. **Ежедневный визит (мобильный).** Пуш-дайджест 09:00 → открыл → дашборд: кольцо пустое, очередь 14 → сессия карточек (свайпы) → «Готово» +30 XP → день в серии, кольцо частично → «Продолжить» урок с места скролла → квиз → кольцо закрылось (glow+вибрация).
3. **Модульный тест с провалом.** 12 вопросов → 66% → экран «нужно 80%», темы ошибок, таймер 45 мин → ошибки уже в очереди повторений → пересдача новой выборкой → 92% → +100 XP, полный разбор → следующий модуль открылся.
4. **Test-out.** Опытный ученик на закрытом модуле → «Сдать экстерном» → 90%+ → модуль зачтён, уроки отмечены, +100 XP.
5. **Мок целиком.** /mocks → «ML-теория» → «Первый свободный» → слот чт 19:15 → подтверждение → карточка на дашборде → напоминания → «Подключиться» → интервьюер в run-экране отмечает 3 вопроса «частично» → «Завершить» (+200 XP) → фидбек draft → publish → ученик получает уведомление, видит рубрику и рекомендованные уроки → 3 вопроса появились в его очереди.
6. **Неявка.** Ученик не пришёл → через 10 мин «Не пришёл» → страйк №2 за 60 дней → бронирование закрыто до {дата}, ученик видит причину; интервьюер получил слот обратно (ушёл в waitlist).
7. **Истечение и продление.** День 90 → expired → /expired с итогами → написал ментору → админ «+3 месяца» → всё на месте: очередь, серия (paused снят), курс.
8. **Шаринг пресечён.** Друг логинится вечером → сессия ученика выбита с сообщением; на 3-м устройстве вытеснено первое + email; входы из двух городов за сутки → флаг в Пульте.
9. **Админ создаёт урок.** Дерево → «+ Урок» → markdown с `$$`-формулой и `:::callout` → предпросмотр → привязал 4 вопроса (2 is_key) → опубликовал → ученикам с завершённым соседним уроком открылся; прошедшим модуль — бейдж «новый урок».
10. **Библиотека.** Ментор грузит запись → чеклист 4/4 → publish → ученик фильтром «лайфкодинг · NLP · middle» находит → просмотр залогирован.

---

## 11. Безопасность

- OWASP-базис: параметризованные запросы (Prisma), zod-валидация всех входов, CSRF — встроенная защита Server Actions + SameSite, заголовки: CSP (self + youtube-nocookie frame-src + Я.Диск frame-src), X-Frame-Options DENY (кроме собственных embed-нужд — нет), Referrer-Policy strict-origin.
- Секреты — только env. Пароли argon2id (memory 64MB, iterations 3). Сессии/токены — случайные 256 бит, в БД только hash.
- RBAC на каждом action + layout-гарды. Impersonation строго read-only (whitelist безопасных GET), каждое включение — в аудит.
- Rate limits (7.2) — in-memory + таблица для login-неудач. Ошибки аутентификации не раскрывают существование email.
- Аудит: все мутации admin/mentor/owner (before/after diff), retention без ограничений.
- Контент-защита: watermark (5.7), single-session, device-cap, гео-флаги, rapid-флаги, логирование библиотек. Copy/paste и right-click НЕ блокируются (осознанное решение — код должен копироваться).
- Письма: никаких секретов в теме; ссылки только на PLATFORM_URL.
- Бэкапы: pg_dump ежедневно (cron на хосте), retention 14 дней — включить в docker-compose пример.

## 12. Производительность

- Цели: LCP ≤ 2.5с на 4G (mobile), p95 server action ≤ 300мс, поиск ≤ 150мс, палитра открывается ≤ 100мс, очередь SRS грузится ≤ 200мс.
- SSR/RSC по умолчанию; статика курсов/гайдов — `revalidate` 60с + on-demand revalidate при публикации. Дашборд — динамический, но агрегаты (heatmap, статистика) — SQL с индексами + unstable_cache 60с на пользователя.
- Изображения: next/image, лимит загрузки 2МБ, WebP. Шрифты self-hosted, `font-display: swap`, subset.
- Индексы: перечислены в 6; дополнительно составные (user_id,next_review_at) на srs_cards, (user_id,day) на xp_events, (starts_at,status) на slots.
- Списки >50 строк — пагинация (админ-таблицы: cursor-based).
- Bundle: KaTeX/Shiki — на сервере; Framer Motion — только в клиентских островках; палитра — lazy.

## 13. Адаптивность и мобильный UX

- Брейкпоинты: <768 mobile (BottomNav: Главная/Обучение/Тренажёр/Моки/Ещё; «Ещё» = справочник, библиотека, достижения(V1), профиль), 768–1024 tablet (узкий сайдбар), >1024 desktop (сайдбар + Cmd+K).
- Тач-зоны ≥44px; урок на мобильном без боковых панелей, оглавление — шторка; SlotPicker и сессия SRS спроектированы под большой палец; плеер записей — landscape fullscreen; haptic на ритуалах и закрытии очереди.
- Никакого horizontal overflow ни на одном экране на 360px (таблицы админки — только desktop-first, на мобильном допускается горизонтальный скролл внутри карточки).

## 14. Доступность

Контраст ≥ 4.5:1 (проверить пары токенов), видимые focus-кольца (`--accent`, 2px offset), полная клавиатурная навигация палитры/тестов/сессии (1/2/3 — оценки карточек, Space — флип), aria-live для тостов и результатов, alt у изображений контента (импортер ставит TODO), `prefers-reduced-motion` (5.4), семантические заголовки, labels у всех полей.

## 15. Обработка ошибок

- Глобальный error boundary (страница «Что-то пошло не так» + «Повторить»), route-level error.tsx на каждой группе. 404 — «Такой страницы нет» + ссылка на дашборд.
- Server actions: try/catch → `{ok:false,error}` с человеческим русским текстом; неожиданные — логируются (pino) с request-id, пользователю — общий текст. Никаких стектрейсов наружу.
- Оптимистичные обновления только там, где безопасно (закладки, read-уведомлений); критичные (бронь, ответы теста) — пессимистичные со спиннером в кнопке.
- Формы сохраняют ввод при ошибке; offline-баннер (navigator.onLine) с ретраем; двойной сабмит защищён disabled+идемпотентностью.
- Конфликты: бронь занятого слота → «Слот только что заняли — выбери другой» + обновление списка; ответ на устаревшую попытку теста → мягкий редирект на результат.

---

## 16. Приоритеты реализации

**MVP (запуск для 25 учеников):** всё из разделов 6–8, кроме перечисленного в V1/V2. Явно входит: auth+инвайты+90 дней, антишаринг, курсы/уроки/гейтинг/test-out, банк вопросов+каталог, квизы+модульные тесты, SRS, XP-события+стрик+заморозки+учебные дни+дневная цель, дашборд+heatmap, моки полный цикл (слоты, брони, страйки, waitlist, run-экран, рубрики, фидбек), библиотека (Я.Диск, чеклист, лог, тумблер), справочник+закладки, поиск Cmd+K, уведомления email+in-app, админка (все 10 экранов; аналитика в MVP-объёме), импортер, аудит, watermark, YouTube-монитор, темы, мобильный адаптив, seed, деплой.

**V1 (после запуска):** страница и витрина уровней/достижений + toast-выдача (события уже пишутся), недельные челленджи, Telegram-бот уведомлений, FSRS-планировщик, Tiptap-редактор контента, видеохостинг с подписанными URL и watermark для библиотеки + таймкоды, генерация вариантов ответов из открытых вопросов (LLM-ассист в админке), заметки ученика в уроках, расширенная аналитика (время на урок, забываемость, средние оценки моков), экспорт CSV, Playwright e2e.

**V2 (горизонт):** AI-ассистент по базе знаний (RAG, ответы строго из контента), сертификаты о прохождении, персональные рекомендации следующего шага, PWA-пуши/офлайн-режим повторений, платежи и самопродление — если понадобится.

---

## 17. План работ (этапы; внутри — задачи; DoD этапа = раздел 19 + свои проверки)

**Этап 0 — Каркас.** Repo (pnpm, TS strict, ESLint/Prettier), Next.js, Tailwind+tokens.css (все токены 5.1), Prisma+PG (docker-compose dev), layout-скелеты трёх зон, UI-кит (5.3, базовые 12 компонентов), темы+анти-FOUC, шрифты, error/404, pino-логгер, Vitest.
**Этап 1 — Auth и доступ.** users/sessions/devices/invites/resets, argon2, single-session+device-cap+evicted-экран, гео/rapid-флаги, rate-limit, страницы 8.1, профиль-безопасность, RBAC-гарды, аудит-сервис, impersonation, инвайт-флоу админа (минимальный /admin/students), логика 90 дней (activation, extension, expire+/expired, напоминания — заглушка до этапа 9), юнит-тесты access/sessions.
**Этап 2 — Контент.** Модель контента, markdown-пайплайн (директивы, KaTeX, Shiki), LessonRenderer+блоки, страницы курсов/урока, гейтинг+optional, позиции чтения, completeLesson, «урок обновлён», content_reports, админ контент-студия (дерево, редактор, предпросмотр, публикация), tracks+онбординг (8.2). Тесты гейтинга.
**Этап 3 — Вопросы и тесты.** Категории/вопросы/привязки, каталог+FlipCard, квиз урока, модульные тесты+test-out (attempts, кулдаун, выборка), админ-банк, юнит-тесты выборки/порогов/идемпотентности.
**Этап 4 — SRS.** srs_cards/reviews, планировщик (7.6, юнит-тесты всех переходов), очередь+сессия (свайпы, клавиши), интеграции-источники (уроки/квизы/тесты), /trainer, лимит новых 20/день.
**Этап 5 — Геймификация-ядро.** events-диспетчер (7.13) + рефакторинг эмитов, XP-карта+идемпотентность, стрик+заморозки+учебные дни+worker streakProcess, дневная цель+GoalRing, достижения-движок (записи, toast — минимально), Heatmap, дашборд целиком (8.3), юнит-тесты стрика и XP.
**Этап 6 — Моки.** Профили интервьюеров, availability+exceptions+slotsGenerate, SlotPicker+бронь (транзакции, правила), отмены/страйки/локи/no-show, waitlist+holds, напоминания (через notifications-сервис, доставка email с этапа 9 — in-app сразу), run-экран+marks→SRS, рубрики+фидбек, /mocks*, /interviewer*, админ-интервью, юнит-тесты слотов/страйков/waitlist.
**Этап 7 — Библиотека и справочник.** recordings+чеклист-гейт+views+тумблер, /library*, /admin/library; guides+bookmarks+/guides*; связки-ссылки.
**Этап 8 — Поиск.** FTS-колонки+триггеры (миграция raw SQL), /api/search, CommandPalette (действия, недавние, группы, hotkeys).
**Этап 9 — Уведомления и worker.** notifications+prefs+колокольчик, SMTP+шаблоны писем (инвайт, сброс, дайджест, мок×4, доступ×3, new_device), тихие часы, все jobs 7.15 (включая youtubeCheck и заглушку-замену VideoEmbed), объявления+banner.
**Этап 10 — Админ-финал.** Пульт (все виджеты-флаги), аналитика MVP (воронка, провалы, активность), students-карточка полностью (вкладки), settings, audit-таблица.
**Этап 11 — Импортер.** scripts/import-notion.ts + /admin/import + dry-run отчёт; прогон на реальном экспорте; фикс-лист аномалий.
**Этап 12 — Полировка.** Пять состояний всех экранов (ревизия), пустые тексты, a11y-проход, reduced-motion, перф-бюджеты (12), мобильный проход 390px всех флоу, watermark везде, spot-фиксы.
**Этап 13 — Прод.** Dockerfile+compose (web/worker/pg/caddy), env-пример, seed, миграции-процедура, бэкап-cron, README-runbook (деплой, восстановление, ротация ссылок, импорт), smoke-чеклист по сценариям раздела 10.

## 18. Окружение, seed, деплой

**ENV:** `DATABASE_URL, SESSION_SECRET, CRON_SECRET, PLATFORM_URL, BRAND_NAME=MENTORS, SMTP_HOST/PORT/USER/PASS/FROM, RENEWAL_CONTACT (ссылка tg/mail), GEOIP_DB_PATH?, NODE_ENV`.
**Seed (`prisma/seed.ts`):** owner (email/пароль из env SEED_OWNER_*), 2 ментора (один is_interviewer) + профили интервьюеров с плейсхолдер room_url, tracks (ds/nlp/ai), 8 категорий вопросов с цветами, rubric_templates с дефолтными критериями (7.8), achievements-справочник (7.7), app_settings (XP-карта, правила, RENEWAL-текст), notification_prefs-дефолты, демо-курс «Демо» (1 модуль, 2 урока: с формулой/кодом/коллаутами/видео, 6 вопросов: 3 open + 3 закрытых, module_test) — для проверки всех механик до импорта.
**Деплой:** docker compose на VPS; caddy — TLS+домен; `prisma migrate deploy` на старте web; healthcheck `/api/health`; логи stdout→journald. Prod-заметка: PG — volume + ежедневный pg_dump.
**Локальная разработка (дополнение, июль 2026):** ведётся без Docker — портативный PostgreSQL 16 в `./pgsql` (в git не попадает), управление через `pnpm db:setup / db:start / db:stop / db:status`, перед `pnpm dev` выполняется проверка доступности БД. Docker Compose остаётся путём продакшена и машин с Docker.

## 19. Definition of Done (каждый этап и проект в целом)

1. `pnpm build` и `pnpm typecheck` без ошибок; ESLint чист.
2. Юнит-тесты бизнес-логики зелёные (обязательные наборы: access lifecycle, sessions eviction, гейтинг, выборка тестов и пороги, все переходы SRS, XP-идемпотентность, стрик с заморозками и учебными днями, генерация слотов, страйки/локи, waitlist).
3. Каждый новый экран: пять состояний, мобильная версия 390px, обе темы, клавиатурный фокус.
4. Все пользовательские тексты — на русском, без плейсхолдеров «Lorem/TODO».
5. Мутации проходят через сервисный слой, значимые — через emitEvent; админ-мутации — в аудите.
6. Сценарии раздела 10 проходят вручную end-to-end на seed-данных.
7. Ни одного секрета в коде; README покрывает запуск с нуля одной командой.

— Конец ТЗ. Вопросы по неоднозначностям фиксируй списком в PR-описании этапа, но сначала перечитай разделы 7 и 0.

---

## Уточнения (changelog)

Принятые в ходе разработки решения, дополняющие основной текст. При противоречии уточнение имеет приоритет над исходной формулировкой соответствующего раздела.

- **К разделу 11 (безопасность).** Вся платформа закрыта от индексации поисковиками: `noindex` в metadata всех страниц и заголовок ответа `X-Robots-Tag: noindex, nofollow`. Принято на этапе 0.
- **К разделу 5.3 (компоненты).** Sheet (мобильная шторка) строится на этапе 2 вместе с оглавлением урока — первым реальным потребителем компонента, а не в базовом ките этапа 0.
- **К разделам 17/18 (seed).** Минимальный dev-seed вводится уже на этапе 1: owner и 2 ментора (один `is_interviewer`) с реквизитами из `SEED_*` env — без них не войти в свежую базу. Полный сид (треки, категории, рубрики, достижения, демо-курс и т.д.) остаётся задачей этапа 13.
- **К разделу 7.1 (инвайт).** После создания инвайта админ видит инвайт-ссылку прямо в интерфейсе с кнопкой «Копировать» (и может открыть её снова из карточки ученика). Email — дополнительный канал доставки; до этапа 9 письма в dev-окружении пишутся в лог, поэтому ссылка в интерфейсе — основной рабочий путь.
- **К разделу 7.2 (GeoIP).** GeoIP-lookup реализуется как опциональный адаптер: `GEOIP_DB_PATH` может отсутствовать — тогда `sessions.city` остаётся `null`, гео-флаги не создаются, всё остальное работает без изменений. Платформа никогда не скачивает внешние GeoIP-базы сама; путь к локальной базе (MaxMind mmdb) задаёт администратор.
- **К разделам 7.1 и 11 (инвайт-токены).** Инвайт-токены хранятся в БД в открытом виде — осознанное исключение из правила «в БД только hash»: токен одноразовый, живёт 7 дней, даёт доступ только к пустому неактивированному аккаунту, а повторный показ ссылки из карточки ученика — рабочая необходимость (принято на этапе 1). Reset-токены и сессионные токены хранятся только хешированными.
- **К разделу 6 (auth_attempts).** Добавлена таблица `auth_attempts` (журнал неудачных попыток входа и запросов сброса: kind `login|forgot`, email, ip, created_at) — её требует раздел 11 («таблица для login-неудач»), в исходной модели данных она отсутствовала.
- **К разделу 7.1 (блокировка и продление).** У блокировки есть обратная операция «Разблокировать»: статус восстанавливается по датам (active, если `access_until` в будущем, иначе expired); продление по 7.1.7 также разблокирует. Кнопки продления подписаны честно: «+1 месяц (30 дней)» и «+3 месяца (90 дней)» — `access_extensions.days` подневный.
- **К разделу 7.2 (сессии и истечение).** «Выйти на всех» работает как «выйти на всех остальных»: текущая сессия сохраняется, остальные завершаются (кнопка безопасности не должна разлогинивать нажавшего). Истечение доступа проверяется гардами по `access_until` на каждом запросе: просроченный активный ученик получает ленивый флип в `expired` и попадает на `/expired` немедленно, а не только при следующем логине.
- **К разделу 8.5 (удаление контента).** Удаление курсов, модулей и уроков в контент-студии доступно только для черновиков. Опубликованное не удаляется — оно может нести прогресс учеников; сначала снятие с публикации (принято на этапе 2).
- **К разделу 8.5 («Открыть как ученика»).** Кнопка «Открыть как ученика» в редакторе урока открывает chrome-less превью-рендер (`/content-preview/[id]`, тот же LessonRenderer, что у учеников, — идентичность рендера обеспечена конструктивно). Полноценный просмотр от лица ученика — impersonation «Глазами ученика» из карточки: студенческая зона для mentor+ закрыта гардами.
- **К разделу 6 (slug урока).** Slug урока уникален в пределах модуля, а не глобально: маршруты уроков идут по id (`/lessons/[id]`), slug нужен для якорей и импорта.
- **К разделам 7.13/8.5 (аудит студии).** Автосейвы контента урока (дебаунс на каждое изменение) не пишутся в аудит-лог — иначе он превращается в поклавишный журнал. Аудируются значимые мутации: метаданные, публикация/снятие, создание/удаление и изменение порядка.
- **К разделам 7.4/7.5 (роль вопроса в уроке).** Флаги `is_key` и `in_quiz` взаимоисключающие: роль вопроса в уроке одна — «ключевой / в квизе / просто привязан». Ключевой вопрос раскрывает эталон в блоке «Ключевые вопросы» прямо над квизом того же урока, поэтому одновременное участие в квизе лишено смысла. В модели данных остаются два bool-поля; инвариант держит action-слой (общая zod-схема с refinement). Принято фиксом этапа 3.
- **К разделу 7.3 (test-out).** «Закрытый модуль», на котором доступна кнопка «Сдать экстерном», — это незачтённый модуль strict-курса с включённым модульным тестом; когда уроки модуля завершены, экстерн не предлагается — сдаётся обычный модульный тест. Кулдауны провалов считаются раздельно по kind (`module`/`testout`). Незавершённая попытка — одна на модуль (любого kind): повторный старт возобновляет её, а не создаёт параллельную. Принято на этапе 3.
- **К разделам 7.14/17 (импортер).** Импортер разделён на две части: часть 1 (курсы/модули/уроки и банк вопросов) выполняется отдельным внеочередным этапом по готовности экспорта Notion; часть 2 (справочник) — в составе этапа 7. Страница /admin/import и финальная сверка на полном экспорте остаются этапом 11.
- **К разделу 6 (SrsAddedFrom).** Enum источника карточки `added_from` включает значение `manual` — раздел 6 перечисляет только `lesson_key|test_fail|quiz_fail|mock`, но раздел 7.6 требует ручное добавление вопроса из каталога («В повторения», source=`manual`). Пять значений: `lesson_key|test_fail|quiz_fail|mock|manual` (`mock` подключается на этапе 6). Принято на этапе 4.
- **К разделу 7.6 (сброс карточки, lapses, момент создания).** Три уточнения к источникам SRS: (1) сброс живой карточки от ошибки (`quiz_fail`/`test_fail`/`mock`) перештамповывает `added_from` на источник ошибки — так фильтр «мои западающие» видит, что карточка вернулась именно из-за ошибки; сброс от завершения урока (`lesson_key`) провенанс НЕ переписывает (ошибка «важнее» рутинного повторения). (2) `lapses` растёт только от оценки «Не знаю» (`again`) — сбросы источников счётчик не трогают. (3) Карточка `test_fail` заводится в момент неверного ответа на вопрос, а не при завершении попытки; неотвеченные вопросы теста карточек не создают. Принято на этапе 4.
- **К разделу 7.13 (queue.completed — exactly-once).** Известное ограничение этапа 4: одноразовость `queue.completed` за календарный день держится проверкой `analytics_events` внутри транзакции ответа на карточку. Это не защищает от гонки при одновременном закрытии очереди из двух вкладок — обе транзакции могут не увидеть событие друг друга и заэмитить `queue.completed` дважды (двойной день в стрик/аналитику). Строгий exactly-once закрывается на этапе 5 вместе с подключением XP: диспетчер начисляет через уникальный индекс `xp_events (user_id, type, ref_type, ref_id)`, который и станет барьером идемпотентности для дневных событий.
