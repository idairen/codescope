import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanRepository } from '../server/scanner';
import {
  knowledgeContext,
  knowledgeKey,
  validateKnowledge,
  generateKnowledge,
} from '../server/knowledge';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectKnowledge, PendingRelations } from '../src/KnowledgeGraph';
import { knowledgeFixture } from './knowledge-fixture';

test('repository knowledge context covers multiple entries and reports truncated evidence', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  const context = knowledgeContext(s);
  assert(context.excerpts.some((e) => e.name === 'createOrder'));
  assert(context.excerpts.some((e) => e.name === 'payOrder'));
  assert(context.documents.some((d) => d.id === 'doc:README.md'));
  assert.equal(context.coverage.truncated, false);
  const large = structuredClone(s);
  large.documents[0].text = '文'.repeat(7000);
  assert.equal(knowledgeContext(large).coverage.truncated, true);
  const settings = { baseUrl: 'http://localhost:11434/v1', model: 'mock', apiKey: '' };
  assert.notEqual(knowledgeKey(s, 'zh', settings), knowledgeKey(s, 'en', settings));
  assert.notEqual(
    knowledgeKey(s, 'zh', settings),
    knowledgeKey({ ...s, fingerprint: 'changed' }, 'zh', settings),
  );
});

test('business knowledge validates evidence, data direction and domain membership', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    context = knowledgeContext(s),
    value = knowledgeFixture(context.excerpts[0].id);
  const validate = (v: unknown) => validateKnowledge(v, context, s, 'zh', 'mock');
  assert.equal(validate(value).nodes.length, 3);
  const reject = (change: (v: typeof value) => void) => {
    const copy = structuredClone(value);
    change(copy);
    assert.throws(() => validate(copy), /业务知识图谱/);
  };
  reject((v) => {
    v.nodes[0].evidence = ['imagined'];
  });
  reject((v) => {
    v.nodes[0].domain = 'missing';
  });
  reject((v) => {
    v.nodes[0].kind = 'function';
  });
  reject((v) => {
    v.nodes.push({ ...v.nodes[0], id: 'orphan' });
  });
  reject((v) => {
    v.edges[0].target = 'missing';
  });
  reject((v) => {
    v.edges[0].data = '';
  });
  reject((v) => {
    v.edges.push({ ...v.edges[0], id: 'duplicate' });
  });
});

test('domain overview preserves directions and expanded domain deduplicates shared data', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    context = knowledgeContext(s);
  const graph = validateKnowledge(
    knowledgeFixture(context.excerpts[0].id),
    context,
    s,
    'zh',
    'mock',
  );
  const overview = projectKnowledge(graph, '');
  assert.equal(overview.nodes.length, 2);
  assert.deepEqual(
    overview.edges.map((e) => [e.source, e.target]),
    [
      ['orders', 'payments'],
      ['payments', 'orders'],
    ],
  );
  assert(!overview.edges.some((e) => e.source === e.target));
  const expanded = projectKnowledge(graph, 'payments');
  assert.deepEqual(
    expanded.nodes.map((n) => n.id),
    ['order', 'pay'],
  );
  assert.equal(expanded.nodes.find((n) => n.id === 'order')?.boundary, true);
  assert.equal(expanded.edges.length, 2);
  const isolated = {
    ...graph,
    domains: [...graph.domains, { id: 'unrelated', title: '独立业务', description: '无关联证据' }],
  };
  assert.equal(
    projectKnowledge(isolated, '').edges.length,
    2,
    'does not invent cross-domain edges',
  );
});

test('knowledge model receives repository evidence and requested document language', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert(body.messages[0].content.includes('简体中文'));
    assert(body.messages[0].content.includes('not a function call graph'));
    const context = JSON.parse(body.messages[1].content);
    assert(context.excerpts.some((e: { name: string }) => e.name === 'payOrder'));
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(knowledgeFixture(context.excerpts[0].id)) } },
        ],
      }),
    );
  };
  const graph = await generateKnowledge(
    s,
    'zh',
    { baseUrl: 'http://localhost:11434/v1', model: 'mock', apiKey: '' },
    fetcher,
  );
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.language, 'zh');
});

test('local Ollama request uses JSON schema and distinguishes transport, HTTP and generation failures', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  const settings = {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen-test',
    apiKey: 'secret-not-for-errors',
  };
  const run = (fetcher: typeof fetch) => generateKnowledge(s, 'zh', settings, fetcher);
  await run(async (url, init) => {
    assert.equal(url, 'http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_schema');
    const context = JSON.parse(body.messages[1].content);
    assert.deepEqual(
      body.response_format.json_schema.schema.properties.nodes.items.properties.evidence.items.enum,
      [
        ...context.excerpts.map((e: { id: string }) => e.id),
        ...context.documents.map((d: { id: string }) => d.id),
      ],
    );
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(knowledgeFixture(context.excerpts[0].id)) } },
        ],
      }),
    );
  });
  await assert.rejects(
    run(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }),
    /超时（10 分钟）/,
  );
  await assert.rejects(
    run(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }),
    /ECONNREFUSED/,
  );
  await assert.rejects(
    run(
      async () => new Response(JSON.stringify({ error: 'model test not found' }), { status: 404 }),
    ),
    /模型不存在/,
  );
  await assert.rejects(
    run(
      async () => new Response(JSON.stringify({ error: 'secret-not-for-errors' }), { status: 500 }),
    ),
    (e) =>
      e instanceof Error &&
      !e.message.includes('secret-not-for-errors') &&
      e.message.includes('HTTP 500'),
  );
  await assert.rejects(
    run(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }),
        ),
    ),
    /输出被截断/,
  );
  await assert.rejects(
    run(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { reasoning: 'thinking', content: '' } }] }),
        ),
    ),
    /没有返回图谱正文/,
  );
  await assert.rejects(
    run(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] })),
    ),
    /正文不是有效/,
  );
  await assert.rejects(
    run(async () => {
      const r = new Response('');
      Object.defineProperty(r, 'text', {
        value: async () => {
          throw new Error('socket closed');
        },
      });
      return r;
    }),
    /读取响应/,
  );
});

test('local evidence budget includes serialized metadata and exposes incomplete coverage', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  for (const f of s.files) f.text = '中文业务字段 '.repeat(30000);
  for (const n of s.nodes) {
    n.line = 1;
    n.endLine = 1;
  }
  s.documents.push({ path: 'business.md', text: '业务文档'.repeat(20000), hash: 'large' });
  const compact = knowledgeContext(s, true);
  assert(JSON.stringify(compact).length <= 18000);
  assert(compact.coverage.truncated);
  assert.equal(compact.coverage.includedCode, compact.excerpts.length);
  assert(compact.excerpts.some((e) => e.name === 'createOrder'));
  assert(compact.excerpts.some((e) => e.name === 'payOrder'));
});

test('read/write subject-object directions normalize without mutating evidence or ambiguous relations', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  const context = knowledgeContext(s);
  for (const kind of ['data', 'store']) {
    const value = knowledgeFixture(context.excerpts[0].id);
    value.nodes[1].kind = kind;
    // "process reads data" and "data is written by process" are both reversed
    // relative to data travel. Keep each relation's semantic kind and provenance.
    [value.edges[1].source, value.edges[1].target] = [value.edges[1].target, value.edges[1].source];
    [value.edges[0].source, value.edges[0].target] = [value.edges[0].target, value.edges[0].source];
    const before = structuredClone(value);
    const graph = validateKnowledge(value, context, s, 'zh', 'mock');
    assert.deepEqual(value, before, 'provider payload is unchanged');
    assert.equal(graph.edges[1].source, 'order');
    assert.equal(graph.edges[1].target, 'pay');
    assert.equal(graph.edges[0].source, 'create');
    assert.equal(graph.edges[0].target, 'order');
    for (const index of [0, 1]) {
      assert.equal(graph.edges[index].directionNormalized, true);
      assert.deepEqual(graph.edges[index].evidence, before.edges[index].evidence);
      assert.equal(graph.edges[index].description, before.edges[index].description);
      assert.equal(graph.edges[index].data, before.edges[index].data);
    }
    assert.equal(graph.edges[2].directionNormalized, undefined);
    const overview = projectKnowledge(graph, '');
    assert(overview.edges.some((e) => e.source === 'orders' && e.target === 'payments'));
    const duplicate = structuredClone(value);
    duplicate.edges.push({ ...value.edges[1], id: 'duplicate', source: 'order', target: 'pay' });
    assert.throws(
      () => validateKnowledge(duplicate, context, s, 'zh', 'mock'),
      /统一数据流方向后重复/,
    );
    const ambiguous = structuredClone(value);
    ambiguous.edges[1].source = 'create';
    ambiguous.edges[1].target = 'pay';
    const partial = validateKnowledge(ambiguous, context, s, 'zh', 'mock');
    assert.equal(partial.pendingRelations?.[0].id, 'read');
    assert(!partial.edges.some((e) => e.id === 'read'));
    const invented = structuredClone(value);
    invented.edges[1].evidence = ['invented'];
    assert.throws(() => validateKnowledge(invented, context, s, 'zh', 'mock'), /证据引用无效/);
  }
});

test('data-to-data reads are retained for review without discarding valid business flows', async () => {
  const s = await scanRepository(path.resolve('examples/order-service'));
  const context = knowledgeContext(s),
    value = knowledgeFixture(context.excerpts[0].id);
  value.nodes.push({ ...value.nodes[1], id: 'invoice', domain: 'payments', title: '发票' });
  value.edges.push({ ...value.edges[1], id: 'bad-read', source: 'order', target: 'invoice' });
  const before = structuredClone(value);
  const graph = validateKnowledge(value, context, s, 'zh', 'mock');
  assert.deepEqual(value, before);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.nodes.length, 4, 'pending-only entity remains visible');
  assert.deepEqual(graph.pendingRelations, [
    { ...value.edges[3], reason: 'incompatible_endpoints' },
  ]);
  assert(!projectKnowledge(graph, 'orders').edges.some((e) => e.id === 'bad-read'));
  assert.equal(
    projectKnowledge(graph, '').edges.length,
    2,
    'pending relation does not affect overview',
  );
  const html = renderToStaticMarkup(
    createElement(PendingRelations, { graph, onEvidence: () => {} }),
  );
  assert(html.includes('部分关系待确认'));
  assert(html.includes('订单 → 发票'));
  assert(html.includes('核对引用依据'));
  const invalid = structuredClone(value);
  invalid.edges[3].evidence = ['invented'];
  assert.throws(() => validateKnowledge(invalid, context, s, 'zh', 'mock'), /证据引用无效/);
  const duplicate = structuredClone(value);
  duplicate.edges.push({ ...value.edges[3] });
  assert.throws(() => validateKnowledge(duplicate, context, s, 'zh', 'mock'), /关系重复/);
  const allPending = structuredClone(value);
  allPending.edges = [value.edges[3]];
  assert.throws(() => validateKnowledge(allPending, context, s, 'zh', 'mock'), /所有关系均待确认/);
});
