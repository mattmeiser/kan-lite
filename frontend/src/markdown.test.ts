import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', () => {
    const html = renderMarkdown('**bold** and a [link](https://example.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it('renders a bullet list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  // The design doc calls this out explicitly ("Non-obvious issues" --
  // markdown needs sanitizing before render, every time): a card
  // description is user-supplied content rendered via
  // dangerouslySetInnerHTML, so unsanitized markdown would be a stored XSS
  // vector.
  it('strips a raw script tag', () => {
    const html = renderMarkdown('Hello <script>alert("xss")</script> world');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(');
  });

  it('strips an inline event handler attribute', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('strips a javascript: link', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  // Design doc, Non-obvious issues: the markdown subset is deliberately
  // narrow -- CommonMark text formatting, links, lists/headings only.
  it('does not render an embedded image, even from a real markdown image tag', () => {
    const html = renderMarkdown('![alt text](https://example.com/cat.png)');
    expect(html).not.toContain('<img');
  });

  it('does not render a GFM task-list checkbox -- Subtasks cover that need instead', () => {
    const html = renderMarkdown('- [ ] unchecked\n- [x] checked');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('type="checkbox"');
  });

  it('does not pass through raw HTML tags that are not on the allowlist', () => {
    const html = renderMarkdown('<div class="whatever">text</div>');
    expect(html).not.toContain('<div');
  });
});
