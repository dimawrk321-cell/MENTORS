import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireOwnerZone } from "@/lib/auth/guards";
import { parsePermissions } from "@/lib/auth/permissions";
import { listTeam } from "@/lib/services/team";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { PageHeader } from "@/components/ui/page-header";
import { AddMemberDialog } from "./add-member-dialog";
import { TeamMemberCard, type TeamMemberView } from "./team-member-card";

export const metadata: Metadata = {
  title: "Команда",
};

/** /admin/team (spec 12.4/B4): owner-only staff list + management. */
export default async function TeamPage() {
  const { user: viewer } = await requireOwnerZone();
  const members = await listTeam(prisma);

  const rows: TeamMemberView[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role as TeamMemberView["role"],
    isInterviewer: m.isInterviewer,
    status: m.status,
    override: parsePermissions(m.permissions),
    avatarColor: m.avatarColor,
    lastSeenText: m.lastSeenAt ? formatDateTimeRu(m.lastSeenAt, viewer.timezone) : "—",
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        size="admin"
        title="Команда"
        subtitle="Роли, права и доступы участников платформы."
        actions={<AddMemberDialog />}
      />

      <div className="flex flex-col gap-4">
        {rows.map((member) => (
          <TeamMemberCard
            // Content key: any owner-side change (role/permissions/interviewer/
            // status) remounts the card so its controls resync with server truth.
            key={`${member.id}:${member.role}:${member.override?.join("|") ?? "preset"}:${member.isInterviewer}:${member.status}`}
            member={member}
          />
        ))}
      </div>
    </div>
  );
}
