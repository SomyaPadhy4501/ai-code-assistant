import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdown, parseSpans, renderMarkdown} from '../dist/markdown.js';

test('inline spans separate code, links, images and emphasis', () => {
  const spans = parseSpans('The `onfocusin` attr in [4307](https://github.com/x/y/pull/4307) is **wrong**.');
  assert.deepEqual(spans.map(s => s.type), ['text', 'code', 'text', 'link', 'text', 'strong', 'text']);
  assert.equal(spans[1].text, 'onfocusin');
  assert.equal(spans[3].href, 'https://github.com/x/y/pull/4307');
  // Emphasis markers inside a code span stay literal.
  assert.deepEqual(parseSpans('`a ** b`').map(s => s.text), ['a ** b']);
});

test('a fully bold line reads as a heading, the way issue templates use it', () => {
  const blocks = parseMarkdown('**To Reproduce**\n1. Open the page\n2. Click the field');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].spans[0].text, 'To Reproduce');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[1].ordered, true);
  assert.equal(blocks[1].items.length, 2);
});

test('headings, rules, fenced code and both list kinds are recognised', () => {
  const blocks = parseMarkdown(['## Expected behavior', 'It should work.', '', '---', '', '```js', 'const a = 1;', '```', '', '- one', '- two'].join('\n'));
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'paragraph', 'rule', 'code', 'list']);
  assert.equal(blocks[3].text, 'const a = 1;');
  assert.equal(blocks[3].language, 'js');
  assert.equal(blocks[4].ordered, false);
});

test('issue text cannot inject markup and only http links are linked', () => {
  const fake = {
    createElement: tag => ({tag, children: [], attributes: {}, set textContent(value) { this._text = value; }, get textContent() { return this._text; }, append(...kids) { this.children.push(...kids); }, replaceChildren() { this.children = []; }, set href(v) { this.attributes.href = v; }, set className(v) { this.attributes.className = v; }, set target(v) {}, set rel(v) {}}),
    createTextNode: text => ({text})
  };
  const target = fake.createElement('div');
  renderMarkdown('<script>alert(1)</script> and [x](javascript:alert(1)) and [ok](https://example.com)', target, fake);
  const flat = JSON.stringify(target.children);
  assert.ok(flat.includes('<script>'), 'raw markup is carried as text, never parsed');
  assert.ok(!flat.includes('javascript:'), 'a javascript: URL is never turned into a link');
  assert.ok(flat.includes('https://example.com'), 'an http link survives');
});

test('empty and plain input degrade quietly', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
  const [only] = parseMarkdown('Just one sentence.');
  assert.equal(only.type, 'paragraph');
  assert.equal(only.spans[0].text, 'Just one sentence.');
});
