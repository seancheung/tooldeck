import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadComponent(path, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)(name =>
    Object.hasOwn(imports, name) ? imports[name] : require(name), compiled, compiled.exports);
  return compiled.exports;
}
const uiChinese = JSON.parse(fs.readFileSync('src/locales/ui.zh-CN.json', 'utf8'));
const i18n = loadComponent('src/i18n.ts', { './locales/ui.zh-CN.json': uiChinese });
const { FieldForm } = loadComponent('src/FieldForm.tsx', {
  './i18n': i18n, '@tauri-apps/plugin-dialog': {}, '@phosphor-icons/react': {}
});

test('field controls use the app language and preserve manifest strings', () => {
  for (const [locale, enabled] of [['en', 'Enabled'], ['zh-CN', uiChinese.Enabled]]) {
    const html = renderToStaticMarkup(React.createElement(i18n.LocaleContext.Provider, { value: locale },
      React.createElement(FieldForm, { fields: { flag: { schema: {type:'boolean'}, ui: {label:'Custom field'} } },
        values: {flag:true}, onChange() {} })));
    assert.ok(html.includes(enabled));
    assert.ok(html.includes('Custom field'));
  }
});

test('empty matches missing, null and empty strings after resolving defaults', () => {
  const fields = {
    name: { schema: { type: 'string' } },
    note: { schema: { type: 'string' }, availableWhen: { op: 'empty', key: 'name' } }
  };
  const visible = values => renderToStaticMarkup(React.createElement(FieldForm, { fields, values, onChange() {} })).includes('id="field-note"');
  assert.equal(visible({}), true);
  for (const name of [null, '']) assert.equal(visible({ name }), true);
  for (const name of [' ', 'text', 0, false]) assert.equal(visible({ name }), false);
  fields.name.schema.default = 'default';
  assert.equal(visible({}), false);
});

test('select displays labels, preserves enum indices and typed selection, and falls back to values', () => {
  const html = renderToStaticMarkup(React.createElement(FieldForm, {
    fields: { mode: { schema: { enum: ['render', 'extract', 1, '1'] }, ui: {
      options: [{ value: 'render', label: 'Render page' }, { value: 1, label: 'Number one' }]
    } } }, values: { mode: 1 }, onChange() {}
  }));
  assert.match(html, /value="0">Render page<\/option>/);
  assert.match(html, /value="1">extract<\/option>/);
  assert.match(html, /value="2" selected="">Number one<\/option>/);
  assert.match(html, /value="3">1<\/option>/);
});

test('nested conditions show required fields using current values and defaults', () => {
  const fields = {
    note: { required: true, schema: { type: 'string' }, availableWhen: { op: 'and', cond: [
      { op: 'eq', key: 'mode', value: 'advanced' },
      { op: 'or', cond: [{ op: 'gte', key: 'count', value: 2 }, { op: 'null', key: 'count' }] }
    ] } },
    mode: { schema: { type: 'string', default: 'advanced' } },
    count: { schema: { type: 'integer', default: 1 } }
  };
  const visible = values => renderToStaticMarkup(React.createElement(FieldForm, { fields, values, onChange() {} })).includes('id="field-note"');
  assert.equal(visible({}), false);
  assert.equal(visible({ count: 2 }), true);
  assert.equal(visible({ count: null }), true);
  assert.equal(visible({ count: '2' }), false);
  assert.equal(visible({ mode: 'basic', count: 2 }), false);
});

test('native diagnostics preserve argument order and literal argument text', () => {
  const catalog = JSON.parse(fs.readFileSync('src/locales/native.zh-CN.json', 'utf8'));
  const { nativeMessage } = loadComponent('src/nativeMessages.ts', { './locales/native.zh-CN.json': catalog });
  const english = 'Cannot import v1.0 over v2.0. Choose a higher version.';
  const template = catalog['Cannot import v{1} over v{0}. Choose a higher version.'];
  assert.equal(nativeMessage('en', english), english);
  assert.equal(nativeMessage('zh-CN', english), template.replace('{0}', '2.0').replace('{1}', '1.0'));
  assert.equal(nativeMessage('zh-CN', 'Entry Cancelled: details'),
    catalog['Entry {0}: {1}'].replace('{0}', 'Cancelled').replace('{1}', 'details'));
});
