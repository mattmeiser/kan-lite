import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Scope is deliberately narrow (design doc, Non-obvious issues): CommonMark
// text formatting, links, and lists/headings only -- no raw HTML
// passthrough, no embedded images, no task-list checkboxes (Subtasks
// already cover that need as a real toggleable field). `gfm: false` keeps
// marked to plain CommonMark, which alone rules out task lists and tables;
// the explicit ALLOWED_TAGS/ALLOWED_ATTR below is what actually rules out
// raw HTML and <img> regardless of what any renderer produces.
marked.setOptions({ breaks: true, gfm: false });

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'hr'];

/** Card descriptions are markdown -- always sanitize before rendering (design doc, Non-obvious issues). */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href'] });
}
