import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { renderMarkdownHtml } from "@/lib/utils/markdown";

export const dynamic = "force-dynamic";

/** Unsaved body preview, rendered through the shared safe Markdown pipeline. */
export async function POST(request: Request) {
  const auth = await getAuth();
  if (auth.state !== "valid" || !hasPermission(auth.user, "content.manage")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const markdown =
    typeof body === "object" && body !== null && "markdown" in body
      ? (body as { markdown?: unknown }).markdown
      : null;
  if (typeof markdown !== "string" || markdown.length > 300_000) {
    return NextResponse.json({ error: "Слишком большой документ" }, { status: 400 });
  }

  const html = await renderMarkdownHtml(markdown);
  return NextResponse.json({ html });
}
