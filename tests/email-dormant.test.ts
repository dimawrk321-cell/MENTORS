import { describe, it, expect } from "vitest";
import { EMAIL_VERIFICATION_UI_ENABLED } from "@/lib/constants";

// D1 (spec 13.1): the soft email-verification UI is @dormant — banner, profile
// form/badge and the admin badges are all gated on this single flag, so with it
// off the banner never renders. The underlying mechanism (issueEmailCode /
// verifyEmailCode / email_verified_at) stays live — see email-verification.test.ts.

describe("email verification UI @dormant (spec 13.1/D1)", () => {
  it("the verification UI flag is off, so the banner/form/badges never render", () => {
    expect(EMAIL_VERIFICATION_UI_ENABLED).toBe(false);
  });
});
