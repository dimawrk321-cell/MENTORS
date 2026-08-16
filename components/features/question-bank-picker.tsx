"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchQuizQuestionsAction, type QuizPickerRow } from "@/lib/actions/questions-admin";

// Выбор вопроса из банка для вставки в текст урока (заход B.1, блок 2.4).
//
// DECISION: минимальный выбор — поиск по тексту вопроса, без фильтра категорий
// и пагинации (двадцать свежих совпадений). Полноценный обозреватель банка уже
// есть в /admin/questions, а здесь задача одна: ментор не должен знать id.
// Выдача — только опубликованные вопросы С ВАРИАНТАМИ: остальные у ученика в
// тексте не отрисуются, и предлагать их значило бы закладывать молчаливую
// пропажу.

export function QuestionBankPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (row: QuizPickerRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<QuizPickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void searchQuizQuestionsAction(query.trim()).then((result) => {
        setLoading(false);
        if (result?.ok) setRows(result.data);
      });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Вопрос из банка</DialogTitle>
        <p className="text-text-3 mb-3 text-[13px]">
          Показаны опубликованные вопросы с вариантами ответа — только их можно пройти прямо в
          тексте урока.
        </p>
        <div className="relative">
          <Search
            size={14}
            strokeWidth={1.75}
            className="text-text-3 absolute top-1/2 left-3 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по тексту вопроса"
            aria-label="Поиск по банку вопросов"
            className="pl-8"
            autoFocus
          />
        </div>

        {loading && <p className="text-text-3 mt-3 text-[12px]">Ищу…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-text-3 mt-3 text-[13px]">
            Ничего не нашлось. Вопрос должен быть опубликован и иметь варианты ответа.
          </p>
        )}
        <ul className="mt-3 flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(row);
                  onOpenChange(false);
                }}
                className="rounded-control border-border hover:border-border-strong hover:bg-surface-2 ease-app w-full border px-3 py-2 text-left text-[13px] transition-colors duration-150"
              >
                <span className="block">{row.teaser}</span>
                <span className="text-text-3 mt-0.5 block text-[12px]">
                  {row.category} · {row.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
