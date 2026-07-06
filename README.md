# MENTORS

Закрытая менторская платформа подготовки к карьере в ML / DS / NLP / AI Engineering.
Единственный источник требований — [MENTORS_TZ.md](./MENTORS_TZ.md).

## Стек

Next.js 15 (App Router, RSC, Server Actions) · TypeScript strict · Tailwind CSS 4 + дизайн-токены · Radix UI · PostgreSQL 16 · Prisma · Vitest · pino.

## Требования

- Node.js >= 20
- pnpm >= 9
- Docker (для локальной PostgreSQL)

## Запуск с нуля

```bash
pnpm install          # зависимости
cp .env.example .env  # заполнить переменные (для dev достаточно дефолтов)
pnpm db:up            # PostgreSQL 16 в Docker
pnpm dev              # http://localhost:3000
```

## Скрипты

| Команда | Действие |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | dev-сервер / прод-сборка / запуск сборки |
| `pnpm typecheck` | проверка типов (`tsc --noEmit`) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` | юнит-тесты (Vitest) |
| `pnpm db:up` / `pnpm db:down` | PostgreSQL в Docker |
| `pnpm db:migrate` / `pnpm db:generate` | миграции / генерация Prisma-клиента |

## Статус

Этап 0 («Каркас») из плана работ (раздел 17 ТЗ): repo, Next.js, токены дизайн-системы,
UI-кит, layout-скелеты зон, темы с анти-FOUC, шрифты, error/404, логгер, Vitest, Prisma + dev-compose.
