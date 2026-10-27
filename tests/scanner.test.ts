import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from '../server/scanner';
import { detectLanguage } from '../server/language';
import { directedPath } from '../shared/types';
const example = path.resolve('examples/order-service');
test('real fixture resolves cross-file calls, route candidates, evidence and language', async () => {
  const s = await scanRepository(example);
  const start = s.nodes.find((n) => n.name === 'POST /api/orders')!,
    end = s.nodes.find((n) => n.name === 'checkStock')!;
  assert.deepEqual(
    directedPath(s.nodes, s.edges, start.id, end.id).map(
      (id) => s.nodes.find((n) => n.id === id)?.name,
    ),
    ['POST /api/orders', 'createOrder', 'reserveInventory', 'checkStock'],
  );
  assert.equal(s.language.code, 'zh');
  assert.deepEqual(s.language.evidence, ['README.md']);
  assert(
    s.edges.every(
      (e) => s.nodes.some((n) => n.id === e.source) && s.nodes.some((n) => n.id === e.target),
    ),
  );
  assert(
    s.edges.every((e) =>
      s.files.some((f) => f.path === e.file && f.text.split('\n')[e.line - 1].trim()),
    ),
  );
  assert.deepEqual(directedPath(s.nodes, s.edges, end.id, start.id), []);
});
test('incremental scan removes stale calls, handles deletion, additions and unchanged snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codescope-incremental-'));
  try {
    await fs.writeFile(
      path.join(root, 'a.ts'),
      "import { b as run } from './b'; export function a(){run();}",
    );
    await fs.writeFile(path.join(root, 'b.ts'), 'export function b(){return 1;}');
    const first = await scanRepository(root);
    assert.equal(first.edges.filter((e) => e.kind === 'calls').length, 1);
    const unchanged = await scanRepository(root, first);
    assert.equal(unchanged.changes.parsed, 0);
    assert.equal(unchanged.changes.reused, 2);
    await fs.writeFile(path.join(root, 'a.ts'), 'export function a(){return 2;}');
    const modified = await scanRepository(root, unchanged);
    assert.deepEqual(modified.changes.modified, ['a.ts']);
    assert.equal(modified.edges.length, 0);
    assert.equal(modified.changes.parsed, 1);
    assert.equal(modified.changes.reused, 1);
    await fs.unlink(path.join(root, 'b.ts'));
    await fs.writeFile(path.join(root, 'c.ts'), 'export const c = () => 3;');
    const changed = await scanRepository(root, modified);
    assert.deepEqual(changed.changes.deleted, ['b.ts']);
    assert.deepEqual(changed.changes.added, ['c.ts']);
    assert(!changed.nodes.some((n) => n.name === 'b'));
    assert(changed.nodes.some((n) => n.name === 'c'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('does not connect shadowed names or execute source, respects ignores and symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codescope-scope-'));
  try {
    await fs.writeFile(
      path.join(root, 'main.ts'),
      "throw new Error('MUST NOT RUN'); export function target(){} export function caller(target: () => void){ target(); }",
    );
    await fs.writeFile(path.join(root, 'ignored.ts'), 'export function hidden(){}');
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    await fs.symlink(path.join(root, 'main.ts'), path.join(root, 'linked.ts'));
    const s = await scanRepository(root);
    assert.deepEqual(
      s.files.map((f) => f.path),
      ['main.ts'],
    );
    assert.equal(s.edges.filter((e) => e.kind === 'calls').length, 0);
    assert(s.analysis.unresolvedCalls > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('language is driven by substantive documents, excludes fenced code, and reports uncertainty', () => {
  const doc = (p: string, t: string) => ({ path: p, text: t, hash: 'x' });
  assert.equal(detectLanguage([]).code, 'unknown');
  assert.equal(
    detectLanguage([
      doc(
        'README.md',
        '```ts\nconst value = "这是代码中的中文文本不应作为主要文档语言的依据";\n```',
      ),
    ]).code,
    'unknown',
  );
  assert.equal(
    detectLanguage([
      doc(
        'README.md',
        'This is the main guide for the project and its architecture. The service reads the request and writes the result to storage.',
      ),
      doc('README.zh.md', '这是项目的中文文档，这份翻译文档不应覆盖项目主文档的语言。'),
    ]).code,
    'en',
  );
  assert.equal(
    detectLanguage([
      doc(
        'README.md',
        'このプロジェクトはコードを分析します。データの流れを表示するためのドキュメントです。',
      ),
    ]).code,
    'ja',
  );
});
