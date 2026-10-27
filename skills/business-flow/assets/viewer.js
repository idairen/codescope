/* Independent SVG graph viewer. No network, libraries or model calls. */
(() => {
  'use strict';
  const graph = JSON.parse(document.getElementById('graph-data').textContent);
  const t = (key, values = {}) =>
    graph.ui[key].replace(/\{([a-zA-Z]+)\}/g, (match, name) => String(values[name] ?? match));
  const $ = (id) => document.getElementById(id);
  const ns = 'http://www.w3.org/2000/svg';
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const core = new Set(graph.nodes.filter((n) => n.core).map((n) => n.id));
  const impact = graph.impact;
  const impactNodes = new Map((impact?.nodes || []).map((item) => [item.id, item]));
  const impactEdges = new Map((impact?.edges || []).map((item) => [item.id, item]));
  const impactEnabled = () => Boolean(impact && $('impact-toggle').checked);
  function impactFor(id) {
    if (impactNodes.has(id)) return impactNodes.get(id);
    const children = (impact?.nodes || []).filter((item) => byId.get(item.id)?.parentId === id);
    if (!children.length) return null;
    return {
      id,
      level: 'indirect',
      reason: t('affectedChildren') + children.map((item) => byId.get(item.id).label).join(', '),
      evidence: children.flatMap((item) => item.evidence),
      via: [],
    };
  }
  let visible = new Set(core),
    focus = null,
    neighborhood = new Set(),
    activeEdges = new Set();
  let camera = { x: 0, y: 0, scale: 1 };
  const freshNodes = new Set();
  const positions = new Map(),
    nodeEls = new Map(),
    edgeEls = new Map(),
    edgeLabels = new Map();
  const svg = $('graph'),
    viewport = $('viewport');
  const detailed = () => $('logic').checked;
  const eligible = (n) => detailed() || n.layer !== 'detail';
  const color = (n) =>
    n.kind === 'rule'
      ? '#efaa72'
      : n.kind === 'process'
        ? '#b39af5'
        : ['data', 'store'].includes(n.kind)
          ? '#6bbac5'
          : '#d9b77a';
  function element(tag, attrs = {}) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }
  function text(parent, tag, value, className) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    parent.append(el);
    return el;
  }
  function evidence(parent, refs) {
    for (const r of refs) text(parent, 'p', `${r.path}:${r.startLine}–${r.endLine}`, 'source');
  }
  const available = () =>
    graph.edges.filter(
      (e) =>
        (e.status === 'supported' || $('inferred').checked) &&
        (e.view || 'both') !== (detailed() ? 'overview' : 'detail') &&
        eligible(byId.get(e.source)) &&
        eligible(byId.get(e.target)),
    );
  function walk(start) {
    const reached = new Set([start]),
      used = new Set();
    // Walk upstream/downstream separately: do not include siblings by changing direction midway.
    const modes =
      $('direction').value === 'both' ? ['upstream', 'downstream'] : [$('direction').value];
    for (const mode of modes) {
      let frontier = new Set([start]);
      const seen = new Set([start]);
      for (let depth = 0; depth < Number($('depth').value); depth++) {
        const next = new Set();
        for (const e of available()) {
          const from = mode === 'upstream' ? e.target : e.source;
          const to = mode === 'upstream' ? e.source : e.target;
          if (frontier.has(from)) {
            reached.add(to);
            used.add(e.id);
            if (!seen.has(to)) {
              seen.add(to);
              next.add(to);
            }
          }
        }
        frontier = next;
      }
    }
    return { reached, used };
  }
  function details() {
    const panel = $('details');
    panel.replaceChildren();
    if (impact) {
      text(panel, 'span', impact.mode === 'requirement' ? t('preview') : t('diff'), 'badge');
      text(panel, 'h3', t('request'));
      text(panel, 'p', impact.request);
      text(panel, 'p', impact.summary);
      if (impact.comparison)
        text(panel, 'p', `${impact.comparison.base} → ${impact.comparison.target}`, 'source');
      if (focus && impactFor(focus)) {
        const item = impactFor(focus);
        text(panel, 'h3', item.level === 'direct' ? t('directDetail') : t('indirectDetail'));
        text(panel, 'p', item.reason);
        evidence(panel, item.evidence);
        if (item.via.length) {
          text(panel, 'h3', t('path'));
          for (const id of item.via) {
            const edge = graph.edges.find((e) => e.id === id);
            text(
              panel,
              'p',
              `${byId.get(edge.source).label} → ${byId.get(edge.target).label}：${edge.label}`,
            );
          }
        }
      }
      for (const [field, label] of [
        ['checks', t('checks')],
        ['limitations', t('impactLimits')],
      ]) {
        text(panel, 'h3', label);
        for (const item of impact[field]) text(panel, 'p', item);
      }
      text(panel, 'p', t('impactWarning'));
    }
    if (!focus) {
      text(panel, 'span', t('overview'), 'badge');
      text(panel, 'h2', t('exploreTitle'));
      text(panel, 'p', t('exploreHelp'));
      text(panel, 'h3', t('scope'));
      text(panel, 'p', graph.scope);
      if (graph.language) {
        text(panel, 'h3', t('languageDecision'));
        text(panel, 'p', graph.language.reason);
        evidence(panel, graph.language.evidence);
      }
    } else {
      const n = byId.get(focus);
      text(panel, 'span', t('kind_' + n.kind), 'badge');
      text(panel, 'h2', n.label);
      text(panel, 'p', n.summary);
      if (n.rule) {
        text(panel, 'h3', t('condition'));
        text(panel, 'p', n.rule.condition, 'source');
        text(panel, 'h3', t('pass'));
        text(panel, 'p', n.rule.onPass);
        text(panel, 'h3', t('failDetail'));
        text(panel, 'p', n.rule.onFail);
      }
      const rules = graph.nodes.filter((item) => item.parentId === n.id && item.kind === 'rule');
      if (rules.length) {
        const button = text(panel, 'button', t('showRules', { count: rules.length }));
        button.onclick = () => {
          $('logic').checked = true;
          $('direction').value = 'both';
          visible = new Set(core);
          // Explicitly open the owned logic without inventing traversal edges.
          for (const item of graph.nodes.filter((item) => item.parentId === n.id))
            visible.add(item.id);
          refresh();
        };
      }
      for (const [field, label] of [
        ['inputs', t('inputs')],
        ['outputs', t('outputs')],
        ['states', t('states')],
      ]) {
        text(panel, 'h3', label);
        const ul = document.createElement('ul');
        panel.append(ul);
        for (const item of n[field].length ? n[field] : [t('unrecorded')]) text(ul, 'li', item);
      }
      text(panel, 'h3', t('evidence'));
      evidence(panel, n.evidence);
      text(panel, 'h3', t('relations'));
      for (const e of available().filter(
        (e) => activeEdges.has(e.id) && (e.source === focus || e.target === focus),
      )) {
        const box = document.createElement('div');
        box.className = 'relation';
        panel.append(box);
        text(box, 'p', `${byId.get(e.source).label} → ${byId.get(e.target).label}`);
        text(box, 'p', `${e.label} · ${e.status === 'inferred' ? t('inferred') : t('supported')}`);
        text(
          box,
          'p',
          `${e.flow === 'control' ? t('control') : t('data')}${e.branch ? (e.branch === 'pass' ? ' · ' + t('pass') : ' · ' + t('fail')) : ''}`,
        );
        text(box, 'p', e.reason);
        if (impactEdges.has(e.id)) {
          text(box, 'p', t('impactReason') + impactEdges.get(e.id).reason);
          evidence(box, impactEdges.get(e.id).evidence);
        }
        evidence(box, e.evidence);
        const target = e.source === focus ? e.target : e.source;
        const button = text(box, 'button', t('explore', { label: byId.get(target).label }));
        button.onclick = () => select(target);
      }
    }
    for (const [field, label] of [
      ['limitations', t('limitations')],
      ['questions', t('questions')],
    ]) {
      text(panel, 'h3', label);
      const ul = document.createElement('ul');
      panel.append(ul);
      for (const item of graph[field].length ? graph[field] : [t('noItems')]) text(ul, 'li', item);
    }
  }
  function select(id) {
    if (focus === id) {
      collapse();
      return;
    }
    focus = id;
    refresh();
  }
  function collapse() {
    focus = null;
    visible = new Set(core);
    refresh();
  }
  function refresh() {
    visible = new Set([...visible].filter((id) => eligible(byId.get(id))));
    const result = focus ? walk(focus) : { reached: new Set(), used: new Set() };
    neighborhood = result.reached;
    activeEdges = result.used;
    if (
      detailed() &&
      focus &&
      byId.get(focus).layer !== 'detail' &&
      $('direction').value === 'both'
    ) {
      const owned = new Set(graph.nodes.filter((n) => n.parentId === focus).map((n) => n.id));
      for (const id of owned) neighborhood.add(id);
      // Keep the inputs and branch destinations visible at the boundary of this process.
      for (const e of available())
        if (owned.has(e.source) || owned.has(e.target)) {
          neighborhood.add(e.source);
          neighborhood.add(e.target);
        }
      for (const e of available())
        if (neighborhood.has(e.source) && neighborhood.has(e.target)) activeEdges.add(e.id);
    }
    for (const id of neighborhood) visible.add(id);
    if (impactEnabled())
      for (const n of graph.nodes) if (eligible(n) && impactFor(n.id)) visible.add(n.id);
    const w = svg.clientWidth,
      h = svg.clientHeight;
    let index = 0;
    freshNodes.clear();
    for (const id of visible) {
      if (!positions.has(id)) {
        freshNodes.add(id);
        const angle = index * 2.39996;
        const origin = positions.get(focus) || { x: w / 2, y: h / 2 };
        positions.set(id, {
          x: origin.x + Math.cos(angle) * 145,
          y: origin.y + Math.sin(angle) * 125,
          vx: 0,
          vy: 0,
        });
      }
      index++;
    }
    for (const [id, el] of nodeEls)
      if (!visible.has(id)) {
        el.remove();
        nodeEls.delete(id);
      }
    for (const id of visible) {
      const n = byId.get(id);
      let el = nodeEls.get(id);
      if (!el) {
        el = element('g', {
          class: 'node',
          'data-node': id,
          role: 'button',
          tabindex: '0',
          'aria-label': n.label,
        });
        el.append(element('circle', { r: 20, fill: '#202738', stroke: color(n) }));
        const label = element('text', { y: 42, 'text-anchor': 'middle' });
        label.textContent = n.label;
        el.append(label);
        el.addEventListener('click', () => {
          if (!suppressClick) select(id);
        });
        el.addEventListener('keydown', (e) => {
          if (['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            select(id);
          }
        });
        el.addEventListener('pointerdown', (e) => beginDrag(e, id));
        $('nodes').append(el);
        nodeEls.set(id, el);
      }
      const affected = impactEnabled() && impactFor(id);
      el.style.opacity = affected || !focus || neighborhood.has(id) ? '1' : '.17';
      el.setAttribute('data-impact', affected ? affected.level : 'none');
      el.setAttribute(
        'aria-label',
        n.label +
          (affected
            ? affected.level === 'direct'
              ? ' · ' + t('direct')
              : ' · ' + t('indirect')
            : ''),
      );
      el.setAttribute('aria-pressed', String(focus === id));
      el.setAttribute('data-kind', n.kind);
      el.querySelector('circle').setAttribute('r', focus === id ? 27 : 20);
      el.querySelector('circle').setAttribute('fill', focus === id ? '#66518a' : '#202738');
      el.querySelector('circle').setAttribute('stroke', affected ? '#ff526f' : color(n));
      el.querySelector('circle').setAttribute('stroke-width', affected ? '4' : '1.5');
      el.querySelector('circle').setAttribute(
        'stroke-dasharray',
        affected?.level === 'indirect' ? '5 3' : 'none',
      );
      if (affected) el.querySelector('circle').setAttribute('fill', '#502333');
    }
    $('edges').replaceChildren();
    edgeEls.clear();
    edgeLabels.clear();
    for (const e of available().filter((e) => visible.has(e.source) && visible.has(e.target))) {
      const el = element('path', {
        class: `edge ${activeEdges.has(e.id) ? 'active' : ''} ${e.status} ${e.flow || 'data'} ${e.branch || ''}`,
        'data-edge': e.id,
        'marker-end': 'url(#arrow)',
      });
      el.style.opacity = !focus || activeEdges.has(e.id) ? '.85' : '.09';
      if (impactEnabled() && impactEdges.has(e.id)) {
        el.setAttribute('class', `edge impacted ${e.status} ${e.flow || 'data'} ${e.branch || ''}`);
        el.style.opacity = '1';
        el.setAttribute('marker-end', 'url(#impact-arrow)');
      }
      const title = element('title');
      title.textContent = `${e.label}: ${e.reason}`;
      el.append(title);
      $('edges').append(el);
      edgeEls.set(e.id, el);
      if (e.branch) {
        const label = element('text', {
          class: `branch-label ${e.branch}`,
          'text-anchor': 'middle',
        });
        label.textContent = e.branch === 'pass' ? t('pass') : t('fail');
        label.style.opacity = el.style.opacity;
        $('edges').append(label);
        edgeLabels.set(e.id, label);
      }
    }
    $('status').textContent = t('status', {
      visible: visible.size,
      total: graph.nodes.filter(eligible).length,
      mode: detailed() ? t('logic') : t('overview'),
      focus: focus ? t('focus', { label: byId.get(focus).label }) : t('choose'),
    });
    if (detailed() && !graph.nodes.some((n) => n.kind === 'rule'))
      $('status').textContent += ' · ' + t('noRules');
    if (impactEnabled())
      $('status').textContent += ' · ' + t('impactCount', { count: impact.nodes.length });
    details();
    settleLayout();
    if (focus) fitView(neighborhood, false);
  }
  function draw() {
    for (const [id, el] of nodeEls) {
      const p = positions.get(id);
      el.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
    for (const e of graph.edges) {
      const el = edgeEls.get(e.id);
      if (!el) continue;
      const a = positions.get(e.source),
        b = positions.get(e.target);
      const label = edgeLabels.get(e.id);
      if (label) {
        label.setAttribute('x', (a.x + b.x) / 2);
        label.setAttribute('y', (a.y + b.y) / 2 - 6);
      }
      if (e.source === e.target) {
        el.setAttribute(
          'd',
          `M ${a.x - 14} ${a.y - 16} C ${a.x - 65} ${a.y - 85},${a.x + 65} ${a.y - 85},${a.x + 15} ${a.y - 18}`,
        );
        continue;
      }
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dist = Math.hypot(dx, dy) || 1;
      const offset = graph.edges.filter(
        (other) => other.source === e.target && other.target === e.source,
      ).length
        ? 26
        : 0;
      const start = focus === e.source ? 30 : 23,
        end = focus === e.target ? 33 : 26;
      el.setAttribute(
        'd',
        `M ${a.x + (dx / dist) * start} ${a.y + (dy / dist) * start} Q ${(a.x + b.x) / 2 - (dy / dist) * offset} ${(a.y + b.y) / 2 + (dx / dist) * offset} ${b.x - (dx / dist) * end} ${b.y - (dy / dist) * end}`,
      );
    }
  }
  // Include the circle, its label and a breathing margin in the reserved rectangle.
  function nodeSize(id) {
    const label = nodeEls.get(id)?.querySelector('text');
    const measured = label?.getComputedTextLength?.();
    const estimate = [...byId.get(id).label].reduce(
      (n, c) => n + (c.codePointAt(0) > 255 ? 14 : 9),
      0,
    );
    return { halfWidth: Math.max(44, (measured || estimate) / 2 + 18), halfHeight: 60 };
  }
  function overlaps(a, b) {
    return (
      Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
      Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight
    );
  }
  function distances(start, reverse) {
    const result = new Map([[start, 0]]),
      queue = [start];
    const edges = available().filter((e) => visible.has(e.source) && visible.has(e.target));
    for (let i = 0; i < queue.length; i++) {
      for (const e of edges) {
        const from = reverse ? e.target : e.source,
          to = reverse ? e.source : e.target;
        if (from === queue[i] && !result.has(to)) {
          result.set(to, result.get(from) + 1);
          queue.push(to);
        }
      }
    }
    return result;
  }
  function settleLayout(pinned = focus) {
    const anchor = positions.get(focus) || { x: svg.clientWidth / 2, y: svg.clientHeight / 2 };
    const up = focus ? distances(focus, true) : new Map(),
      down = focus ? distances(focus, false) : new Map();
    const lanes = new Map();
    // Existing nodes keep their positions unless there is a real collision. Fresh nodes
    // start in upstream/ downstream columns, not on top of the selected node.
    for (const id of freshNodes) {
      if (!visible.has(id) || id === focus) continue;
      const u = up.get(id),
        d = down.get(id);
      const rank = u !== undefined && (d === undefined || u < d) ? -u : (d ?? 0);
      const lane = lanes.get(rank) || 0;
      lanes.set(rank, lane + 1);
      const row = lane === 0 ? 0 : Math.ceil(lane / 2) * (lane % 2 ? 1 : -1);
      const p = positions.get(id);
      p.x = anchor.x + rank * 280;
      p.y = anchor.y + row * 140;
    }
    const ordered = [...visible].sort(
      (a, b) =>
        Number(b === pinned) - Number(a === pinned) ||
        Number(freshNodes.has(a)) - Number(freshNodes.has(b)),
    );
    const placed = [];
    for (const id of ordered) {
      const p = positions.get(id),
        size = nodeSize(id);
      let box = { ...size, x: p.x, y: p.y };
      if (placed.some((other) => overlaps(box, other))) {
        // Candidate boundaries guarantee a free position without squeezing into a viewport.
        // Search near the desired position, preferring vertical movement to retain flow columns.
        const candidates = [];
        for (const other of placed) {
          candidates.push(
            { x: p.x, y: other.y - other.halfHeight - size.halfHeight - 2 },
            { x: p.x, y: other.y + other.halfHeight + size.halfHeight + 2 },
            { x: other.x - other.halfWidth - size.halfWidth - 2, y: p.y },
            { x: other.x + other.halfWidth + size.halfWidth + 2, y: p.y },
          );
        }
        candidates.sort(
          (a, b) =>
            1.4 * (a.x - p.x) ** 2 + (a.y - p.y) ** 2 - (1.4 * (b.x - p.x) ** 2 + (b.y - p.y) ** 2),
        );
        const free = candidates.find(
          (c) => !placed.some((other) => overlaps({ ...c, ...size }, other)),
        );
        // The outermost vertical candidate is always clear for a finite set of boxes.
        box = {
          ...size,
          ...(free || {
            x: p.x,
            y: Math.max(...placed.map((n) => n.y + n.halfHeight)) + size.halfHeight + 2,
          }),
        };
      }
      p.x = box.x;
      p.y = box.y;
      placed.push(box);
    }
    freshNodes.clear();
    draw();
  }
  function fitView(ids = visible, all = true) {
    const boxes = [...ids]
      .filter((id) => visible.has(id))
      .map((id) => ({ ...positions.get(id), ...nodeSize(id) }));
    if (!boxes.length) return;
    const left = Math.min(...boxes.map((p) => p.x - p.halfWidth)),
      right = Math.max(...boxes.map((p) => p.x + p.halfWidth));
    const top = Math.min(...boxes.map((p) => p.y - p.halfHeight)),
      bottom = Math.max(...boxes.map((p) => p.y + p.halfHeight));
    const width = Math.max(1, svg.clientWidth - 80),
      height = Math.max(1, svg.clientHeight - 100);
    const ideal = Math.min(1, width / (right - left), height / (bottom - top));
    const scale = Math.max(all ? 0.001 : 0.65, ideal);
    const center =
      !all && ideal < 0.65 && focus
        ? positions.get(focus)
        : { x: (left + right) / 2, y: (top + bottom) / 2 };
    camera = {
      scale,
      x: svg.clientWidth / 2 - center.x * scale,
      y: svg.clientHeight / 2 - center.y * scale,
    };
    transform();
  }
  function transform() {
    viewport.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.scale})`);
  }
  function zoom(factor, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
    const scale = Math.max(0.001, Math.min(3, camera.scale * factor)),
      ratio = scale / camera.scale;
    camera.x = x - (x - camera.x) * ratio;
    camera.y = y - (y - camera.y) * ratio;
    camera.scale = scale;
    transform();
  }
  let drag = null,
    suppressClick = false;
  function beginDrag(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    suppressClick = false;
    drag = { id, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    svg.setPointerCapture(e.pointerId);
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.target === svg) beginDrag(e, null);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.lastX,
      dy = e.clientY - drag.lastY;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved) {
      if (drag.id) {
        const p = positions.get(drag.id);
        p.x += dx / camera.scale;
        p.y += dy / camera.scale;
        draw();
      } else {
        camera.x += dx;
        camera.y += dy;
        transform();
      }
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    suppressClick = d.moved;
    // Pointer capture retargets click to SVG, so handle a stationary node press here.
    if (!d.moved && d.id) {
      select(d.id);
      suppressClick = true;
    }
    if (d.moved && d.id) settleLayout(d.id);
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', () => {
    drag = null;
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.001), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  $('fit').onclick = () => fitView();
  $('impact-toggle').disabled = !impact;
  $('impact-toggle').checked = Boolean(impact);
  $('impact-toggle').onchange = () => {
    visible = new Set(core);
    refresh();
  };
  $('impact-focus').disabled = !impact || !impact.nodes.length;
  $('impact-focus').onclick = () => {
    $('impact-toggle').checked = true;
    $('logic').checked = true;
    $('direction').value = 'both';
    focus = null;
    visible = new Set(core);
    refresh();
    fitView(new Set(impact.nodes.map((item) => item.id)), false);
  };
  $('zoom-in').onclick = () => zoom(1.2);
  $('zoom-out').onclick = () => zoom(1 / 1.2);
  for (const id of ['depth', 'direction', 'inferred'])
    $(id).onchange = () => {
      visible = new Set(core);
      refresh();
    };
  $('collapse').onclick = collapse;
  $('logic').onchange = () => {
    if (detailed() && !focus)
      focus = graph.nodes.find((n) => n.core && n.kind === 'process')?.id || null;
    if (focus && !eligible(byId.get(focus))) focus = byId.get(focus).parentId;
    visible = new Set(core);
    if (detailed() && focus) {
      const owner = byId.get(focus).parentId || focus;
      for (const n of graph.nodes.filter((n) => n.parentId === owner)) visible.add(n.id);
    }
    refresh();
    $('search').oninput();
  };
  $('reset').onclick = () => {
    camera = { x: 0, y: 0, scale: 1 };
    transform();
    $('depth').value = '1';
    $('direction').value = 'both';
    $('inferred').checked = false;
    $('logic').checked = false;
    $('search').value = '';
    $('results').replaceChildren();
    collapse();
  };
  $('search').oninput = () => {
    const q = $('search').value.trim().toLowerCase();
    $('results').replaceChildren();
    if (!q) return;
    const matches = graph.nodes.filter(
      (n) =>
        eligible(n) &&
        (n.label + ' ' + n.summary + ' ' + (n.rule?.condition || '')).toLowerCase().includes(q),
    );
    for (const n of matches.slice(0, 12)) {
      const b = text($('results'), 'button', n.label);
      b.onclick = () => {
        focus = null;
        select(n.id);
        fitView(neighborhood, false);
      };
    }
    if (!matches.length) text($('results'), 'span', t('noMatch'));
  };
  document.title = graph.title;
  $('title').textContent = graph.title;
  $('scope').textContent = graph.scope;
  new ResizeObserver(() => {
    settleLayout();
    if (focus) fitView(neighborhood, false);
  }).observe(svg);
  refresh();
})();
