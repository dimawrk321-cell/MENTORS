import type { Metadata } from "next";
import { requireStudentZone } from "@/lib/auth/guards";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Первые шаги",
};

// Onboarding (spec 8.2): three cards — goal (track), daily time (goal XP),
// reminders (digest time). Reached via the accepted-invite redirect.
// DECISION: no dedicated "onboarded" flag — the flow guarantees a single pass
// (invite → onboarding), revisiting the URL later is harmless settings access.
export default async function OnboardingPage() {
  const { user } = await requireStudentZone();

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center py-6">
      <OnboardingFlow
        initialTrack={user.track}
        initialGoal={user.dailyGoalXp as 30 | 60 | 120}
        initialDigestTime={user.digestTime}
      />
    </div>
  );
}
