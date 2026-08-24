const LEADING_LESSON_TITLE =
  /^(?:\uFEFF)?(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}[ \t]+(?:\*\*|__)?[ \t]*Название урока[ \t]*:[^\r\n]*(?:\r?\n|$)/i;

/**
 * Imported lesson snapshots sometimes repeat lesson metadata as their first
 * Markdown heading. Keep the stored snapshot intact, but hide this one known
 * duplicate in student and preview rendering.
 */
export function lessonStepMarkdownForDisplay(markdown: string): string {
  const match = markdown.match(LEADING_LESSON_TITLE);
  if (!match) return markdown;
  return markdown.slice(match[0].length).replace(/^[ \t]*\r?\n/, "");
}
