// A small Markdown reader for the text this app displays: issue descriptions
// from the task library and replies from the local models. Both arrive as raw
// Markdown, and dumping that into a single paragraph is unreadable.
//
// `parseMarkdown` is pure so it can be tested directly; `renderMarkdown` builds
// DOM nodes only through createElement and text nodes, never innerHTML, so
// untrusted issue text cannot inject markup.

const SAFE_LINK = /^https?:\/\//i;

export function parseSpans(text) {
  const spans = [];
  let rest = String(text ?? '');
  // Code spans are taken first so emphasis markers inside them stay literal.
  const pattern = /(`[^`\n]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|\b_[^_\n]+_\b)/;
  while (rest) {
    const match = pattern.exec(rest);
    if (!match) { spans.push({type: 'text', text: rest}); break; }
    if (match.index > 0) spans.push({type: 'text', text: rest.slice(0, match.index)});
    const token = match[0];
    if (token.startsWith('`')) spans.push({type: 'code', text: token.slice(1, -1)});
    else if (token.startsWith('![')) {
      const [, label, href] = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      spans.push({type: 'image', text: label || 'screenshot', href});
    } else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      spans.push({type: 'link', text: label, href});
    } else if (token.startsWith('**')) spans.push({type: 'strong', text: token.slice(2, -2)});
    else spans.push({type: 'em', text: token.slice(1, -1)});
    rest = rest.slice(match.index + token.length);
  }
  return spans.filter(span => span.type !== 'text' || span.text.length);
}

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [], list = null;

  const flushParagraph = () => { if (paragraph.length) { blocks.push({type: 'paragraph', spans: parseSpans(paragraph.join(' '))}); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flush = () => { flushParagraph(); flushList(); };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) body.push(lines[index++]);
      blocks.push({type: 'code', language: fence[1] || '', text: body.join('\n')});
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); blocks.push({type: 'heading', level: heading[1].length, spans: parseSpans(heading[2])}); continue; }
    // GitHub issue templates use a fully bold line as a section heading
    // ("**To Reproduce**"), and reading it as one is far clearer than letting it
    // merge into the paragraph that follows.
    const boldHeading = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/.exec(line);
    if (boldHeading) { flush(); blocks.push({type: 'heading', level: 3, spans: parseSpans(boldHeading[1])}); continue; }
    if (/^\s{0,3}([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); blocks.push({type: 'rule'}); continue; }
    const item = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const ordered = !!item[2];
      if (!list || list.ordered !== ordered) { flushList(); list = {type: 'list', ordered, items: []}; }
      list.items.push(parseSpans(item[3]));
      continue;
    }
    // A plain line following a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1].push(...parseSpans(` ${line.trim()}`)); continue; }
    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

function appendSpans(parent, spans, document) {
  for (const span of spans) {
    if (span.type === 'text') { parent.append(document.createTextNode(span.text)); continue; }
    if (span.type === 'link' || span.type === 'image') {
      // Anything that is not plainly http(s) is shown as text, never linked.
      if (!SAFE_LINK.test(span.href)) { parent.append(document.createTextNode(span.text)); continue; }
      const link = document.createElement('a');
      link.href = span.href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = span.type === 'image' ? `🖼 ${span.text}` : span.text;
      if (span.type === 'image') link.className = 'md-image-link';
      parent.append(link);
      continue;
    }
    const tag = {code: 'code', strong: 'strong', em: 'em'}[span.type];
    const node = document.createElement(tag);
    node.textContent = span.text;
    parent.append(node);
  }
}

export function renderMarkdown(source, target, document = globalThis.document) {
  target.replaceChildren();
  for (const block of parseMarkdown(source)) {
    if (block.type === 'code') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.append(code);
      target.append(pre);
      continue;
    }
    if (block.type === 'rule') { target.append(document.createElement('hr')); continue; }
    if (block.type === 'list') {
      const listNode = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        appendSpans(li, item, document);
        listNode.append(li);
      }
      target.append(listNode);
      continue;
    }
    // Headings deeper than the panel's own hierarchy flatten to h4.
    const node = document.createElement(block.type === 'heading' ? `h${Math.min(4, block.level + 1)}` : 'p');
    appendSpans(node, block.spans, document);
    target.append(node);
  }
  return target;
}
