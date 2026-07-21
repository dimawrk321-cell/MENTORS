import type { Metadata } from "next";
import { requireStudentZone } from "@/lib/auth/guards";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Первые шаги",
};

// Onboarding (spec 8.2, walk 12.4/A4): four cards — name (mandatory), goal
// (track), daily time (goal XP), reminders (digest time). Reached after the
// forced set-password screen, or by the student-zone name gate when a fresh
// student has no name yet. `onboarding: true` exempts this page from that gate
// (it is where the name is set) so it never redirects onto itself.
export default async function OnboardingPage() {
  const { user } = await requireStudentZone({ onboarding: true });

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center py-6">
      <OnboardingFlow
        initialName={user.name}
        initialTrack={user.track}
        initialGoal={user.dailyGoalXp as 30 | 60 | 120}
        initialDigestTime={user.digestTime}
      />
    </div>
  );
}
