// DOM contract checks only. These do not constitute browser or visual acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.events = {};
    this.clientWidth = 1000;
    this.clientHeight = 600;
    this.value = '';
    this.checked = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  append(el) {
    el.parent = this;
    this.children.push(el);
  }
  remove() {
    this.parent.children = this.parent.children.filter((el) => el !== this);
  }
  replaceChildren() {
    this.children = [];
  }
  querySelector(tag) {
    return this.children.find((el) => el.tag === tag);
  }
  addEventListener(name, fn) {
    this.events[name] = fn;
  }
  setPointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}
function setup(adapt = () => {}) {
  const graph = JSON.parse(
    fs.readFileSync(
      new URL('../../docs/business-flow/order-service.json', import.meta.url),
      'utf8',
    ),
  );
  graph.nodes.push({ ...graph.nodes[0], id: 'unrelated', label: '无关流程', core: true });
  graph.edges.push({
    id: 'guess',
    source: 'create',
    target: 'unrelated',
    label: '假设',
    reason: '测试推测',
    status: 'inferred',
    evidence: graph.nodes[0].evidence,
  });
  adapt(graph);
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Element());
    return ids.get(id);
  };
  get('graph-data').textContent = JSON.stringify(graph);
  get('depth').value = '1';
  get('direction').value = 'both';
  const document = {
    getElementById: get,
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
  };
  vm.runInNewContext(
    fs.readFileSync(
      new URL('../../skills/business-flow/assets/viewer.js', import.meta.url),
      'utf8',
    ),
    {
      document,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      matchMedia: () => ({ matches: false }),
      ResizeObserver: class {
        observe() {}
      },
      setTimeout: () => {},
    },
  );
  const nodes = () => get('nodes').children;
  const node = (id) => nodes().find((el) => el.attrs['data-node'] === id);
  const click = (id) => node(id).events.keydown({ key: 'Enter', preventDefault() {} });
  const edges = () => get('edges').children.map((el) => el.attrs['data-edge']);
  return { get, nodes, node, click, edges };
}

test('overview → focus reveals neighbors, dims unrelated nodes; refocus then collapse', () => {
  const a = setup();
  assert.equal(a.nodes().length, 4);
  a.click('create');
  assert(a.node('stock'));
  assert(a.node('validate'));
  assert.equal(a.node('create').attrs['aria-pressed'], 'true');
  assert.equal(a.node('unrelated').style.opacity, '.17');
  a.click('orders');
  assert.equal(a.node('orders').attrs['aria-pressed'], 'true');
  a.click('orders');
  assert.equal(a.nodes().length, 4);
});
test('direction and two-hop depth follow directed paths', () => {
  const a = setup();
  a.click('pay');
  a.get('direction').value = 'upstream';
  a.get('direction').onchange();
  assert(!a.node('payments'));
  assert(!a.node('paid'));
  a.get('depth').value = '2';
  a.get('depth').onchange();
  assert(a.node('paid'));
  a.get('direction').value = 'downstream';
  a.get('depth').value = '1';
  a.get('direction').onchange();
  assert(a.node('payments'));
  assert(a.node('paid'));
  assert(!a.edges().includes('guess'));
});
test('inferred relations require opt-in, reset clears filters and expansion', () => {
  const a = setup();
  a.click('create');
  assert(!a.edges().includes('guess'));
  a.get('inferred').checked = true;
  a.get('inferred').onchange();
  assert(a.edges().includes('guess'));
  a.get('reset').onclick();
  assert.equal(a.get('inferred').checked, false);
  assert.equal(a.nodes().length, 4);
});
test('search finds hidden nodes and evidence is rendered as text', () => {
  const a = setup();
  assert(!a.node('payments'));
  a.get('search').value = '支付记录';
  a.get('search').oninput();
  a.get('results')
    .children.find((el) => el.textContent === '支付记录')
    .onclick();
  assert.equal(a.node('payments').attrs['aria-pressed'], 'true');
  assert(a.get('details').children.some((el) => el.textContent === 'src/repository.ts:13–16'));
  a.get('search').value = 'no-such-label';
  a.get('search').oninput();
  assert.equal(a.get('results').children[0].textContent, '未找到匹配节点');
});
test('stationary pointer selects; dragging does not change focus; zoom and reset update viewport', () => {
  const a = setup(),
    event = { button: 0, clientX: 10, clientY: 10, pointerId: 1, stopPropagation() {} };
  a.node('create').events.pointerdown(event);
  a.get('graph').events.pointerup(event);
  assert.equal(a.node('create').attrs['aria-pressed'], 'true');
  a.node('orders').events.pointerdown(event);
  a.get('graph').events.pointermove({ ...event, clientX: 60 });
  a.get('graph').events.pointerup({ ...event, clientX: 60 });
  assert.equal(a.node('create').attrs['aria-pressed'], 'true');
  a.get('zoom-in').onclick();
  assert.match(a.get('viewport').attrs.transform, /scale\(1.2\)/);
  a.get('reset').onclick();
  assert.match(a.get('viewport').attrs.transform, /scale\(1\)/);
});

test('logic toggle opens concrete rules and removes summary bypass edges', () => {
  const a = setup();
  assert(!a.node('rule-sku'));
  a.get('logic').checked = true;
  a.get('logic').onchange();
  assert(a.node('rule-sku'));
  assert(a.node('rule-price'));
  assert(a.node('invalid-order'));
  assert(a.edges().includes('rule-sku-pass'));
  assert(a.edges().includes('rule-sku-fail'));
  assert(a.edges().includes('rule-stock-pass'));
  assert(a.edges().includes('rule-stock-fail'));
  assert(!a.edges().includes('save'));
  assert(a.get('edges').children.some((el) => el.textContent === '拒绝'));
  a.click('rule-price');
  assert(a.get('details').children.some((el) => el.textContent === '!(input.price < 0)'));
  a.get('logic').checked = false;
  a.get('logic').onchange();
  assert(!a.node('rule-price'));
  assert.equal(a.node('create').attrs['aria-pressed'], 'true');
  assert(a.edges().includes('save'));
});

test('detail search and direction filtering respect the selected view', () => {
  const a = setup();
  a.get('search').value = '严格匹配';
  a.get('search').oninput();
  assert.equal(a.get('results').children[0].textContent, '未找到匹配节点');
  a.get('logic').checked = true;
  a.get('logic').onchange();
  a.get('results')
    .children.find((el) => el.textContent === '支付金额严格匹配')
    .onclick();
  a.get('direction').value = 'downstream';
  a.get('direction').onchange();
  assert(a.node('payments'));
  assert(a.node('amount-mismatch'));
  assert(!a.node('rule-order-exists'));
  a.get('direction').value = 'upstream';
  a.get('direction').onchange();
  assert(a.node('rule-order-exists'));
  assert(!a.node('amount-mismatch'));
  a.get('reset').onclick();
  assert.equal(a.get('logic').checked, false);
  assert.equal(a.nodes().length, 4);
});

function coords(el) {
  return el.attrs.transform
    .match(/translate\(([^,]+),([^\)]+)\)/)
    .slice(1)
    .map(Number);
}
function assertNoNodeOverlap(a) {
  const boxes = a.nodes().map((el) => {
    const [x, y] = coords(el),
      name = el.querySelector('text').textContent;
    // Check the visible circle plus conservative label bounds, independent of placement method.
    const halfWidth = Math.max(
      28,
      [...name].reduce((w, c) => w + (c.codePointAt(0) > 255 ? 14 : 9), 0) / 2,
    );
    return { x, y, halfWidth, name };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      assert(
        Math.abs(a.x - b.x) >= a.halfWidth + b.halfWidth || Math.abs(a.y - b.y) >= 90,
        `${a.name} overlaps ${b.name}`,
      );
    }
}
test('expanded logic avoids node and label overlaps across repeated focus changes', () => {
  const a = setup();
  a.click('create');
  const before = coords(a.node('create'));
  a.get('logic').checked = true;
  a.get('logic').onchange();
  assert.deepEqual(coords(a.node('create')), before);
  assertNoNodeOverlap(a);
  for (const id of ['rule-sku', 'rule-price', 'pay', 'rule-amount', 'orders']) {
    a.click(id);
    assertNoNodeOverlap(a);
  }
  a.get('fit').onclick();
  assert.match(a.get('viewport').attrs.transform, /scale\(/);
});
test('dense long-label graph is not squeezed into the viewport', () => {
  const a = setup((graph) => {
    graph.nodes = Array.from({ length: 160 }, (_, i) => ({
      ...graph.nodes[0],
      id: `dense-${i}`,
      label: `很长的业务校验节点名称-${i}-validation`,
      core: true,
    }));
    graph.edges = [];
  });
  assert.equal(a.nodes().length, 160);
  assertNoNodeOverlap(a);
  a.get('fit').onclick();
  const transform = a.get('viewport').attrs.transform;
  assert(!transform.includes('NaN'));
  assert(!transform.includes('Infinity'));
});
test('drop over another node leaves the dragged node in place and separates the neighbor', () => {
  const a = setup();
  a.click('create');
  const [x, y] = coords(a.node('orders')),
    [tx, ty] = coords(a.node('create'));
  const scale = Number(a.get('viewport').attrs.transform.match(/scale\(([^)]+)\)/)[1]);
  const event = { button: 0, clientX: 0, clientY: 0, pointerId: 1, stopPropagation() {} };
  a.node('orders').events.pointerdown(event);
  const end = { ...event, clientX: (tx - x) * scale, clientY: (ty - y) * scale };
  a.get('graph').events.pointermove(end);
  a.get('graph').events.pointerup(end);
  assert.deepEqual(coords(a.node('orders')), [tx, ty]);
  assertNoNodeOverlap(a);
});
