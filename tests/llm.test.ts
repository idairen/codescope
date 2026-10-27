import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanRepository } from '../server/scanner';
import { explain, validateExplanation, validateSettings, explanationKey } from '../server/llm';
const settings = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'test-model',
  apiKey: 'test-secret',
};
test('provider sends bounded evidence and language, validates structured response (mock transport)', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    node = s.nodes.find((n) => n.name === 'createOrder')!;
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(input, 'http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert(body.messages[0].content.includes('简体中文'));
    const context = JSON.parse(body.messages[1].content);
    assert(context.repositoryContext.nodes.length <= 18);
    assert(context.repositoryContext.excerpts.some((e: { id: string }) => e.id === node.id));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '创建订单',
                nodes: [
                  {
                    id: node.id,
                    label: '创建订单',
                    description: '校验并保存订单。',
                    evidence: [node.id],
                  },
                ],
                caveats: ['静态调用不代表实际执行顺序。'],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const result = await explain(s, node.id, 'zh', settings, fakeFetch);
  assert.equal(result.language, 'zh');
  assert.equal(result.nodes[0].label, '创建订单');
  assert.notEqual(
    explanationKey(s, node.id, 'zh', settings),
    explanationKey(s, node.id, 'en', settings),
  );
  await assert.rejects(
    explain(
      s,
      node.id,
      'zh',
      settings,
      async () => new Response('private error body', { status: 401 }),
    ),
    /HTTP 401/,
  );
});
test('rejects invented evidence, untrusted endpoints and missing model', () => {
  assert.throws(
    () =>
      validateExplanation(
        {
          summary: 'x',
          nodes: [{ id: 'fake', label: 'x', description: 'x', evidence: ['fake'] }],
          caveats: [],
        },
        new Set(['real']),
        'zh',
        'm',
      ),
    /不存在/,
  );
  assert.throws(() => validateSettings({ ...settings, baseUrl: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(
    () => validateSettings({ ...settings, baseUrl: 'https://secret:password@example.com/v1' }),
    /账号/,
  );
  assert.throws(() => validateSettings({ ...settings, model: '' }), /模型名称/);
});

test('standard local Ollama URLs normalize without changing custom provider paths', () => {
  const config = { baseUrl: 'http://127.0.0.1:11434', model: 'local', apiKey: '' };
  for (const suffix of ['', '/', '/api', '/api/chat', '/v1/chat/completions', '/v1/'])
    assert.equal(
      validateSettings({ ...config, baseUrl: config.baseUrl + suffix }).baseUrl,
      'http://127.0.0.1:11434/v1',
    );
  assert.equal(
    validateSettings({ ...config, baseUrl: 'http://127.0.0.1:1234/v1' }).baseUrl,
    'http://127.0.0.1:1234/v1',
  );
  assert.equal(
    validateSettings({ ...config, baseUrl: 'https://example.com/custom/v1' }).baseUrl,
    'https://example.com/custom/v1',
  );
});
