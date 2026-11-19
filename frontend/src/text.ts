/**
 * Plain-text version of a markdown snippet for compact display (thread titles).
 * Display only: the stored title is unchanged. Handles the common syntax: links and images
 * ([text](url) -> text), **bold** / __bold__ / *em*, `code`, and leading #, >, -, *, + markers.
 */
export function plainTitle(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+)+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/\*\*|__|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
