import { NextResponse } from "next/server";

// Deploy healthcheck (spec 18): the docker-compose web healthcheck and Caddy's
// upstream probe hit this endpoint. It reports that the web process is up and
// serving — deliberately DB-independent so a transient DB blip does not flap the
// container health (migrations already ran in the entrypoint before start).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "mentors-web" });
}
