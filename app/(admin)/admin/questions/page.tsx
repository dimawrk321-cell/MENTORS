import type { Metadata } from "next";
import type { ContentStatus, QuestionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import {
  listCategoriesTree,
  listLessonsForLinking,
  listQuestionsAdmin,
} from "@/lib/services/questions";
import { stripMarkdown } from "@/lib/utils/text";
import { QuestionsBank, type BankCategory, type BankRow } from "./questions-bank";

export const metadata: Metadata = {
  title: "Вопросы",
};

const TYPES = ["open", "single", "multi", "tf", "short_text"];

interface AdminQuestionsPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    type?: string;
    status?: string;
    latex?: string;
    page?: string;
  }>;
}

/** Админ-банк вопросов (spec 8.5): фильтры, массовые операции, редактор по клику. */
export default async function AdminQuestionsPage({ searchParams }: AdminQuestionsPageProps) {
  await requirePermission("content.manage");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [categoriesTree, lessons, bank] = await Promise.all([
    listCategoriesTree(prisma),
    listLessonsForLinking(prisma),
    listQuestionsAdmin(prisma, {
      q: params.q?.trim() || undefined,
      categoryId: params.category || undefined,
      type: TYPES.includes(params.type ?? "") ? (params.type as QuestionType) : undefined,
      status: ["draft", "published"].includes(params.status ?? "")
        ? (params.status as ContentStatus)
        : undefined,
      needsLatex: params.latex === "1",
      page,
    }),
  ]);

  const categories: BankCategory[] = categoriesTree.map((root) => ({
    id: root.id,
    title: root.title,
    colorIndex: root.colorIndex,
    children: root.children.map((child) => ({ id: child.id, title: child.title })),
  }));

  const rows: BankRow[] = bank.items.map((question) => ({
    id: question.id,
    teaser: stripMarkdown(question.textMd, 120) || "— без текста —",
    type: question.type,
    difficulty: question.difficulty,
    status: question.status,
    needsLatex: question.needsLatex,
    categoryTitle: question.category.title,
    links: question._count.lessonLinks,
  }));

  return (
    <QuestionsBank
      categories={categories}
      lessons={lessons}
      rows={rows}
      total={bank.total}
      page={bank.page}
      pageSize={bank.pageSize}
      filters={{
        q: params.q ?? "",
        category: params.category ?? "",
        type: params.type ?? "",
        status: params.status ?? "",
        latex: params.latex === "1",
      }}
    />
  );
}
