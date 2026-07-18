import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { auditDateBounds, getAuditFilterOptions, listAuditLog } from "@/lib/services/audit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AuditTable } from "./audit-table";

export const metadata: Metadata = { title: "Аудит" };

const fieldClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 border bg-transparent px-3 text-[14px] transition-colors duration-150";

interface PageProps {
  searchParams: Promise<{ actor?: string; entity?: string; from?: string; to?: string }>;
}

/** /admin/audit (spec 8.5, owner): audit log with filters + cursor pagination. */
export default async function AuditPage({ searchParams }: PageProps) {
  const { user } = await requireAdminZone("owner");
  const sp = await searchParams;

  const filters = {
    actorId: sp.actor || undefined,
    entityType: sp.entity || undefined,
    ...auditDateBounds(sp.from, sp.to, user.timezone),
  };

  const [{ rows, nextCursor }, options] = await Promise.all([
    listAuditLog(prisma, filters),
    getAuditFilterOptions(prisma),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[24px] font-semibold">Аудит</h1>
        <p className="text-text-2 mt-1 text-[14px]">
          Все мутации admin/mentor/owner. Только чтение.
        </p>
      </div>

      {/* Фильтры — обычная GET-форма (searchParams перезагружают первую страницу). */}
      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">Актор</span>
            <select name="actor" defaultValue={sp.actor ?? ""} className={fieldClass}>
              <option value="">Все</option>
              {options.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">Сущность</span>
            <select name="entity" defaultValue={sp.entity ?? ""} className={fieldClass}>
              <option value="">Все</option>
              {options.entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">С</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">По</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={fieldClass} />
          </label>
          <Button type="submit" variant="secondary">
            Применить
          </Button>
        </form>
      </Card>

      <AuditTable
        initialRows={rows}
        initialCursor={nextCursor}
        filters={{ actorId: sp.actor, entityType: sp.entity, from: sp.from, to: sp.to }}
        timezone={user.timezone}
      />
    </div>
  );
}
