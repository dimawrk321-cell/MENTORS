"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** «Копировать» for invite links etc. (spec changelog to 7.1). */
export function CopyButton({ value, label = "Копировать" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Не удалось скопировать — выдели и скопируй вручную", variant: "danger" });
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={copy} className="shrink-0">
      {copied ? (
        <Check size={14} strokeWidth={2} className="text-success" aria-hidden="true" />
      ) : (
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
      {copied ? "Скопировано" : label}
    </Button>
  );
}
