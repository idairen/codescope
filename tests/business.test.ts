import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { scanRepository } from '../server/scanner';
import {
  businessEntries,
  businessContext,
  businessKey,
  generateBusinessFlow,
  validateBusinessFlow,
} from '../server/business';
import { BusinessDiagram, layoutBusiness } from '../src/BusinessFlow';
import type { Snapshot } from '../shared/types';

function fixture(s: Snapshot) {
  const entry = s.nodes.find((n) => n.name === 'POST /api/orders')!.id;
  const evidence = s.nodes.find((n) => n.name === 'createOrder')!.id;
  return {
    entry,
    value: {
      title: '创建订单',
      goal: '用户提交订单后得到已保存的订单，或获知失败原因。',
      trigger: '用户提交订单请求',
      steps: [
        {
          id: 'start',
          kind: 'entry',
          title: '提交订单',
          description: '接收订单信息。',
          input: '商品、数量、价格',
          output: '订单请求',
          evidence: [entry],
        },
        {
          id: 'check',
          kind: 'decision',
          title: '订单信息是否有效',
          description: '判断输入是否满足校验。',
          input: '订单请求',
          output: '校验结果',
          evidence: [evidence],
        },
        {
          id: 'save',
          kind: 'action',
          title: '预占库存并保存订单',
          description: '校验通过后计算金额、预占库存、保存。',
          input: '有效订单',
          output: '订单记录',
          evidence: [evidence],
        },
        {
          id: 'done',
          kind: 'outcome',
          title: '返回订单结果',
          description: '返回保存结果。',
          input: '订单记录',
          output: '订单编号',
          evidence: [evidence],
        },
        {
          id: 'fail',
          kind: 'outcome',
          title: '拒绝无效订单',
          description: '输入校验失败。',
          input: '无效订单',
          output: '错误',
          evidence: [evidence],
        },
      ],
      transitions: [
        { source: 'start', target: 'check', condition: '', data: '订单请求' },
        { source: 'check', target: 'save', condition: '有效', data: '有效订单' },
        { source: 'check', target: 'fail', condition: '无效', data: '错误原因' },
        { source: 'save', target: 'done', condition: '', data: '订单记录' },
      ],
      limitations: ['测试中的模型响应是模拟数据，不是语义准确性的验收结果。'],
      documentEvidence: ['README.md'],
    },
  };
}

test('business context follows one entry downstream, includes complete small-source evidence, keeps scenarios separate', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    { entry } = fixture(s);
  assert(businessEntries(s).some((e) => e.name === 'POST /api/payments'));
  const context = businessContext(s, entry);
  assert(context.nodes.some((n) => n.name === 'saveOrder'));
  assert(context.nodes.some((n) => n.name === 'checkStock'));
  assert(!context.nodes.some((n) => n.name === 'payOrder'));
  assert(context.excerpts.some((e) => e.code.includes('return saveOrder')));
  assert.equal(context.truncated, false);
});

test('business validator rejects missing outcomes, orphan steps, invented references, unlabeled decisions and closed cycles', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    { entry, value } = fixture(s),
    context = businessContext(s, entry);
  const validate = (v: unknown) => validateBusinessFlow(v, context, s, 'zh', 'mock');
  assert.equal(validate(value).steps.length, 5);
  const mutate = (fn: (v: typeof value) => void) => {
    const copy = structuredClone(value);
    fn(copy);
    assert.throws(() => validate(copy), /业务流程结构或证据无效/);
  };
  mutate((v) => {
    v.steps[3].kind = 'action';
    v.steps[4].kind = 'action';
  });
  mutate((v) => {
    v.steps.push({ ...v.steps[2], id: 'orphan' });
  });
  mutate((v) => {
    v.steps[2].evidence = ['invented'];
  });
  mutate((v) => {
    v.documentEvidence = ['unseen.md'];
  });
  mutate((v) => {
    v.transitions[1].condition = '';
  });
  mutate((v) => {
    v.steps[3].kind = 'action';
    v.transitions.push({ source: 'done', target: 'save', condition: '', data: 'loop' });
  });
  mutate((v) => {
    v.steps[0].evidence = [context.nodes.find((n) => n.name === 'saveOrder')!.id];
  });
});

test('unknown ending is explicit and diagram shows business labels, inputs and outputs instead of code identifiers', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    { entry, value } = fixture(s);
  value.steps[3].kind = 'unknown';
  value.steps[3].title = '后续状态待确认';
  const flow = validateBusinessFlow(value, businessContext(s, entry), s, 'zh', 'mock');
  const html = renderToStaticMarkup(
    createElement(BusinessDiagram, { flow, selected: 'check', onSelect: () => {} }),
  );
  assert(html.includes('订单信息是否有效'));
  assert(html.includes('后续状态待确认'));
  assert(html.includes('输入'));
  assert(html.includes('输出'));
  assert(!html.includes('createOrder'));
  const layout = layoutBusiness(flow);
  assert(layout.positions.start.y < layout.positions.check.y);
  assert(layout.positions.check.y < layout.positions.done.y);
});

test('business model request includes repository language and branch contract; cache separates snapshots and language (mock transport)', async () => {
  const s = await scanRepository(path.resolve('examples/order-service')),
    { entry, value } = fixture(s);
  const settings = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'mock', apiKey: '' };
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert(body.messages[0].content.includes('简体中文'));
    assert(body.messages[0].content.includes('CALLS edges alone DO NOT establish sequencing'));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    );
  };
  const flow = await generateBusinessFlow(s, entry, 'zh', settings, fake);
  assert.equal(flow.title, '创建订单');
  assert.equal(flow.entryId, entry);
  assert.notEqual(businessKey(s, entry, 'zh', settings), businessKey(s, entry, 'en', settings));
  assert.notEqual(
    businessKey(s, entry, 'zh', settings),
    businessKey({ ...s, fingerprint: 'new' }, entry, 'zh', settings),
  );
});
