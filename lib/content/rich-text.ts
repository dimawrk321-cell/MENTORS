import type { AnyExtension, MarkdownLexerConfiguration, MarkdownToken } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

export const RICH_TEXT_SIZE = {
  small: "0.875em",
  large: "1.125em",
} as const;

type RichSize = keyof typeof RICH_TEXT_SIZE;

interface InlineDirectiveToken extends MarkdownToken {
  size?: RichSize;
}

/**
 * Reads `:name[...]` without losing nested markdown such as
 * `:underline[a [link](https://example.com)]`.
 */
function directiveToken(
  source: string,
  names: readonly string[],
  lexer: MarkdownLexerConfiguration,
): InlineDirectiveToken | undefined {
  const name = names.find((candidate) => source.startsWith(`:${candidate}[`));
  if (!name) return undefined;

  const contentStart = name.length + 2;
  let depth = 1;
  let escaped = false;
  for (let index = contentStart; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") depth -= 1;
    if (depth !== 0) continue;

    const raw = source.slice(0, index + 1);
    const text = source.slice(contentStart, index);
    return {
      type: name === "underline" ? "underline" : "richTextSize",
      raw,
      text,
      tokens: lexer.inlineTokens(text),
      ...(name === "small" || name === "large" ? { size: name } : {}),
    };
  }
  return undefined;
}

const UnderlineDirective = Underline.extend({
  renderMarkdown(node, helpers) {
    return `:underline[${helpers.renderChildren(node)}]`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(source) {
      return source.indexOf(":underline[");
    },
    tokenize(source, _tokens, lexer) {
      return directiveToken(source, ["underline"], lexer);
    },
  },
});

const RichTextStyle = TextStyle.extend({
  markdownTokenName: "richTextSize",
  parseMarkdown(token, helpers) {
    const richToken = token as typeof token & { size?: RichSize };
    const fontSize = richToken.size ? RICH_TEXT_SIZE[richToken.size] : null;
    return helpers.applyMark(
      "textStyle",
      helpers.parseInline(token.tokens ?? []),
      fontSize ? { fontSize } : undefined,
    );
  },
  renderMarkdown(node, helpers) {
    const fontSize = node.attrs?.fontSize;
    const size =
      fontSize === RICH_TEXT_SIZE.small
        ? "small"
        : fontSize === RICH_TEXT_SIZE.large
          ? "large"
          : null;
    return size ? `:${size}[${helpers.renderChildren(node)}]` : helpers.renderChildren(node);
  },
  markdownTokenizer: {
    name: "richTextSize",
    level: "inline",
    start(source) {
      const small = source.indexOf(":small[");
      const large = source.indexOf(":large[");
      if (small === -1) return large;
      if (large === -1) return small;
      return Math.min(small, large);
    },
    tokenize(source, _tokens, lexer) {
      return directiveToken(source, ["small", "large"], lexer);
    },
  },
});

/** One editor schema for the React editor and round-trip tests. */
export function richTextExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    UnderlineDirective,
    RichTextStyle,
    FontSize,
    Image.configure({ inline: false, allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
