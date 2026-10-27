import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/app';
import type { PublicSnapshot } from '../shared/types';
import { knowledgeFixture } from './knowledge-fixture';
test('API handlers with real scan worker and SQLite, without a listening socket', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codescope-api-'));
  let modelCalls = 0,
    modelFails = false;
  const modelFetch: typeof fetch = async (_url, init) => {
    modelCalls++;
    if (modelFails) return new Response('provider failure', { status: 503 });
    const context = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    if (context.repository)
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(knowledgeFixture(context.excerpts[0].id)) } },
          ],
        }),
      );
    const evidence = [context.entryId];
    const flow = {
      title: '测试业务',
      goal: '测试协议与持久化',
      trigger: '请求进入',
      steps: [
        {
          id: 'entry',
          kind: 'entry',
          title: '业务开始',
          description: '接收请求',
          input: '请求',
          output: '输入数据',
          evidence,
        },
        {
          id: 'end',
          kind: 'unknown',
          title: '业务结果待确认',
          description: '模拟模型未确定结果',
          input: '输入数据',
          output: '未知',
          evidence,
        },
      ],
      transitions: [{ source: 'entry', target: 'end', condition: '', data: '输入数据' }],
      limitations: ['模拟响应'],
      documentEvidence: [],
    };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(flow) } }] }),
    );
  };
  const app = createApplication({ base: path.resolve('.'), port: 4173, dataDir, modelFetch });
  async function request(url: string, body?: unknown, headers: Record<string, string> = {}) {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ) as IncomingMessage;
    req.url = url;
    req.method = body === undefined ? 'GET' : 'POST';
    req.headers = { host: '127.0.0.1:4173', ...headers };
    return await new Promise<{ status: number; data: any }>((resolve, reject) => {
      let status = 200;
      const res = {
        writeHead(s: number) {
          status = s;
          return this;
        },
        end(text: string) {
          resolve({ status, data: JSON.parse(text) });
        },
      } as unknown as ServerResponse;
      try {
        void app.handler(req, res);
      } catch (e) {
        reject(e);
      }
    });
  }
  try {
    assert.equal((await request('/api/health')).status, 200);
    assert.equal(
      (await request('/api/health', undefined, { origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal((await request('/api/health', undefined, { host: 'evil.example' })).status, 403);
    assert.equal((await request('/api/scan', { root: 'relative/path' })).status, 400);
    assert.equal(
      (
        await request('/api/settings', {
          baseUrl: 'https://example.com/v1',
          model: 'model',
          apiKey: 'secret-value',
        })
      ).status,
      200,
    );
    const config = await request('/api/settings');
    assert.equal(config.data.hasKey, true);
    assert(!JSON.stringify(config.data).includes('secret-value'));
    await request('/api/settings', { baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' });
    assert.equal((await request('/api/settings')).data.hasKey, false);
    const scan = await request('/api/scan', { root: path.resolve('examples/order-service') });
    assert.equal(scan.status, 202);
    let job = scan.data;
    const deadline = Date.now() + 15000;
    while (job.state === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30));
      job = (await request(`/api/jobs/${job.id}`)).data;
    }
    assert.equal(job.state, 'done', job.message);
    const repos = (await request('/api/repositories')).data as PublicSnapshot[];
    assert.equal(repos.length, 1);
    assert.equal(repos[0].language.code, 'zh');
    assert(!('text' in repos[0].files[0]));
    const business = await request(`/api/business?repo=${repos[0].id}&language=zh`);
    assert.equal(business.status, 200);
    assert(business.data.entries.some((e: { name: string }) => e.name === 'POST /api/orders'));
    assert.deepEqual(business.data.flows, []);
    assert.equal(
      (await request('/api/business', { repo: repos[0].id, entryId: 'missing', language: 'zh' }))
        .status,
      400,
    );
    const entryId = business.data.entries[0].id;
    const generated = await request('/api/business', {
      repo: repos[0].id,
      entryId,
      language: 'zh',
    });
    assert.equal(generated.status, 200);
    assert.equal(modelCalls, 1);
    assert.equal(
      (await request('/api/business', { repo: repos[0].id, entryId, language: 'zh' })).status,
      200,
    );
    assert.equal(modelCalls, 1, 'cached flow does not call model again');
    assert.equal(
      (await request(`/api/business?repo=${repos[0].id}&language=zh`)).data.flows.length,
      1,
    );
    assert.equal(
      (await request(`/api/business?repo=${repos[0].id}&language=en`)).data.flows.length,
      0,
    );
    modelFails = true;
    assert.equal(
      (
        await request('/api/business', {
          repo: repos[0].id,
          entryId,
          language: 'zh',
          refresh: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/api/business?repo=${repos[0].id}&language=zh`)).data.flows.length,
      1,
      'failed refresh preserves previous flow',
    );
    modelFails = false;
    const knowledgeUrl = `/api/knowledge?repo=${repos[0].id}&language=zh`;
    assert.equal((await request(knowledgeUrl)).data.graph, null);
    const before = modelCalls;
    const knowledge = await request('/api/knowledge', { repo: repos[0].id, language: 'zh' });
    assert.equal(knowledge.status, 200);
    assert.equal(knowledge.data.nodes.length, 3);
    assert.equal(
      (await request('/api/knowledge', { repo: repos[0].id, language: 'zh' })).status,
      200,
    );
    assert.equal(modelCalls, before + 1, 'cached knowledge does not call model again');
    assert.equal((await request(knowledgeUrl)).data.graph.nodes.length, 3);
    assert.equal(
      (await request(`/api/knowledge?repo=${repos[0].id}&language=en`)).data.graph,
      null,
    );
    modelFails = true;
    assert.equal(
      (await request('/api/knowledge', { repo: repos[0].id, language: 'zh', refresh: true }))
        .status,
      400,
    );
    assert.equal(
      (await request(knowledgeUrl)).data.graph.nodes.length,
      3,
      'failed refresh preserves knowledge',
    );
    const source = await request(`/api/source?repo=${repos[0].id}&file=src/orders.ts`);
    assert(source.data.text.includes('createOrder'));
    assert.equal((await request(`/api/source?repo=${repos[0].id}&file=../../.env`)).status, 404);
    assert.equal(
      (await request('/api/explain', { repo: repos[0].id, nodeId: 'missing', language: 'zh' }))
        .status,
      400,
    );
  } finally {
    app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
