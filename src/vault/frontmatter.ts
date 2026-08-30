import matter from "gray-matter";

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter and content from a markdown string.
 *
 * Never throws. A single note with malformed YAML used to take down every
 * command that walks the vault — and the ones most likely to have broken
 * frontmatter are exactly the scraps typed on a phone. Worse, `--append` wrote
 * to disk and then crashed with exit 1, so the natural retry duplicated the
 * entry. On a parse failure the frontmatter block is stripped and the body is
 * still returned, so the day's writing stays readable.
 */
export function parseFrontmatter<T = Record<string, unknown>>(markdown: string): {
  frontmatter: T;
  content: string;
  /** True when the YAML could not be parsed and the block was stripped instead */
  unreadable: boolean;
} {
  try {
    const { data, content } = matter(markdown);
    return { frontmatter: data as T, content: content.trim(), unreadable: false };
  } catch {
    return {
      frontmatter: {} as T,
      content: markdown.replace(FRONTMATTER_BLOCK, "").trim(),
      unreadable: true,
    };
  }
}

/** Serialize frontmatter and content back to a markdown string */
export function serializeFrontmatter<T extends object>(
  frontmatter: T,
  content: string,
): string {
  return matter.stringify(content, frontmatter as Record<string, unknown>);
}
