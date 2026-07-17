import { env } from "@/lib/env";

// Shared email layout (spec 3/7.12/18): one restrained HTML shell, no marketing,
// links only to PLATFORM_URL (spec 11). Everything inline — email clients strip
// <style>/external assets. BRAND_NAME/PLATFORM_URL come from env (spec 0.5).

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface EmailBody {
  /** Heading shown at the top of the message. */
  title: string;
  /** Body paragraphs (plain strings; escaped into HTML). */
  paragraphs: string[];
  /** Optional call-to-action button. */
  cta?: { label: string; path: string };
  /** Small muted note under the CTA (e.g. link lifetime). */
  note?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute link on PLATFORM_URL (spec 11). Already-absolute paths pass through. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = env.platformUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Renders the shared HTML + plain-text bodies for a message. */
export function renderEmailBody(body: EmailBody): { html: string; text: string } {
  const brand = env.brandName;
  const paragraphsHtml = body.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#17181A;">${escapeHtml(
          p,
        )}</p>`,
    )
    .join("");

  const ctaHtml = body.cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(
        absoluteUrl(body.cta.path),
      )}" style="display:inline-block;background:#4C57C4;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 20px;border-radius:10px;">${escapeHtml(
        body.cta.label,
      )}</a></p>`
    : "";

  const noteHtml = body.note
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5F646D;">${escapeHtml(
        body.note,
      )}</p>`
    : "";

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#FAFAF9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;">
<tr><td style="padding:24px 28px 8px;">
<div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:#17181A;">${escapeHtml(brand)}</div>
</td></tr>
<tr><td style="padding:8px 28px 24px;">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-.01em;color:#17181A;">${escapeHtml(
    body.title,
  )}</h1>
${paragraphsHtml}${ctaHtml}${noteHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(0,0,0,.07);">
<p style="margin:0;font-size:12px;line-height:1.5;color:#8A8F98;">${escapeHtml(
    brand,
  )} · <a href="${escapeHtml(
    env.platformUrl,
  )}" style="color:#8A8F98;">${escapeHtml(env.platformUrl)}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;

  const textParts = [body.title, "", ...body.paragraphs];
  if (body.cta) textParts.push("", `${body.cta.label}: ${absoluteUrl(body.cta.path)}`);
  if (body.note) textParts.push("", body.note);
  textParts.push("", `${brand} · ${env.platformUrl}`);
  const text = textParts.join("\n");

  return { html, text };
}

/** Builds a full EmailContent (subject + rendered bodies) from an EmailBody. */
export function buildEmail(subject: string, body: EmailBody): EmailContent {
  const { html, text } = renderEmailBody(body);
  return { subject, html, text };
}
