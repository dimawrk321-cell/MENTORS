import type { Prisma, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";

/**
 * Требует, чтобы клиент был клиентом ИНТЕРАКТИВНОЙ ТРАНЗАКЦИИ (заход A.2).
 *
 * Нужно там, где корректность держится на строчной блокировке: на корневом
 * клиенте каждый запрос идёт своей транзакцией, поэтому `SELECT … FOR UPDATE`
 * снимается сразу же и не защищает ничего — а выглядит как защита.
 *
 * Проверка рантаймовая, а не типовая, потому что типом это не закрыть:
 * `PrismaClient` структурно присваиваем к `Prisma.TransactionClient` (у него
 * есть все её члены и сверх того), так что TypeScript такой вызов пропускает.
 * Признак взят из замера, а не из документации (принцип 0.9): у клиента
 * транзакции `typeof tx.$transaction === "undefined"` и `"$transaction" in tx`
 * даёт false, у корневого — `function`.
 *
 * DECISION: живёт в utils, а не в `lib/db.ts`, хотя тип `Db` объявлен там.
 * `lib/db.ts` мокается в тестах (`vi.mock("@/lib/db")` подменяет клиента на
 * тестовый), и любой новый экспорт оттуда пришлось бы дублировать в каждом
 * моке. Проверка — чистая функция без состояния, ей место рядом с утилитами.
 */
export function assertInTransaction(
  db: Db,
  fnName: string,
): asserts db is Prisma.TransactionClient {
  if (typeof (db as PrismaClient).$transaction === "function") {
    throw new Error(
      `${fnName}: вызов вне транзакции. Строчная блокировка на корневом клиенте ` +
        `не удерживается — оберни вызывающее действие в db.$transaction(...).`,
    );
  }
}
