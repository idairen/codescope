import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import type { CodeNode, CodeEdge } from '../shared/types';
interface Props {
  nodes: CodeNode[];
  edges: CodeEdge[];
  selected: string;
  path: string[];
  activeStep: number;
  labels: Map<string, string>;
  onSelect: (id: string) => void;
  onEdge: (edge: CodeEdge) => void;
}
interface Point {
  x: number;
  y: number;
}
function layout(nodes: CodeNode[], edges: CodeEdge[]): Record<string, Point> {
  const ids = new Set(nodes.map((n) => n.id)),
    indegree = new Map(nodes.map((n) => [n.id, 0])),
    adjacency = new Map<string, string[]>();
  for (const e of edges)
    if (ids.has(e.source) && ids.has(e.target)) {
      indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
      adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
    }
  const roots = nodes.filter((n) => !indegree.get(n.id)),
    queue = roots.map((n) => n.id),
    levels = new Map(queue.map((id) => [id, 0]));
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacency.get(queue[i]) ?? [])
      if (!levels.has(next)) {
        levels.set(next, Math.min((levels.get(queue[i]) ?? 0) + 1, 7));
        queue.push(next);
      }
  }
  const rows = new Map<number, number>(),
    positions: Record<string, Point> = {};
  for (const n of nodes) {
    const level = levels.get(n.id) ?? 0,
      row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    positions[n.id] = { x: 60 + level * 320, y: 70 + row * 128 };
  }
  return positions;
}
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export default function Graph({
  nodes,
  edges,
  selected,
  path,
  activeStep,
  labels,
  onSelect,
  onEdge,
}: Props) {
  const initial = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const [positions, setPositions] = useState(initial),
    [view, setView] = useState({ x: 0, y: 0, w: 1200, h: 700 });
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ id?: string; x: number; y: number; origin: Point } | null>(null);
  const fit = () => {
    const width = Math.max(800, ...Object.values(initial).map((p) => p.x + 300)),
      height = Math.max(500, ...Object.values(initial).map((p) => p.y + 140));
    const rect = svg.current?.getBoundingClientRect(),
      ratio = rect ? rect.width / rect.height : 1.7;
    const w = Math.max(width, height * ratio);
    setView({ x: -25, y: -20, w, h: w / ratio });
  };
  useEffect(() => {
    setPositions(initial);
    fit();
  }, [initial]);
  const connected = new Set([
    selected,
    ...edges
      .filter((e) => e.source === selected || e.target === selected)
      .flatMap((e) => [e.source, e.target]),
  ]);
  const pathEdges = new Set(path.slice(1).map((id, i) => `${path[i]}|${id}`));
  const zoom = (factor: number) =>
    setView((v) => ({
      ...v,
      x: v.x + (v.w * (1 - factor)) / 2,
      y: v.y + (v.h * (1 - factor)) / 2,
      w: v.w * factor,
      h: v.h * factor,
    }));
  return (
    <div className="graph-canvas">
      <div className="canvas-caption">
        <span className="live-dot" /> 静态代码关系 <span>拖动节点 · 拖动画布平移</span>
      </div>
      <svg
        ref={svg}
        className="graph-svg"
        role="img"
        aria-label="代码关系交互图"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, origin: { x: view.x, y: view.y } };
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current,
            rect = svg.current?.getBoundingClientRect();
          if (!d || !rect) return;
          const dx = ((e.clientX - d.x) * view.w) / rect.width,
            dy = ((e.clientY - d.y) * view.h) / rect.height;
          if (d.id)
            setPositions((p) => ({ ...p, [d.id!]: { x: d.origin.x + dx, y: d.origin.y + dy } }));
          else setView((v) => ({ ...v, x: d.origin.x - dx, y: d.origin.y - dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <marker
            id="arrow"
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
        {edges.map((e) => {
          const a = positions[e.source],
            b = positions[e.target];
          if (!a || !b) return null;
          const highlighted = pathEdges.has(`${e.source}|${e.target}`),
            related = e.source === selected || e.target === selected;
          const x = a.x + 242,
            y = a.y + 44,
            tx = b.x,
            ty = b.y + 44;
          const bend = Math.max(60, Math.abs(tx - x) * 0.5);
          const d =
            e.source === e.target
              ? `M ${x} ${y} C ${x + 90} ${y - 100}, ${a.x - 80} ${y - 100}, ${a.x} ${y}`
              : `M ${x} ${y} C ${x + bend} ${y}, ${tx - bend} ${ty}, ${tx} ${ty}`;
          return (
            <g
              key={e.id}
              className={`graph-edge ${highlighted ? 'traced' : ''} ${related ? 'related' : ''}`}
              onClick={() => onEdge(e)}
            >
              <title>{`${e.kind} · ${e.file}:${e.line}`}</title>
              <path d={d} fill="none" stroke="transparent" strokeWidth="18" className="edge-hit" />
              <path
                d={d}
                fill="none"
                strokeWidth={highlighted ? 3 : related ? 2 : 1.5}
                markerEnd="url(#arrow)"
              />
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = positions[n.id];
          if (!p) return null;
          const active = path[activeStep] === n.id;
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`查看 ${n.name}`}
              className={`graph-node ${n.kind} ${selected === n.id ? 'selected' : ''} ${active ? 'active-step' : ''} ${selected && !connected.has(n.id) && !path.includes(n.id) ? 'dimmed' : ''}`}
              transform={`translate(${p.x},${p.y})`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { id: n.id, x: e.clientX, y: e.clientY, origin: p };
                onSelect(n.id);
              }}
            >
              <title>{`${n.name}\n${n.file}:${n.line}`}</title>
              <rect className="node-body" width="242" height="88" rx="10" />
              <rect className="node-accent" width="4" height="46" x="0" y="21" rx="2" />
              <text x="17" y="23" className="node-type">
                {n.kind === 'route'
                  ? 'HTTP / ROUTE'
                  : n.kind === 'file'
                    ? 'MODULE'
                    : n.kind === 'method'
                      ? 'METHOD'
                      : 'FUNCTION'}
              </text>
              <text x="17" y="47" className="node-name">
                {short(labels.get(n.id) ?? n.name, 27)}
              </text>
              <text x="17" y="69" className="node-file">
                {short(n.file, 32)}:{n.line}
              </text>
              {path.includes(n.id) && (
                <>
                  <circle cx="235" cy="0" r="12" className="step-circle" />
                  <text x="235" y="4" textAnchor="middle" className="step-text">
                    {path.indexOf(n.id) + 1}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {!nodes.length && <div className="canvas-empty">没有匹配的节点，请调整搜索或模块筛选。</div>}
      <div className="canvas-legend">
        <span>
          <i className="green" />
          函数
        </span>
        <span>
          <i className="blue" />
          路由候选
        </span>
        <span>
          <i className="purple" />
          模块
        </span>
        <span className="legend-line">→ 静态关系</span>
      </div>
      <div className="canvas-controls">
        <button aria-label="放大图谱" onClick={() => zoom(0.8)}>
          <Plus size={17} />
        </button>
        <button aria-label="缩小图谱" onClick={() => zoom(1.25)}>
          <Minus size={17} />
        </button>
        <button aria-label="适应画布" onClick={fit}>
          <Maximize2 size={17} />
        </button>
      </div>
    </div>
  );
}
