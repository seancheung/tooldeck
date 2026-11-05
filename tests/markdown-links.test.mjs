const fixture = JSON.parse(fs.readFileSync('tests/fixtures/markdown.zh-CN.json', 'utf8'));
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const code = ts.transpileModule(fs.readFileSync('src/remarkExplicitLinks.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { default: explicitLinks } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const render = text => renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, explicitLinks] }, text));
test('bare URLs and emails remain text, including adjacent Chinese punctuation', () => {
  const text = fixture.paragraph;
  const html = render(text);
  assert.ok(!html.includes('<a '));
  assert.ok(html.includes(text));
});
test('explicit links, references, autolink syntax and GFM tables still render', () => {
  const html = render(fixture.markdown);
  assert.equal((html.match(/<a /g) || []).length, 3);
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes(`<del>${fixture.cell}</del>`));
});
