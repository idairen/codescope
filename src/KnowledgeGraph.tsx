import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Sparkles,
  Settings2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ArrowLeft,
} from 'lucide-react';
import type {
  BusinessKnowledge,
  BusinessEntityKind,
  Language,
  PublicSnapshot,
} from '../shared/types';

const kinds: Record<BusinessEntityKind, string> = {
  actor: '参与者 / 触发',
  process: '业务处理',
  data: '数据对象',
  store: '数据存储',
  outcome: '业务结果',
};
export function projectKnowledge(graph: BusinessKnowledge, domain: string) {
  if (!domain) {
    const owners = new Map(graph.nodes.map((n) => [n.id, n.domain]));
    const grouped = new Map<
      string,
      { id: string; source: string; target: string; label: string; relations: string[] }
    >();
    for (const edge of graph.edges) {
      const source = owners.get(edge.source)!,
        target = owners.get(edge.target)!;
      if (source === target) continue;
      const key = JSON.stringify([source, target]);
      const item = grouped.get(key) ?? { id: key, source, target, label: '', relations: [] };
      item.relations.push(edge.id);
      item.label = `${item.relations.length} 条数据关系`;
      grouped.set(key, item);
    }
    return {
      nodes: graph.domains.map((d) => ({
        ...d,
        kind: 'domain',
        subtitle: `${graph.nodes.filter((n) => n.domain === d.id).length} 个业务实体`,
        boundary: false,
      })),
      edges: [...grouped.values()],
    };
  }
  const local = new Set(graph.nodes.filter((n) => n.domain === domain).map((n) => n.id));
  const edges = graph.edges.filter((e) => local.has(e.source) || local.has(e.target));
  const visible = new Set([...local, ...edges.flatMap((e) => [e.source, e.target])]);
  return {
    nodes: graph.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => ({ ...n, subtitle: kinds[n.kind], boundary: !local.has(n.id) })),
    edges: edges.map((e) => ({ ...e, label: `${e.label} · ${e.data}`, relations: [e.id] })),
  };
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? '读取业务图谱失败');
  return data;
}

export function PendingRelations({
  graph,
  onEvidence,
}: {
  graph: BusinessKnowledge;
  onEvidence: (id: string) => void;
}) {
  if (!graph.pendingRelations?.length) return null;
  return (
    <details className="knowledge-limitations notice" open>
      <summary>部分关系待确认（{graph.pendingRelations.length} 条未绘入主图）</summary>
      <p>
        以下模型关系的读写类型与端点不匹配。其余关系已保留；图谱可能缺少流转环节，孤立节点不表示业务终点。
      </p>
      {graph.pendingRelations.map((e) => {
        const source = graph.nodes.find((n) => n.id === e.source)!,
          target = graph.nodes.find((n) => n.id === e.target)!;
        return (
          <article key={e.id}>
            <h4>
              {source.title} → {target.title} · {e.label}
            </h4>
            <p>
              {kinds[source.kind]} → {kinds[target.kind]}；
              {e.kind === 'reads' ? '读取需要数据对象 → 业务处理' : '写入需要业务处理 → 数据对象'}。
            </p>
            <p>
              模型原始说明：{e.description} · 数据：{e.data}
            </p>
            <details>
              <summary>核对引用依据（{e.evidence.length}）</summary>
              {e.evidence.map((id, i) => (
                <button key={id} className="secondary" onClick={() => onEvidence(id)}>
                  依据 {i + 1}
                </button>
              ))}
            </details>
          </article>
        );
      })}
    </details>
  );
}

export default function KnowledgeWorkspace({
  repo,
  language,
  settingsVersion,
  onSettings,
  onCode,
  onDocument,
}: {
  repo: PublicSnapshot;
  language: Language;
  settingsVersion: number;
  onSettings: () => void;
  onCode: (id: string) => void;
  onDocument: (file: string) => void;
}) {
  const [graph, setGraph] = useState<BusinessKnowledge | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [configured, setConfigured] = useState(false),
    [domain, setDomain] = useState(''),
    [selected, setSelected] = useState(''),
    [edgeIds, setEdgeIds] = useState<string[]>([]),
    [query, setQuery] = useState('');
  const [direction, setDirection] = useState('all'),
    [zoom, setZoom] = useState(1),
    [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const generation = useRef(0),
    viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id?: string;
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    const token = ++generation.current;
    setGraph(null);
    setLoading(true);
    setBusy(false);
    setError('');
    setDomain('');
    setSelected('');
    setEdgeIds([]);
    request<{ graph: BusinessKnowledge | null; configured: boolean }>(
      `/api/knowledge?repo=${encodeURIComponent(repo.id)}&language=${language}`,
    )
      .then((d) => {
        if (generation.current === token) {
          setGraph(d.graph);
          setConfigured(d.configured);
        }
      })
      .catch((e) => {
        if (generation.current === token) setError(e.message);
      })
      .finally(() => {
        if (generation.current === token) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [repo.id, repo.fingerprint, language, settingsVersion]);
  useEffect(() => {
    setOffsets({});
    setZoom(1);
    setSelected('');
    setEdgeIds([]);
    setDirection('all');
    viewport.current?.scrollTo(0, 0);
  }, [domain, graph]);
  async function generate() {
    const token = generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await request<BusinessKnowledge>('/api/knowledge', {
        repo: repo.id,
        language,
        refresh: !!graph,
      });
      if (token === generation.current) setGraph(result);
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const projected = useMemo(
    () => (graph ? projectKnowledge(graph, domain) : null),
    [graph, domain],
  );
  const activeEdges =
    projected?.edges.filter(
      (e) =>
        !selected ||
        (direction === 'in'
          ? e.target === selected
          : direction === 'out'
            ? e.source === selected
            : e.source === selected || e.target === selected),
    ) ?? [];
  const highlighted = new Set([selected, ...activeEdges.flatMap((e) => [e.source, e.target])]);
  const entity = domain ? graph?.nodes.find((n) => n.id === selected) : undefined;
  const selectedDomain = !domain ? graph?.domains.find((d) => d.id === selected) : undefined;
  const relations = graph?.edges.filter((e) => edgeIds.includes(e.id)) ?? [];
  const evidence = [
    ...new Set([...(entity?.evidence ?? []), ...relations.flatMap((e) => e.evidence)]),
  ];
  const columns = domain ? 3 : 2;
  const positions = Object.fromEntries(
    (projected?.nodes ?? []).map((n, i) => [
      n.id,
      offsets[n.id] ?? { x: 60 + (i % columns) * 320, y: 75 + Math.floor(i / columns) * 215 },
    ]),
  );
  const width = Math.max(700, ...Object.values(positions).map((p) => p.x + 290)),
    height = Math.max(560, ...Object.values(positions).map((p) => p.y + 160));
  const enter = (id: string) => {
    setDomain(id);
    setQuery('');
  };
  return (
    <section className="knowledge-workspace">
      <header className="knowledge-heading">
        <div>
          <span className="eyebrow">BUSINESS KNOWLEDGE GRAPH</span>
          <h2>{graph?.title ?? '从业务理解整个仓库'}</h2>
          <p>{graph?.summary ?? '聚合业务域、处理环节和共享数据对象，探索它们之间的数据流向。'}</p>
        </div>
        <div className="knowledge-actions">
          <button className="secondary" onClick={onSettings}>
            <Settings2 size={16} />
            模型设置
          </button>
          <button
            className="primary"
            disabled={loading || busy || language === 'unknown' || !configured}
            onClick={generate}
          >
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : graph ? (
              <RefreshCw size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            {busy ? '正在解读仓库…' : graph ? '重新解读' : '生成业务知识图谱'}
          </button>
        </div>
      </header>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {!configured && !loading && (
        <div className="notice">
          请先配置模型。只有点击生成时，才会把选取的代码与文档发送给该模型。
        </div>
      )}
      {language === 'unknown' && <div className="notice">文档语言尚未识别，请先选择解读语言。</div>}
      {loading ? (
        <p className="knowledge-empty">读取已保存的业务图谱…</p>
      ) : !graph ? (
        <div className="knowledge-empty">
          <Sparkles size={32} />
          <h3>先看业务，再深入数据</h3>
          <p>
            生成后先展示业务域之间的数据关系。展开业务域可查看数据对象和处理环节，函数与文件保留在证据详情中。
          </p>
          <p>这是基于代码与文档的模型解读，不代表实际运行轨迹。</p>
        </div>
      ) : (
        <>
          <div className="knowledge-status">
            AI 解读
            {graph.pendingRelations?.length
              ? ` · 部分结果：${graph.pendingRelations.length} 条关系待确认（见下方）`
              : ''}{' '}
            · {graph.nodes.length} 个业务实体 · {graph.edges.length} 条数据关系 · 引用{' '}
            {graph.coverage.includedCode}/{graph.coverage.totalCode} 个代码片段、
            {graph.coverage.includedDocs}/{graph.coverage.totalDocs} 篇文档
            {graph.coverage.truncated && ' · 证据仅覆盖仓库的一部分'}
          </div>
          <div className="knowledge-layout">
            <aside className="knowledge-domains">
              <h3>业务域</h3>
              <button className={!domain ? 'active' : ''} onClick={() => enter('')}>
                全部业务总览<span>{graph.domains.length}</span>
              </button>
              {graph.domains.map((d) => (
                <button
                  key={d.id}
                  className={domain === d.id ? 'active' : ''}
                  onClick={() => enter(d.id)}
                >
                  {d.title}
                  <span>{graph.nodes.filter((n) => n.domain === d.id).length}</span>
                </button>
              ))}
              <p>箭头表示数据流向。读取数据时，箭头从数据对象指向处理环节。</p>
              <p>虚线边框表示其他业务域的关联实体。</p>
            </aside>
            <div className="knowledge-main">
              <div className="knowledge-toolbar">
                {domain && (
                  <button title="返回总览" onClick={() => enter('')}>
                    <ArrowLeft size={16} />
                  </button>
                )}
                <strong>{graph.domains.find((d) => d.id === domain)?.title ?? '业务总览'}</strong>
                <input
                  aria-label="搜索业务实体"
                  placeholder="搜索业务 / 数据…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="追踪方向"
                  value={direction}
                  disabled={!selected}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="all">相邻数据流</option>
                  <option value="in">流入当前节点</option>
                  <option value="out">流出当前节点</option>
                </select>
              </div>
              <div
                className="knowledge-canvas"
                ref={viewport}
                onPointerDown={(e) => {
                  if (
                    e.target !== e.currentTarget &&
                    (e.target as Element).closest('[data-graph-item]')
                  )
                    return;
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: e.currentTarget.scrollLeft,
                    oy: e.currentTarget.scrollTop,
                    moved: false,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  const dx = e.clientX - d.x,
                    dy = e.clientY - d.y;
                  if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
                  if (d.id)
                    setOffsets((old) => ({
                      ...old,
                      [d.id!]: {
                        x: Math.max(20, d.ox + dx / zoom),
                        y: Math.max(20, d.oy + dy / zoom),
                      },
                    }));
                  else {
                    e.currentTarget.scrollLeft = d.ox - dx;
                    e.currentTarget.scrollTop = d.oy - dy;
                  }
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  if (d && !d.moved && !d.id) {
                    setSelected('');
                    setEdgeIds([]);
                  }
                  drag.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                <svg
                  width={width * zoom}
                  height={height * zoom}
                  viewBox={`0 0 ${width} ${height}`}
                  role="group"
                  aria-label="业务数据关系知识图谱"
                >
                  <defs>
                    <marker
                      id="knowledge-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                    </marker>
                  </defs>
                  {projected!.edges.map((e) => {
                    const a = positions[e.source],
                      b = positions[e.target];
                    const down = b.y > a.y;
                    const sameRow = b.y === a.y;
                    const right = b.x > a.x;
                    const sx = sameRow ? a.x + (right ? 230 : 0) : a.x + 115,
                      sy = sameRow ? a.y + 48 : a.y + (down ? 96 : 0),
                      tx = sameRow ? b.x + (right ? 0 : 230) : b.x + 115,
                      ty = sameRow ? b.y + 48 : b.y + (down ? 0 : 96);
                    const bend = sameRow ? (right ? -35 : 35) : down ? 45 : -45;
                    const mx = (sx + tx) / 2 + (sameRow ? 0 : bend),
                      my = (sy + ty) / 2 + (sameRow ? bend : 0);
                    const dim = selected && !activeEdges.includes(e);
                    return (
                      <g
                        key={e.id}
                        data-graph-item="edge"
                        className={`knowledge-edge ${dim ? 'dim' : ''} ${e.relations.some((id) => edgeIds.includes(id)) ? 'selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={e.label}
                        onClick={() => {
                          setEdgeIds(e.relations);
                          setSelected('');
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            setEdgeIds(e.relations);
                            setSelected('');
                          }
                        }}
                      >
                        <path
                          d={`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`}
                          markerEnd="url(#knowledge-arrow)"
                        />
                        <path className="edge-hit" d={`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`} />
                        <text
                          x={(sx + 2 * mx + tx) / 4}
                          y={(sy + 2 * my + ty) / 4 - 9}
                          textAnchor="middle"
                        >
                          {e.label.length > 23 ? e.label.slice(0, 22) + '…' : e.label}
                        </text>
                        <title>{e.label}</title>
                      </g>
                    );
                  })}
                  {projected!.nodes.map((n) => {
                    const p = positions[n.id],
                      match =
                        !query ||
                        `${n.title} ${n.description} ${'fields' in n && Array.isArray(n.fields) ? n.fields.join(' ') : ''}`
                          .toLowerCase()
                          .includes(query.toLowerCase());
                    return (
                      <g
                        key={n.id}
                        data-graph-item="node"
                        transform={`translate(${p.x},${p.y})`}
                        className={`knowledge-node kind-${n.kind} ${n.boundary ? 'boundary' : ''} ${selected === n.id ? 'selected' : ''} ${!match || (selected && !highlighted.has(n.id)) ? 'dim' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${n.title}，${n.subtitle}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelected(n.id);
                          setEdgeIds([]);
                          drag.current = {
                            id: n.id,
                            x: e.clientX,
                            y: e.clientY,
                            ox: p.x,
                            oy: p.y,
                            moved: false,
                          };
                          viewport.current?.setPointerCapture(e.pointerId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSelected(n.id);
                            setEdgeIds([]);
                          }
                        }}
                        onDoubleClick={() => {
                          if (!domain) enter(n.id);
                        }}
                      >
                        <rect width="230" height="96" rx="14" />
                        <circle cx="20" cy="24" r="4" />
                        <text className="node-kind" x="33" y="28">
                          {n.subtitle}
                          {n.boundary ? ' · 跨域' : ''}
                        </text>
                        <text className="node-title" x="16" y="59">
                          {n.title.slice(0, 15)}
                        </text>
                        {n.title.length > 15 && (
                          <text className="node-title" x="16" y="80">
                            {n.title.slice(15, 29)}
                            {n.title.length > 29 ? '…' : ''}
                          </text>
                        )}
                        <title>{n.title}</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="knowledge-controls">
                <span>拖动画布或节点 · 点击关系查看数据 · {Math.round(zoom * 100)}%</span>
                <button
                  title="缩小"
                  disabled={zoom <= 0.75}
                  onClick={() => setZoom((z) => Math.max(0.75, z - 0.1))}
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  title="放大"
                  disabled={zoom >= 1.5}
                  onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  title="恢复可读大小"
                  onClick={() => {
                    setZoom(1);
                    setOffsets({});
                    viewport.current?.scrollTo(0, 0);
                  }}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>
            <aside className="knowledge-detail">
              <span className="eyebrow">业务详情</span>
              {selectedDomain ? (
                <>
                  <h3>{selectedDomain.title}</h3>
                  <p>{selectedDomain.description}</p>
                  <button className="primary" onClick={() => enter(selectedDomain.id)}>
                    展开业务域
                  </button>
                  <p>域内的业务处理与数据对象将在下一层展示。</p>
                </>
              ) : entity ? (
                <>
                  <h3>{entity.title}</h3>
                  <small>
                    {kinds[entity.kind]} ·{' '}
                    {graph.domains.find((d) => d.id === entity.domain)?.title}
                  </small>
                  <p>{entity.description}</p>
                  {entity.fields.length > 0 && (
                    <>
                      <h4>业务字段 / 状态</h4>
                      <div className="knowledge-fields">
                        {entity.fields.map((f, i) => (
                          <code key={i}>{f}</code>
                        ))}
                      </div>
                    </>
                  )}
                  {entity.domain !== domain && (
                    <button className="secondary" onClick={() => enter(entity.domain)}>
                      进入所属业务域
                    </button>
                  )}
                  <h4>流入 / 流出</h4>
                  {graph.edges
                    .filter((e) => e.source === entity.id || e.target === entity.id)
                    .map((e) => (
                      <button
                        className="knowledge-relation"
                        key={e.id}
                        onClick={() => setEdgeIds([e.id])}
                      >
                        {e.target === entity.id ? '↙ 流入' : '↗ 流出'} · {e.data}
                      </button>
                    ))}
                </>
              ) : !relations.length ? (
                <>
                  <h3>探索数据如何流转</h3>
                  <p>
                    {domain
                      ? '点击业务实体查看相邻流向，或点击连线查看传递的数据。'
                      : '选择业务域并展开，查看其中的数据对象与业务处理。'}
                  </p>
                  {!projected!.edges.length && <p>当前证据未建立跨域数据关系；未添加推测连线。</p>}
                </>
              ) : null}
              {relations.map((e) => (
                <article className="knowledge-relation-detail" key={e.id}>
                  <h4>{e.label}</h4>
                  <p>
                    {graph.nodes.find((n) => n.id === e.source)?.title} →{' '}
                    {graph.nodes.find((n) => n.id === e.target)?.title}
                  </p>
                  <strong>{e.data}</strong>
                  <p>{e.description}</p>
                  {e.directionNormalized && (
                    <small>已根据读写类型与端点类型统一箭头方向；业务含义仍需核对下方依据。</small>
                  )}
                </article>
              ))}
              {evidence.length > 0 && (
                <details>
                  <summary>查看代码 / 文档依据（{evidence.length}）</summary>
                  <p>引用位置用于核对模型解释，不等同于运行时验证。</p>
                  {evidence.map((id) =>
                    id.startsWith('doc:') ? (
                      <button key={id} onClick={() => onDocument(id.slice(4))}>
                        {id.slice(4)}
                      </button>
                    ) : (
                      <button key={id} onClick={() => onCode(id)}>
                        {repo.nodes.find((n) => n.id === id)?.name ?? id}
                        <small>
                          {repo.nodes.find((n) => n.id === id)?.file}:
                          {repo.nodes.find((n) => n.id === id)?.line}
                        </small>
                      </button>
                    ),
                  )}
                </details>
              )}
            </aside>
          </div>
          <PendingRelations
            graph={graph}
            onEvidence={(id) => (id.startsWith('doc:') ? onDocument(id.slice(4)) : onCode(id))}
          />
          {graph.limitations.length > 0 && (
            <details className="knowledge-limitations">
              <summary>解读范围与待确认项（{graph.limitations.length}）</summary>
              <ul>
                {graph.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
