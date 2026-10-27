import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  Flag,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  BusinessEntry,
  BusinessFlow,
  BusinessStep,
  Language,
  PublicSnapshot,
} from '../shared/types';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '读取业务流程失败');
  return data;
}
const kindNames: Record<BusinessStep['kind'], string> = {
  entry: '业务入口',
  action: '业务处理',
  decision: '业务判断',
  outcome: '业务结果',
  unknown: '待确认的结束',
};
const icons = {
  entry: Play,
  action: ArrowRight,
  decision: GitBranch,
  outcome: Flag,
  unknown: Search,
};

export function layoutBusiness(flow: BusinessFlow) {
  const first = flow.steps.find((s) => s.kind === 'entry')!;
  const depth = new Map([[first.id, 0]]),
    queue = [first.id];
  for (let i = 0; i < queue.length; i++)
    for (const e of flow.transitions)
      if (e.source === queue[i] && !depth.has(e.target)) {
        depth.set(e.target, (depth.get(queue[i]) ?? 0) + 1);
        queue.push(e.target);
      }
  // Preserve joining dependencies in acyclic graphs; cycles keep a finite BFS layout.
  const incoming = new Map(
    flow.steps.map((s) => [s.id, flow.transitions.filter((e) => e.target === s.id).length]),
  );
  const ready = flow.steps.filter((s) => incoming.get(s.id) === 0).map((s) => s.id),
    longest = new Map(ready.map((id) => [id, 0]));
  for (let i = 0; i < ready.length; i++)
    for (const e of flow.transitions.filter((e) => e.source === ready[i])) {
      longest.set(e.target, Math.max(longest.get(e.target) ?? 0, (longest.get(e.source) ?? 0) + 1));
      incoming.set(e.target, (incoming.get(e.target) ?? 1) - 1);
      if (incoming.get(e.target) === 0) ready.push(e.target);
    }
  const levels = ready.length === flow.steps.length ? longest : depth;
  const rows = new Map<number, BusinessStep[]>();
  for (const step of flow.steps) {
    const level = levels.get(step.id) ?? 0;
    rows.set(level, [...(rows.get(level) ?? []), step]);
  }
  const width = Math.max(760, ...[...rows.values()].map((row) => row.length * 300 + 100));
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [level, row] of rows)
    row.forEach(
      (s, i) =>
        (positions[s.id] = {
          x: (width - row.length * 300) / 2 + i * 300 + 20,
          y: 35 + level * 236,
        }),
    );
  return { positions, width, height: (Math.max(...rows.keys()) + 1) * 236 + 35 };
}

export function BusinessDiagram({
  flow,
  selected,
  onSelect,
}: {
  flow: BusinessFlow;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { positions, width, height } = useMemo(() => layoutBusiness(flow), [flow]);
  return (
    <div className="business-scroll">
      <div className="business-paper" style={{ width, height }}>
        <svg
          className="business-connectors"
          width={width}
          height={height}
          aria-label="业务步骤之间的数据流向"
        >
          <defs>
            <marker
              id="business-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10z" fill="context-stroke" />
            </marker>
          </defs>
          {flow.transitions.map((edge, i) => {
            const a = positions[edge.source],
              b = positions[edge.target],
              x = a.x + 130,
              y = a.y + 154,
              tx = b.x + 130,
              ty = b.y;
            const mid = (y + ty) / 2;
            const backward = ty < y;
            const d = backward
              ? `M${a.x + 260} ${a.y + 80} C${width - 15} ${a.y + 80}, ${width - 15} ${b.y + 80}, ${b.x + 260} ${b.y + 80}`
              : `M${x} ${y} C${x} ${mid}, ${tx} ${mid}, ${tx} ${ty - 7}`;
            const label = edge.condition || edge.data;
            return (
              <g
                key={i}
                className={
                  selected === edge.source || selected === edge.target
                    ? 'business-wire active'
                    : 'business-wire'
                }
              >
                <title>{`${edge.condition ? `${edge.condition} · ` : ''}${edge.data}`}</title>
                <path d={d} fill="none" markerEnd="url(#business-arrow)" />
                <text
                  x={backward ? width - 65 : (x + tx) / 2}
                  y={backward ? (a.y + b.y) / 2 : mid - 5}
                  textAnchor="middle"
                >
                  {label.length > 22 ? label.slice(0, 21) + '…' : label}
                </text>
              </g>
            );
          })}
        </svg>
        {flow.steps.map((step) => {
          const pos = positions[step.id],
            Icon = icons[step.kind];
          return (
            <button
              key={step.id}
              className={`business-step ${step.kind} ${selected === step.id ? 'selected' : ''}`}
              style={{ left: pos.x, top: pos.y }}
              onClick={() => onSelect(step.id)}
              aria-label={`查看业务步骤：${step.title}`}
            >
              <div className="business-step-type">
                <Icon size={13} />
                {kindNames[step.kind]}
                <ChevronRight size={13} />
              </div>
              <strong>{step.title}</strong>
              <div className="step-data">
                <span>输入</span>
                <p title={step.input}>{step.input}</p>
              </div>
              <div className="step-data">
                <span>输出</span>
                <p title={step.output}>{step.output}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BusinessWorkspace({
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
  onDocument: (path: string) => void;
}) {
  const [entries, setEntries] = useState<BusinessEntry[]>([]),
    [flows, setFlows] = useState<BusinessFlow[]>([]),
    [entryId, setEntryId] = useState(''),
    [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [generating, setGenerating] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState('');
  const [source, setSource] = useState<{ file: string; line: number; text: string } | null>(null),
    [sourceId, setSourceId] = useState('');
  const requestVersion = useRef('');
  requestVersion.current = `${repo.id}:${repo.fingerprint}:${language}:${settingsVersion}`;
  const flow = flows.find((f) => f.entryId === entryId),
    entry = entries.find((e) => e.id === entryId),
    step = flow?.steps.find((s) => s.id === selected);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFlows([]);
    setEntries([]);
    setError('');
    setSelected('');
    setSource(null);
    setSourceId('');
    void request<{ entries: BusinessEntry[]; flows: BusinessFlow[]; configured: boolean }>(
      `/api/business?repo=${encodeURIComponent(repo.id)}&language=${language}`,
    )
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setFlows(result.flows);
        setConfigured(result.configured);
        setEntryId((previous) =>
          result.entries.some((e) => e.id === previous) ? previous : (result.entries[0]?.id ?? ''),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.id, repo.fingerprint, language, settingsVersion]);
  useEffect(() => {
    setSelected('');
    setSource(null);
    setSourceId('');
    setError('');
  }, [entryId]);
  useEffect(() => {
    setSource(null);
    setSourceId('');
  }, [selected]);
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    if (!sourceId) return;
    const n = repo.nodes.find((n) => n.id === sourceId);
    if (!n) return;
    void request<{ text: string }>(`/api/source?repo=${repo.id}&file=${encodeURIComponent(n.file)}`)
      .then((f) => {
        if (!cancelled)
          setSource({
            file: n.file,
            line: n.line,
            text: f.text
              .split('\n')
              .slice(n.line - 1, n.endLine)
              .join('\n'),
          });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, repo.id, repo.fingerprint]);
  const generate = async (refresh = false) => {
    const version = requestVersion.current,
      id = entryId;
    setError('');
    setGenerating(true);
    try {
      const next = await request<BusinessFlow>('/api/business', {
        repo: repo.id,
        entryId: id,
        language,
        refresh,
      });
      if (version !== requestVersion.current) return;
      setFlows((previous) => [...previous.filter((f) => f.entryId !== id), next]);
      setSelected('');
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };
  return (
    <section className="business-workspace">
      <div className="business-intro">
        <div>
          <span className="eyebrow">BUSINESS JOURNEY</span>
          <h2>从业务入口，走到业务结果</h2>
          <p>一次专注一项业务。查看关键步骤、判断分支，以及每一步接收和产出的数据。</p>
        </div>
        <span className="business-mode">
          <GitBranch size={15} />
          业务视角
        </span>
      </div>
      <div className="business-layout">
        <aside className="scenario-list">
          <h3>
            业务场景 <span>{entries.length}</span>
          </h3>
          <label className="scenario-search">
            <Search size={14} />
            <input
              aria-label="搜索业务场景"
              placeholder="查找场景或入口…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {loading ? (
            <p className="business-muted">读取业务入口…</p>
          ) : (
            entries
              .filter((e) =>
                `${flows.find((f) => f.entryId === e.id)?.title ?? ''} ${e.name}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((e) => {
                const result = flows.find((f) => f.entryId === e.id);
                return (
                  <button
                    key={e.id}
                    className={`scenario-card ${entryId === e.id ? 'selected' : ''}`}
                    disabled={generating}
                    onClick={() => setEntryId(e.id)}
                  >
                    <span>
                      {result ? <Check size={13} /> : <Play size={13} />}{' '}
                      {result ? '已解读' : '入口候选'}
                    </span>
                    <strong>{result?.title ?? e.name}</strong>
                    <small>{result ? e.name : e.file}</small>
                  </button>
                );
              })
          )}
          <p className="scenario-note">入口由代码识别；业务名称和完整流程由代码与文档共同解读。</p>
        </aside>
        <div className="business-main">
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="关闭业务错误" onClick={() => setError('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {flow ? (
            <>
              <header className="journey-heading">
                <div>
                  <span className="eyebrow">AI 解读 · 尚未经人工确认</span>
                  <h2>{flow.title}</h2>
                  <p>{flow.goal}</p>
                  <div className="journey-trigger">
                    <Play size={13} />
                    <span>{flow.trigger}</span>
                  </div>
                </div>
                <button
                  className="secondary"
                  disabled={generating || language === 'unknown'}
                  onClick={() => void generate(true)}
                >
                  {generating ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  重新解读
                </button>
              </header>
              <div className="journey-view">
                <BusinessDiagram flow={flow} selected={selected} onSelect={setSelected} />
                {step && (
                  <aside className="business-detail">
                    <div className="business-detail-header">
                      <span>{kindNames[step.kind]}</span>
                      <button aria-label="收起步骤详情" onClick={() => setSelected('')}>
                        <X size={16} />
                      </button>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <dl>
                      <dt>进入这一步的数据</dt>
                      <dd>{step.input}</dd>
                      <dt>处理后的结果</dt>
                      <dd>{step.output}</dd>
                    </dl>
                    <h4>接下来</h4>
                    {flow.transitions
                      .filter((e) => e.source === step.id)
                      .map((edge, i) => (
                        <button
                          key={i}
                          className="next-business-step"
                          onClick={() => setSelected(edge.target)}
                        >
                          <span>
                            {edge.condition || '继续'}
                            <small>{edge.data}</small>
                          </span>
                          <ArrowRight size={14} />
                        </button>
                      ))}
                    {!flow.transitions.some((e) => e.source === step.id) && (
                      <p className="business-muted">
                        {step.kind === 'unknown'
                          ? '已到当前证据能覆盖的边界。'
                          : '该业务分支结束。'}
                      </p>
                    )}
                    <details className="business-evidence">
                      <summary>
                        <Code2 size={14} />
                        展开代码依据 <span>{step.evidence.length}</span>
                      </summary>
                      {step.evidence.map((id) => {
                        const n = repo.nodes.find((n) => n.id === id);
                        return (
                          <div className="business-evidence-item" key={id}>
                            <button onClick={() => setSourceId(id)}>
                              <FileCode2 size={13} />
                              <span>
                                {n?.name}
                                <small>
                                  {n?.file}:{n?.line}
                                </small>
                              </span>
                            </button>
                            <button className="code-link" onClick={() => onCode(id)}>
                              代码视图 <ArrowRight size={12} />
                            </button>
                          </div>
                        );
                      })}
                      {source && (
                        <div className="business-source">
                          <small>
                            {source.file}:{source.line}
                          </small>
                          <pre>{source.text}</pre>
                        </div>
                      )}
                    </details>
                  </aside>
                )}
              </div>
              <footer className="journey-footer">
                <span>
                  {flow.steps.length} 个业务步骤 ·{' '}
                  {flow.steps.filter((s) => s.kind === 'outcome').length} 个结果 ·{' '}
                  {flow.steps.filter((s) => s.kind === 'unknown').length} 个待确认边界
                </span>
                <span>连线描述业务流转，不代表运行时采样</span>
              </footer>
              <details className="business-limitations">
                <summary>解读依据与未确认部分</summary>
                <p>
                  该流程由模型根据代码与文档推导；引用有效不代表业务语义已被验证。当前范围为所选入口，跨入口生命周期可能需要补充证据。
                </p>
                {flow.limitations.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
                {flow.documentEvidence.map((doc) => (
                  <button key={doc} onClick={() => onDocument(doc)}>
                    <BookOpen size={13} />
                    {doc}
                  </button>
                ))}
              </details>
            </>
          ) : (
            <div className="business-empty">
              <div className="journey-placeholder">
                <span>
                  <Play size={19} />
                  业务入口
                </span>
                <ArrowDown size={18} />
                <span>
                  <GitBranch size={19} />
                  处理与判断
                </span>
                <ArrowDown size={18} />
                <span>
                  <Flag size={19} />
                  业务结果
                </span>
              </div>
              <h3>
                {entries.length
                  ? '先把这个入口解读成一项业务'
                  : loading
                    ? '正在读取入口'
                    : '还没有识别到业务入口'}
              </h3>
              <p>
                {entries.length
                  ? '将相关代码与文档整理为业务步骤、条件分支和数据流向。底层函数将收进步骤详情，不在主图中铺开。'
                  : '当前支持已识别的路由和无调用方函数作为入口候选。其他入口形式可先在代码证据中查看。'}
              </p>
              {entry && (
                <div className="selected-entry">
                  当前入口：<code>{entry.name}</code>
                </div>
              )}
              {language === 'unknown' && (
                <p className="inline-error">文档语言不明确，请先在上方选择解释语言。</p>
              )}
              {entries.length > 0 &&
                (configured ? (
                  <button
                    className="primary"
                    disabled={generating || language === 'unknown'}
                    onClick={() => void generate()}
                  >
                    {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{' '}
                    {generating ? '正在梳理业务流程…' : '生成业务流程'}
                  </button>
                ) : (
                  <button className="primary" onClick={onSettings}>
                    <Settings2 size={16} />
                    配置模型，开始业务解读
                  </button>
                ))}
              <small>
                生成时将该入口相关代码和选取的文档发送到所配置的模型。没有模型时不会把调用关系伪装成业务流程。
              </small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
