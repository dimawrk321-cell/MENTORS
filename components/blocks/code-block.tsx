"use client";

import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Wrapper over Shiki's <pre> (spec 5.3): copy button, optional line numbers
 * (fence meta `numbers` → data-line-numbers, CSS counters in globals).
 * Code is deliberately copyable — spec 11 keeps copy/paste free.
 */
export function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const text = preRef.current?.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — selection is still possible, stay quiet.
    }
  }

  return (
    <div className="group relative my-5">
      <pre ref={preRef} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Скопировано" : "Копировать код"}
        className="border-border bg-surface-2 text-text-3 ease-app hover:text-text-1 absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-[6px] border opacity-0 transition-[opacity,color] duration-150 group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? (
          <Check size={13} strokeWidth={2} className="text-success" />
        ) : (
          <Copy size={13} strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
