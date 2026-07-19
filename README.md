# MENTORS

Закрытая менторская платформа подготовки к карьере в ML / DS / NLP / AI Engineering.
Единственный источник требований — [MENTORS_TZ.md](./MENTORS_TZ.md).

## Стек

Next.js 15 (App Router, RSC, Server Actions) · TypeScript strict · Tailwind CSS 4 + дизайн-токены · Radix UI · PostgreSQL 16 · Prisma · Vitest · pino · Nodemailer (email) · node-cron (worker фоновых задач) · Docker Compose + Caddy (прод).

## Требования

- Node.js >= 22.13 (пиновый `pnpm@11.10` требует Node ≥ 22.13; поле `engines.node` в `package.json`)
- pnpm 11.10 (закреплён через `packageManager`; corepack подтянет нужную версию)
- PostgreSQL 16 — либо портативный в папке проекта (без Docker и прав администратора, см. ниже), либо Docker. Кодировка UTF-8, `LC_CTYPE` с корректной кириллицей (не `C`) — иначе trgm-fallback поиска молча пуст (см. changelog ТЗ, раздел 7.11); `scripts/db.mjs` создаёт кластер уже правильно.

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
Учеников приглашает админ со страницы «Ученики». Без заданного `SMTP_HOST` почта
работает в режиме `jsonTransport` (письма пишутся в лог, приложение не падает) —
инвайт-ссылка всегда доступна в интерфейсе с кнопкой «Копировать».

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

## Дев-стенд (VPS)

Внеочередной мини-этап после этапа 5: текущая версия развёрнута на будущем
прод-VPS, чтобы команда тестировала платформу и вычитывала импортированный контент.
Полная прод-ревизия — этап 13 (см. changelog ТЗ).

- **URL:** https://dev.155-212-211-251.sslip.io (временное имя через sslip.io; TLS — Caddy автоматически). Старое имя `dev.62-113-108-135.sslip.io` временно отдаёт 301-редирект на новое (переезд с IP под ТСПУ-фильтрацией — см. changelog ТЗ).
- **Сервер:** Ubuntu 24.04, `/opt/mentors` (клон репозитория), Docker Compose: `postgres` + `web` + `caddy` + `worker`. `worker` — живой процесс node-cron (все джобы 7.15: слоты, стрик, дайджест, напоминания, YouTube-монитор, флаги, рассылка отложенных писем), поднят этапом 9. Здоровье контейнера — по heartbeat-файлу: воркер трогает его каждые 30с, Docker healthcheck (`worker/healthcheck.mjs`) читает свежесть, так что зависший цикл переводит контейнер в `unhealthy` (этап 12.2).
- **Админ-доступ:** только по SSH через Tailscale (`ssh mentors-vps`). Публичный вход по паролю в sshd отключён; наружу открыты только 80/443.
- **Секреты:** `/opt/mentors/.env.prod` (в git не попадает; шаблон — `.env.prod.example`). Посмотреть на сервере: `cat /opt/mentors/.env.prod`.

### Обновление стенда

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1   # git pull → build → up -d → миграции (в entrypoint web)
```

Либо на сервере напрямую: `cd /opt/mentors && bash deploy.sh`. Compose всегда
запускается с `--env-file .env.prod -f docker-compose.prod.yml`.

### Логи и статус

```bash
cd /opt/mentors
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f web
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f caddy   # диагностика TLS
```

### Сид и импорт контента

```bash
# dev-seed (owner + 2 ментора, демо-курс, категории, достижения) — one-shot:
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools run --rm seed
```

Импорт Notion (раздел 7.14 ТЗ) имеет **два пути с общей кодовой базой** —
`buildImportPlan` + `commitPlan` через единый `runImport`; второй логики импорта
нет. Всё создаётся черновиками; `dry-run` — точное зеркало `--commit` по всем
счётчикам отчёта (курсы/модули/уроки/категории/вопросы/**привязки**/гайды).

**1. CLI (`pnpm run import`)** — для крупной первичной загрузки и повторных
прогонов из терминала (полный контроль, отчёт в `import-report.md`, картинки
резолвятся из папки рядом с `.md`). Выполняется локально по SSH-туннелю к
серверной БД (порт postgres наружу закрыт):

```bash
ssh -N -L 5433:127.0.0.1:5432 mentors-vps &   # туннель к postgres контейнера через хост
# затем локально с DATABASE_URL=postgresql://mentors:***@127.0.0.1:5433/mentors :
# (именно `pnpm run import` — `pnpm import` без run вызывает встроенную команду pnpm)
pnpm run import -- --file="import/notion/<export>.md" --dry-run
pnpm run import -- --file="import/notion/<export>.md" --commit
```

**2. Админка (`/admin/import`, admin+)** — для команды без доступа к серверу и
SSH: загрузка `.md`-экспорта (до 25 МБ) + опционально `.zip` с картинками,
кнопки «Dry-run»/«Импортировать», прогресс по фазам (разбор → план → запись,
поллинг статуса), отчёт на экране в структуре CLI-отчёта + «Скачать .md», история
запусков (`import_runs`). Загруженный файл валидируется, кладётся во временный
каталог вне git и удаляется после прогона; каждый запуск — в аудите
(`import.executed`). Параллельный запуск двух импортов запрещён (advisory-lock
`notion-import`); импорт идёт в том же процессе (см. `DECISION` в
`lib/services/notion-import/admin-import.ts`).

Когда какой: массовая заливка/сверка «боем» и точный контроль окружения — CLI;
разовая догрузка, вычитка отчёта и повтор силами менторов через браузер —
админка.

### Ротация ссылок библиотеки

Записи собеседований (раздел 7.9 ТЗ) лежат на Я.Диске, ссылки нужно обновлять
примерно раз в месяц. Механика:

- Пульт (`/admin`) показывает флаг «Записи со ссылкой старше 30 дней: N» —
  считается по `recordings.link_updated_at`.
- Джоба воркера `linkRotationReminder` (1-го числа месяца) шлёт админам
  уведомление о записях с устаревшими ссылками.
- Обновление: `/admin/library` → карточка записи → новая ссылка Я.Диска
  (`url` / `embed_url`). Сохранение проставляет `link_updated_at = now`, и запись
  уходит из флага. Публикация возможна только при полном чеклисте (лица/голос/
  имена/согласие) — гейт встроен в форму.

### Бэкапы и восстановление

Ежедневный `pg_dump` в `/opt/mentors/backups` (cron на хосте, ротация 14 дней;
скрипт — `scripts/backup.sh`). Восстановление из дампа:

```bash
cd /opt/mentors
gunzip -c backups/mentors-YYYYMMDD-HHMM.sql.gz | \
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U mentors -d mentors
```

Проверить бэкап перед восстановлением боевой базы — прогнать дамп в отдельную
throwaway-базу и сверить счётчики (`courses`/`lessons`/`questions`/`users`). Перед
`down`/`volume rm` всегда снимать свежий `pg_dump -Fc` (см. заметки dev-ops).

## Статус

Реализованы этапы **0–11** плана работ (раздел 17 ТЗ) + внеочередной мини-этап
«Дев-стенд» (после 5) + заход **12.1** этапа 12. Всё закоммичено, запушено и
развёрнуто на дев-стенде. Пофазовые решения и уточнения — в разделе «Уточнения
(changelog)» файла [MENTORS_TZ.md](./MENTORS_TZ.md) (единственный источник правды
по объёму каждого этапа).

Кратко по этапам: 0 каркас · 1 auth+доступ+антишаринг · 2 контент+гейтинг+студия ·
3 вопросы+квизы+тесты+test-out · 4 SRS · 5 геймификация (события/XP/стрик/цель/
heatmap/дашборд) · 6 моки (слоты/брони/страйки/waitlist/run/рубрики/фидбек) ·
7 библиотека+справочник+закладки · 8 поиск (FTS+палитра) · 9 уведомления+worker+
email+объявления · 10 админ-финал (Пульт/аналитика/students/settings/audit) ·
11 импортер (`/admin/import` + dry-run-зеркало). Заход 12.1: доступы разделов
справочника, tools→курс, редактируемые XP-карта/правила, email-верификация,
размер шрифта чтения, кнопка «Назад», календарь интервьюера.

Текущий заход — **12.2 «Системная полировка»** (финальный строительный заход
перед прод-ревизией этапа 13): мобильный проход 390px, пять состояний и тексты,
доступность (контраст/фокус/reduced-motion/aria), инженерные долги (worker-
heartbeat, README, стабилизация флейки-тестов, гварды RBAC, перф-бюджеты,
санитария консоли) и адверсариальный проход. Этап 13 — финальный прод-runbook.
