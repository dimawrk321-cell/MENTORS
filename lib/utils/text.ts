// Plain-text teaser out of markdown for catalog cards and admin tables.
// Not a parser — just enough cleanup for a one-line preview.

export function stripMarkdown(markdown: string, maxLength = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::[a-z]*\{[^}]*\}|:::/g, " ")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
