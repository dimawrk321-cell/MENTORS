"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/auth/action-helpers";

interface ActionButtonProps {
  /** Pre-bound server action returning the standard result shape (spec 9). */
  action: () => Promise<ActionResult<unknown> | void>;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  successMessage?: string;
  /** When set, the click opens a confirm dialog first. */
  confirm?: { title: string; description: string; actionLabel: string };
}

/**
 * Button for admin card mutations: optional confirm dialog, pending spinner,
 * toast on error/success. Redirecting actions resolve to void and are left
 * to the router.
 */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  className,
  successMessage,
  confirm,
}: ActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(): void {
    startTransition(async () => {
      const result = await action();
      if (!result) return; // redirect happened
      if (result.ok) {
        setOpen(false);
        if (successMessage) toast({ title: successMessage, variant: "success" });
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  if (!confirm) {
    return (
      <Button variant={variant} size={size} className={className} loading={pending} onClick={run}>
        {children}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        loading={pending}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm.title}</DialogTitle>
            <DialogDescription>{confirm.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" loading={pending} onClick={run}>
              {confirm.actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
