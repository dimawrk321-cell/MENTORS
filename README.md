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
cp .env.example .env  # заполнить переменные (для dev достаточно дефолтов)
pnpm db:setup         # разово: скачает EDB-бинарники PostgreSQL 16 (~326 МБ) в ./pgsql,
                      # выполнит initdb и создаст базу mentors (пользователь mentors/mentors)
pnpm db:start         # запустить базу (localhost:5432)
pnpm dev              # http://localhost:3000 (перед стартом проверяет доступность базы)
```

Папка `./pgsql` (бинарники, data-каталог, лог) в git не попадает (`.gitignore`).
Остановка — `pnpm db:stop`, проверка — `pnpm db:status`. Если база не запущена,
`pnpm dev` откажется стартовать с подсказкой «База не запущена — выполни pnpm db:start».

## Запуск с Docker (альтернатива на машинах с Docker)

```bash
pnpm db:up            # PostgreSQL 16 из docker-compose.dev.yml (те же реквизиты)
pnpm dev
```

## Скрипты

| Команда | Действие |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | dev-сервер (с проверкой БД) / прод-сборка / запуск сборки |
| `pnpm typecheck` | проверка типов (`tsc --noEmit`) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` | юнит-тесты (Vitest) |
| `pnpm db:setup` | разовая установка портативного PostgreSQL 16 в `./pgsql` |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | управление портативной базой |
| `pnpm db:up` / `pnpm db:down` | PostgreSQL в Docker (альтернатива) |
| `pnpm db:migrate` / `pnpm db:generate` | миграции / генерация Prisma-клиента |

## Статус

Этап 0 («Каркас») из плана работ (раздел 17 ТЗ): repo, Next.js, токены дизайн-системы,
UI-кит, layout-скелеты зон, темы с анти-FOUC, шрифты, error/404, логгер, Vitest, Prisma + dev-compose.
