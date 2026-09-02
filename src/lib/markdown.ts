import { marked } from "marked";
import DOMPurify from "dompurify";

marked.use({ gfm: true, breaks: true });

/** Render markdown to sanitized HTML. Content round-trips through sync, so we
 *  always sanitize before it reaches the DOM. */
export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }));
}
