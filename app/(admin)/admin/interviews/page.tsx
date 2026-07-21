import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import {
  listAllBookings,
  listInterviewerProfiles,
  listStrikesWithLocks,
  listWaitlist,
} from "@/lib/services/mock-admin";
import { getRubricCriteria } from "@/lib/services/feedback";
import { AdminInterviews } from "@/components/features/admin-interviews";

export const metadata: Metadata = {
  title: "Интервью",
};

/** /admin/interviews (spec 8.5): брони, страйки/локи, рубрики, waitlist, профили. */
export default async function AdminInterviewsPage() {
  // Walk 12.4/B: a single `interviews.manage` permission gates the whole center;
  // anyone who can see it can mutate (the old mentor-view/admin-mutate split is gone).
  const { user } = await requirePermission("interviews.manage");
  const now = new Date();

  const [bookings, strikes, waitlist, profiles, theory, legend] = await Promise.all([
    listAllBookings(prisma, {}),
    listStrikesWithLocks(prisma, now),
    listWaitlist(prisma),
    listInterviewerProfiles(prisma),
    getRubricCriteria(prisma, "theory"),
    getRubricCriteria(prisma, "legend"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[24px] font-semibold">Интервью</h1>
      <AdminInterviews
        bookings={bookings}
        strikes={strikes}
        waitlist={waitlist}
        profiles={profiles}
        rubrics={{ theory, legend }}
        timezone={user.timezone}
        canMutate={true}
      />
    </div>
  );
}
