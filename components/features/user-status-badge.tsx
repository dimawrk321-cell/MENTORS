import type { UserStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const STATUS_VIEW: Record<
  UserStatus,
  { label: string; variant: "accent" | "success" | "warning" | "danger" }
> = {
  invited: { label: "Приглашён", variant: "accent" },
  active: { label: "Активен", variant: "success" },
  expired: { label: "Истёк", variant: "warning" },
  blocked: { label: "Заблокирован", variant: "danger" },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const view = STATUS_VIEW[status];
  return <Badge variant={view.variant}>{view.label}</Badge>;
}
