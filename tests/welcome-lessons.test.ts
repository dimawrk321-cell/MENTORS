import { beforeEach, describe, expect, it } from "vitest";
import { addMissingWelcomeLessons, ensureWelcomeCourse } from "@/lib/services/welcome-course";
import { resetDb, testDb } from "./helpers/db";

// Заход B.2, блок 2.3. Инвариант, который нельзя нарушить: существующий вводный
// курс не перезаписывается — правки ментора это его правки. Новый урок при этом
// должен доехать и до баз, где курс уже создан.

beforeEach(async () => {
  await resetDb();
});

async function welcomeLessons() {
  const course = await testDb.course.findUniqueOrThrow({
    where: { slug: "welcome" },
    include: { modules: { include: { lessons: { orderBy: { order: "asc" } } } } },
  });
  return course.modules[0]!.lessons;
}

describe("ensureWelcomeCourse", () => {
  it("создаёт курс со всеми уроками сида, включая «Правила игры»", async () => {
    await ensureWelcomeCourse(testDb);
    const lessons = await welcomeLessons();
    expect(lessons.map((l) => l.slug)).toContain("pravila-igry");
    expect(lessons.every((l) => l.status === "published")).toBe(true);
  });

  it("существующий курс не трогает вовсе", async () => {
    await ensureWelcomeCourse(testDb);
    const before = await welcomeLessons();
    await testDb.lesson.update({
      where: { id: before[0]!.id },
      data: { contentMd: "Текст, переписанный ментором." },
    });

    await ensureWelcomeCourse(testDb);
    const after = await welcomeLessons();
    expect(after[0]!.contentMd).toBe("Текст, переписанный ментором.");
    expect(after).toHaveLength(before.length);
  });
});

describe("addMissingWelcomeLessons", () => {
  it("доносит недостающий урок в конец и не трогает существующие", async () => {
    await ensureWelcomeCourse(testDb);
    const all = await welcomeLessons();
    const rules = all.find((l) => l.slug === "pravila-igry")!;
    // База «до захода B.2»: урока «Правила игры» ещё нет, остальное правил ментор.
    await testDb.lesson.delete({ where: { id: rules.id } });
    await testDb.lesson.update({
      where: { id: all[0]!.id },
      data: { contentMd: "Правка ментора.", title: "Своё название" },
    });

    const result = await addMissingWelcomeLessons(testDb);
    expect(result.added).toEqual(["pravila-igry"]);

    const after = await welcomeLessons();
    expect(after).toHaveLength(all.length);
    // Существующий урок не тронут ни текстом, ни названием.
    expect(after[0]!.contentMd).toBe("Правка ментора.");
    expect(after[0]!.title).toBe("Своё название");
    // Новый встал последним и опубликован.
    const added = after[after.length - 1]!;
    expect(added.slug).toBe("pravila-igry");
    expect(added.status).toBe("published");
    expect(added.order).toBeGreaterThan(after[after.length - 2]!.order);
  });

  // Тот самый инвариант, ради которого дозаливка сверяется по slug, а не по
  // содержимому: ментор переписал «Правила игры» под себя — повторный прогон
  // скрипта обязан оставить его текст в покое.
  it("переписанный ментором урок повторный прогон НЕ трогает", async () => {
    await ensureWelcomeCourse(testDb);
    const rules = (await welcomeLessons()).find((l) => l.slug === "pravila-igry")!;
    await testDb.lesson.update({
      where: { id: rules.id },
      data: {
        title: "Правила игры (версия Димы)",
        contentMd: "Полностью свой текст ментора.\n\nВторой абзац.",
        status: "draft",
        order: 1,
      },
    });
    const edited = await testDb.lesson.findUniqueOrThrow({ where: { id: rules.id } });

    const result = await addMissingWelcomeLessons(testDb);
    expect(result.added).toEqual([]);

    const after = await testDb.lesson.findUniqueOrThrow({ where: { id: rules.id } });
    expect(after.contentMd).toBe("Полностью свой текст ментора.\n\nВторой абзац.");
    expect(after.title).toBe("Правила игры (версия Димы)");
    // Ни статус, ни порядок, ни отметка изменения не тронуты — записи не было.
    expect(after.status).toBe("draft");
    expect(after.order).toBe(1);
    expect(after.updatedAt.getTime()).toBe(edited.updatedAt.getTime());
    // Дубликата рядом тоже не появилось.
    expect((await welcomeLessons()).filter((l) => l.slug === "pravila-igry")).toHaveLength(1);
  });

  it("повторный прогон — ноль изменений", async () => {
    await ensureWelcomeCourse(testDb);
    const first = await addMissingWelcomeLessons(testDb);
    expect(first.added).toEqual([]);

    const before = await welcomeLessons();
    const second = await addMissingWelcomeLessons(testDb);
    const after = await welcomeLessons();
    expect(second.added).toEqual([]);
    expect(after.map((l) => `${l.slug}:${l.order}:${l.updatedAt.getTime()}`)).toEqual(
      before.map((l) => `${l.slug}:${l.order}:${l.updatedAt.getTime()}`),
    );
  });

  it("dry-run ничего не пишет", async () => {
    await ensureWelcomeCourse(testDb);
    const all = await welcomeLessons();
    await testDb.lesson.delete({
      where: { id: all.find((l) => l.slug === "pravila-igry")!.id },
    });

    const result = await addMissingWelcomeLessons(testDb, true);
    expect(result.added).toEqual(["pravila-igry"]);
    expect(await welcomeLessons()).toHaveLength(all.length - 1);
  });

  it("без курса — тихий no-op (курс ещё не создавали)", async () => {
    expect(await addMissingWelcomeLessons(testDb)).toEqual({ added: [], skipped: 0 });
  });
});
