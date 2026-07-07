# MENTORS

Закрытая менторская платформа подготовки к карьере в ML / DS / NLP / AI Engineering.
Единственный источник требований — [MENTORS_TZ.md](./MENTORS_TZ.md).

## Стек

Next.js 15 (App Router, RSC, Server Actions) · TypeScript strict · Tailwind CSS 4 + дизайн-токены · Radix UI · PostgreSQL 16 · Prisma · Vitest · pino.

## Требования

- Node.js >= 20
- pnpm >= 9
- PostgreSQL 16 — либо портативный в папке проекта (без Docker и прав администратора, см. ниже), либо Docker

## Запуск с нуля (без Docker — основной способ на этой машине)

```bash
pnpm install          # зависимости
cp .env.example .env  # заполнить переменные: как минимум SEED_* (реквизиты owner и двух менторов)
pnpm db:setup         # разово: скачает EDB-бинарники PostgreSQL 16 (~326 МБ) в ./pgsql,
                      # выполнит initdb и создаст базу mentors (пользователь mentors/mentors)
pnpm db:start         # запустить базу (localhost:5432)
pnpm db:migrate       # применить миграции Prisma
pnpm db:seed          # dev-seed: owner + 2 ментора из SEED_* env (идемпотентно)
pnpm dev              # http://localhost:3000 (перед стартом проверяет доступность базы)
```

Вход после сида — реквизиты из `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` (owner попадает в /admin).
Учеников приглашает админ со страницы «Ученики»; до этапа 9 письма пишутся в лог,
инвайт-ссылка доступна в интерфейсе с кнопкой «Копировать».

Папка `./pgsql` (бинарники, data-каталог, лог) в git не попадает (`.gitignore`).
Остановка — `pnpm db:stop`, проверка — `pnpm db:status`. Если база не запущена,
`pnpm dev` откажется стартовать с подсказкой «База не запущена — выполни pnpm db:start».

## Запуск с Docker (альтернатива на машинах с Docker)

```bash
pnpm db:up            # PostgreSQL 16 из docker-compose.dev.yml (те же реквизиты)
pnpm dev
```

## Скрипты

| Команда                                             | Действие                                                        |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`            | dev-сервер (с проверкой БД) / прод-сборка / запуск сборки       |
| `pnpm typecheck`                                    | проверка типов (`tsc --noEmit`)                                 |
| `pnpm lint` / `pnpm format`                         | ESLint / Prettier                                               |
| `pnpm test`                                         | юнит-тесты (Vitest; сами поднимают схему в базе `mentors_test`) |
| `pnpm db:seed`                                      | dev-seed (owner + 2 ментора из `SEED_*` env)                    |
| `pnpm db:setup`                                     | разовая установка портативного PostgreSQL 16 в `./pgsql`        |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | управление портативной базой                                    |
| `pnpm db:up` / `pnpm db:down`                       | PostgreSQL в Docker (альтернатива)                              |
| `pnpm db:migrate` / `pnpm db:generate`              | миграции / генерация Prisma-клиента                             |

## Статус

Выполнены этапы 0–3 из плана работ (раздел 17 ТЗ).

- Этап 0 («Каркас»): repo, Next.js, токены дизайн-системы, UI-кит, layout-скелеты зон,
  темы с анти-FOUC, шрифты, error/404, логгер, Vitest, Prisma + dev-compose.
- Этап 1 («Auth и доступ»): собственная аутентификация (argon2id, серверные сессии),
  одна одновременная сессия + лимит двух устройств + экран вытеснения, rate-limit
  логина/сброса, гео/rapid-флаги (GeoIP — опциональный адаптер), RBAC-гарды зон,
  аудит-сервис, impersonation «Глазами ученика», инвайт-флоу и минимальный
  /admin/students, жизненный цикл доступа 90 дней (активация, продление, expire,
  экран /expired), профиль-безопасность, dev-seed, юнит-тесты access/sessions/devices/rate-limit.
- Этап 2 («Контент»): модели courses/modules/lessons/tracks/lesson_progress/content_reports,
  markdown-пайплайн (директивы :::callout/:::video/:::practice/:::mock, KaTeX, Shiki,
  GFM-таблицы), LessonRenderer с watermark-слоем, страницы /courses и /courses/[slug]
  (ModuleTree с замками/галками/optional/«обновлён»), /lessons/[id] по анатомии 7.3
  (позиции чтения, автопереход, репорты, TOC-шторка), гейтинг strict/recommended/free,
  онбординг 8.2, контент-студия (дерево с drag-порядком, двухпанельный редактор
  с live-preview, публикация с revalidate), демо-курс в сиде, тесты гейтинга и reading_minutes.
- Этап 3 («Вопросы и тесты»): банк вопросов (категории с цветами, 5 типов, привязки
  is_key/in_quiz), каталог /questions с фильтрами и FlipCard, ключевые вопросы и квиз
  в уроке (7.5), модульные тесты /tests/[moduleId] (пул из закрытых вопросов, фиксация
  выборки, кулдаун, провал без правильных ответов / успех с разбором), test-out с порогом
  90% и зачётом модуля, тест в гейтинге (замок «после модульного теста», строка в дереве),
  админ-банк /admin/questions (фильтры, редактор с KaTeX-превью, массовые операции),
  привязка вопросов из редактора урока, настройка module_tests в студии, сид (8 категорий,
  6 демо-вопросов, тест демо-модуля), тесты выборки/порогов/кулдауна/test-out/short_text/quiz-first.
