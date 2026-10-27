import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  Folder,
  GitBranch,
  Globe2,
  Layers,
  Loader2,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  X,
  AlertCircle,
} from 'lucide-react';
import Graph from './Graph';
import BusinessWorkspace from './KnowledgeGraph';
import {
  directedPath,
  type PublicSnapshot,
  type CodeEdge,
  type ScanJob,
  type Language,
  type Explanation,
} from '../shared/types';
async function api<T>(url: string, body?: unknown): Promise<T> {
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
  if (!response.ok) throw Error(data.error ?? '请求失败');
  return data;
}
const languageNames: Record<Language, string> = {
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  unknown: '待选择',
};
const relationNames: Record<string, string> = {
  calls: '静态调用',
  imports: '模块引用',
  handles: '路由绑定候选',
};
export default function App() {
  const [repositories, setRepositories] = useState<PublicSnapshot[]>([]),
    [repoId, setRepoId] = useState('');
  const repo = repositories.find((r) => r.id === repoId);
  const [defaults, setDefaults] = useState({ examplePath: '', workspacePath: '' });
  const [importOpen, setImportOpen] = useState(false),
    [root, setRoot] = useState(''),
    [job, setJob] = useState<ScanJob | null>(null),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [module, setModule] = useState(''),
    [view, setView] = useState<'business' | 'flow' | 'modules' | 'docs'>('business');
  const [selected, setSelected] = useState(''),
    [selectedEdge, setSelectedEdge] = useState<CodeEdge | null>(null),
    [source, setSource] = useState(''),
    [docPath, setDocPath] = useState('');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [trace, setTrace] = useState<string[]>([]),
    [traceMessage, setTraceMessage] = useState(''),
    [playing, setPlaying] = useState(false),
    [step, setStep] = useState(-1);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1'),
    [model, setModel] = useState(''),
    [apiKey, setApiKey] = useState(''),
    [hasKey, setHasKey] = useState(false),
    [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [languageOverride, setLanguageOverride] = useState(''),
    [explanation, setExplanation] = useState<Explanation | null>(null),
    [explaining, setExplaining] = useState(false);
  const language = (languageOverride || repo?.language.code || 'unknown') as Language;
  const contextVersion = useRef('');
  contextVersion.current = `${repoId}:${repo?.fingerprint}:${language}`;
  const node = repo?.nodes.find((n) => n.id === selected);
  const busy = job?.state === 'running';
  const reload = async (id?: string) => {
    const items = await api<PublicSnapshot[]>('/api/repositories');
    setRepositories(items);
    setRepoId(id ?? items.at(-1)?.id ?? '');
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
    void api<typeof defaults>('/api/defaults')
      .then(setDefaults)
      .catch((e) => setError(e.message));
    void api<{ baseUrl: string; model: string; hasKey: boolean }>('/api/settings')
      .then((s) => {
        setBaseUrl(s.baseUrl);
        setModel(s.model);
        setHasKey(s.hasKey);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!job || job.state !== 'running') return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api<ScanJob>(`/api/jobs/${job.id}`)
        .then(async (next) => {
          if (cancelled) return;
          setJob(next);
          if (next.state === 'done') {
            await reload(next.snapshotId);
            setImportOpen(false);
          }
          if (next.state === 'error') setError(next.message);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e.message);
            setJob((j) => (j ? { ...j, state: 'error' } : null));
          }
        });
    }, 600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  useEffect(() => {
    setSelected('');
    setSelectedEdge(null);
    setTrace([]);
    setTraceMessage('');
    setPlaying(false);
    setExplanation(null);
    setModule('');
    setQuery('');
    setStart('');
    setEnd('');
    setDocPath('');
    setLanguageOverride(repoId ? (localStorage.getItem(`codescope:language:${repoId}`) ?? '') : '');
  }, [repoId, repo?.fingerprint]);
  useEffect(() => {
    setExplanation(null);
  }, [language]);
  useEffect(() => {
    const file = selectedEdge?.file ?? (view === 'docs' ? docPath : node?.file);
    setSource('');
    if (!repo || !file) return;
    let cancelled = false;
    void api<{ text: string }>(
      `/api/source?repo=${encodeURIComponent(repo.id)}&file=${encodeURIComponent(file)}`,
    )
      .then((f) => {
        if (!cancelled) setSource(f.text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, repo?.fingerprint, node?.file, selectedEdge?.file, docPath, view]);
  useEffect(() => {
    if (!playing || !trace.length) return;
    const timer = setInterval(
      () =>
        setStep((i) => {
          if (i >= trace.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      850,
    );
    return () => clearInterval(timer);
  }, [playing, trace]);
  const modules = useMemo(
    () =>
      [
        ...new Set(
          repo?.files.map((f) =>
            f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.',
          ) ?? [],
        ),
      ].sort(),
    [repo],
  );
  const allNodes = useMemo(
    () =>
      repo?.nodes.filter((n) => (view === 'modules' ? n.kind === 'file' : n.kind !== 'file')) ?? [],
    [repo, view],
  );
  const visibleNodes = useMemo(() => {
    const filtered = allNodes.filter(
      (n) =>
        (!module || n.module === module) &&
        (!query || `${n.name} ${n.file}`.toLowerCase().includes(query.toLowerCase())),
    );
    const traced = filtered.filter((n) => trace.includes(n.id));
    return [...traced, ...filtered.filter((n) => !trace.includes(n.id))].slice(
      0,
      Math.max(140, traced.length),
    );
  }, [allNodes, module, query, trace]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return (
      repo?.edges.filter(
        (e) =>
          ids.has(e.source) &&
          ids.has(e.target) &&
          (view === 'modules' ? e.kind === 'imports' : e.kind !== 'imports'),
      ) ?? []
    );
  }, [repo, visibleNodes, view]);
  const labels = useMemo(
    () => new Map(explanation?.nodes.map((n) => [n.id, n.label]) ?? []),
    [explanation],
  );
  const related = repo?.edges.filter((e) => e.source === selected || e.target === selected) ?? [];
  const scan = async (path: string) => {
    setError('');
    try {
      setJob(await api<ScanJob>('/api/scan', { root: path }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const selectNode = (id: string) => {
    setSelected(id);
    setSelectedEdge(null);
  };
  const findPath = () => {
    if (!repo) return;
    const result = directedPath(repo.nodes, repo.edges, start, end);
    setTrace(result);
    setStep(result.length ? 0 : -1);
    setPlaying(false);
    setTraceMessage(result.length ? '' : '未找到已解析的有向路径；这不代表运行时一定无法到达。');
    if (result.length) {
      setQuery('');
      setModule('');
      setView('flow');
      selectNode(start);
    }
  };
  const generate = async () => {
    if (!repo || !selected) return;
    setError('');
    setExplaining(true);
    const requestId = repo.id,
      requestLanguage = language,
      version = contextVersion.current;
    try {
      const result = await api<Explanation>('/api/explain', {
        repo: requestId,
        nodeId: selected,
        language: requestLanguage,
      });
      if (contextVersion.current === version) setExplanation(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExplaining(false);
    }
  };
  const exportGraph = async () => {
    if (!repo) return;
    try {
      let payload: unknown = { ...repo, root: undefined, explanation };
      if (view === 'business') {
        const data = await api<{ graph: unknown | null }>(
          `/api/knowledge?repo=${repo.id}&language=${language}`,
        );
        if (!data.graph) {
          setError('请先生成业务知识图谱，再导出。');
          return;
        }
        payload = {
          repository: repo.name,
          fingerprint: repo.fingerprint,
          language,
          graph: data.graph,
        };
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = `${repo.name}-${view === 'business' ? 'business-knowledge' : 'graph'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <div className="brand-mark">
            <Network size={23} />
          </div>
          <span>
            CodeScope<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">
          LOCAL WORKSPACE <span>01</span>
        </div>
        <button className="repository-picker" onClick={() => setImportOpen(true)}>
          <div className="repository-icon">
            <Folder size={18} />
          </div>
          <span>
            {repo?.name ?? '连接一个仓库'}
            <small>{repo ? '本地代码仓库' : '从代码开始探索'}</small>
          </span>
          <Plus size={16} />
        </button>
        {repositories.length > 1 && (
          <select
            className="repo-select"
            aria-label="切换仓库"
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <nav className="main-nav">
          <button
            className={view === 'business' ? 'active' : ''}
            onClick={() => setView('business')}
          >
            <Activity size={18} />
            业务图谱
          </button>
          <button
            className={view === 'flow' ? 'active' : ''}
            onClick={() => {
              setView('flow');
              setSelectedEdge(null);
            }}
          >
            <GitBranch size={18} />
            代码证据<span>{repo?.nodes.filter((n) => n.kind !== 'file').length ?? '—'}</span>
          </button>
          <button
            className={view === 'modules' ? 'active' : ''}
            onClick={() => {
              setView('modules');
              setTrace([]);
              setPlaying(false);
            }}
          >
            <Layers size={18} />
            模块依赖
          </button>
          <button
            className={view === 'docs' ? 'active' : ''}
            onClick={() => {
              setView('docs');
              setSelectedEdge(null);
              setDocPath(repo?.documents[0]?.path ?? '');
            }}
          >
            <BookOpen size={18} />
            文档依据<span>{repo?.documents.length ?? '—'}</span>
          </button>
        </nav>
        {view !== 'business' && (
          <>
            <div className="section-label">
              模块筛选 <span>{modules.length}</span>
            </div>
            <div className="module-list">
              <button className={!module ? 'current' : ''} onClick={() => setModule('')}>
                <Box size={15} />
                所有模块
              </button>
              {modules.map((m) => (
                <button
                  key={m}
                  title={m}
                  className={module === m ? 'current' : ''}
                  onClick={() => {
                    setModule(m);
                    if (view === 'docs') setView('flow');
                  }}
                >
                  <Folder size={15} />
                  <span>{m === '.' ? '根目录' : m}</span>
                  <small>
                    {
                      repo?.files.filter(
                        (f) =>
                          (f.path.includes('/')
                            ? f.path.slice(0, f.path.lastIndexOf('/'))
                            : '.') === m,
                      ).length
                    }
                  </small>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="live-dot" />
            <div>
              图谱保存在本机<small>仅在主动生成 AI 解读时调用模型</small>
            </div>
          </div>
          <button
            className="settings-button"
            onClick={() => {
              setSettingsOpen(true);
              setSettingsSaved(false);
            }}
          >
            <Settings2 size={17} />
            模型设置
            <ChevronRight size={15} />
          </button>
          <div className="version">
            CodeScope <span>v0.1 · 本地预览版</span>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <Folder size={14} />
            <span>工作区</span>
            <ChevronRight size={13} />
            <strong>{repo?.name ?? '尚未连接'}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="live-dot" />
              LOCAL
            </span>
            <span className="avatar">CS</span>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">EXPLORE YOUR CODEBASE</div>
            <h1>
              探索业务数据的流向<span className="heading-dot">.</span>
            </h1>
            <p>从业务域到共享数据，探索处理环节之间的数据流转。</p>
          </div>
          <div className="heading-actions">
            <button className="secondary" disabled={!repo} onClick={exportGraph}>
              <ArrowDownToLine size={16} />
              导出图谱
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => (repo ? void scan(repo.root) : setImportOpen(true))}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{' '}
              {busy ? '正在扫描' : repo ? '重新扫描' : '连接仓库'}
            </button>
          </div>
        </section>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button aria-label="关闭错误" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <div className="notice progress" role="status">
            <Loader2 size={16} className="spin" />
            {job.message} · 完成后替换图谱，当前结果仍可查看
          </div>
        )}
        {!repo ? (
          <section className="welcome">
            <div className="welcome-diagram">
              <div>
                <Code2 size={25} />
              </div>
              <span>·········</span>
              <div className="featured">
                <Network size={33} />
              </div>
              <span>·········</span>
              <div>
                <GitBranch size={25} />
              </div>
            </div>
            <span className="eyebrow">FROM SOURCE TO UNDERSTANDING</span>
            <h2>一项业务，从哪里开始，到哪里结束？</h2>
            <p>
              连接本地仓库，结合代码和文档梳理业务域与数据对象，
              <br />
              沿着数据关系探索，并随时展开代码依据。
            </p>
            <div className="welcome-actions">
              <button className="primary" onClick={() => setImportOpen(true)}>
                <Plus size={17} />
                连接本地仓库
              </button>
              <button
                className="secondary"
                disabled={busy || !defaults.examplePath}
                onClick={() => void scan(defaults.examplePath)}
              >
                扫描订单示例 <ArrowRight size={16} />
              </button>
            </div>
            <div className="welcome-facts">
              <span>
                <Check size={15} />
                支持 TypeScript / JavaScript
              </span>
              <span>
                <Check size={15} />
                基础代码扫描无需模型
              </span>
              <span>
                <Check size={15} />
                只读分析源代码
              </span>
            </div>
          </section>
        ) : (
          <>
            <section className={`metrics ${view === 'business' ? 'business-metrics' : ''}`}>
              <div>
                <FileCode2 size={19} />
                <span>
                  源文件
                  <strong>
                    {repo.files.length}
                    <small>已扫描</small>
                  </strong>
                </span>
              </div>
              <div>
                <Network size={19} />
                <span>
                  代码符号
                  <strong>
                    {repo.nodes.filter((n) => n.kind !== 'file').length}
                    <small>节点</small>
                  </strong>
                </span>
              </div>
              <div>
                <GitBranch size={19} />
                <span>
                  静态关系
                  <strong>
                    {repo.edges.length}
                    <small>可追溯</small>
                  </strong>
                </span>
              </div>
              <div>
                <Globe2 size={19} />
                <span>
                  解释语言
                  <strong className="language-value">
                    <select
                      aria-label="解释语言"
                      value={languageOverride}
                      disabled={explaining}
                      onChange={(e) => {
                        setLanguageOverride(e.target.value);
                        localStorage.setItem(`codescope:language:${repo.id}`, e.target.value);
                      }}
                    >
                      <option value="">自动 · {languageNames[repo.language.code]}</option>
                      {Object.entries(languageNames)
                        .filter(([k]) => k !== 'unknown')
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </strong>
                </span>
              </div>
            </section>
            <div className="scan-meta">
              <span>
                <span className="live-dot" />
                扫描于{' '}
                {new Date(repo.scannedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span>
                新增 {repo.changes.added.length} · 修改 {repo.changes.modified.length} · 删除{' '}
                {repo.changes.deleted.length}
                {view !== 'business' && <> · 复用 {repo.changes.reused} 个 AST</>}
              </span>
              <span title={repo.language.evidence.join(', ')}>
                语言依据：
                {languageOverride
                  ? '手动选择'
                  : repo.language.evidence.slice(0, 2).join('、') || '文档不足，请选择'}
              </span>
            </div>
            {view === 'business' ? (
              <BusinessWorkspace
                repo={repo}
                language={language}
                settingsVersion={settingsVersion}
                onSettings={() => {
                  setSettingsOpen(true);
                  setSettingsSaved(false);
                }}
                onCode={(id) => {
                  setView('flow');
                  setModule('');
                  setQuery('');
                  selectNode(id);
                }}
                onDocument={(file) => {
                  setView('docs');
                  setSelectedEdge(null);
                  setDocPath(file);
                }}
              />
            ) : view === 'docs' ? (
              <section className="documents-panel">
                <div className="documents-list">
                  <h3>
                    仓库文档 <span>{repo.documents.length}</span>
                  </h3>
                  {repo.documents.map((d) => (
                    <button
                      key={d.path}
                      className={d.path === docPath ? 'chosen' : ''}
                      onClick={() => setDocPath(d.path)}
                    >
                      <BookOpen size={16} />
                      {d.path}
                    </button>
                  ))}
                  {!repo.documents.length && <p>没有找到可读取的文档。</p>}
                </div>
                <article className="document-content">
                  <div className="code-header">
                    <BookOpen size={15} />
                    {docPath || '选择一份文档'}
                    <span>扫描快照 · 原文</span>
                  </div>
                  <pre>{source}</pre>
                </article>
              </section>
            ) : (
              <section className="explorer">
                <div className="explorer-toolbar">
                  <div className="tab-title">
                    <Network size={17} />
                    <strong>{view === 'flow' ? '代码证据' : '模块依赖'}</strong>
                    <span>{visibleNodes.length} 个节点</span>
                  </div>
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="搜索节点"
                      placeholder="搜索函数、路径或文件…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button aria-label="清除搜索" onClick={() => setQuery('')}>
                        <X size={14} />
                      </button>
                    )}
                  </label>
                </div>
                {view === 'flow' && (
                  <div className="trace-toolbar">
                    <span>
                      <GitBranch size={15} />
                      路径追踪
                    </span>
                    <select
                      aria-label="路径起点"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    >
                      <option value="">选择起点</option>
                      {allNodes.map((n) => (
                        <option value={n.id} key={n.id}>
                          {n.name} · {n.file}
                        </option>
                      ))}
                    </select>
                    <ArrowRight size={15} />
                    <select
                      aria-label="路径终点"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    >
                      <option value="">选择终点</option>
                      {allNodes.map((n) => (
                        <option value={n.id} key={n.id}>
                          {n.name} · {n.file}
                        </option>
                      ))}
                    </select>
                    <button className="trace-button" disabled={!start || !end} onClick={findPath}>
                      查找路径
                    </button>
                    {trace.length > 0 && (
                      <button
                        className="play-button"
                        aria-label={playing ? '暂停路径播放' : '播放路径'}
                        onClick={() => {
                          if (!playing) setStep(-1);
                          setPlaying(!playing);
                        }}
                      >
                        {playing ? <Pause size={15} /> : <Play size={15} />}
                      </button>
                    )}
                  </div>
                )}
                {traceMessage && <div className="trace-message">{traceMessage}</div>}
                {trace.length > 0 && (
                  <div className="path-strip">
                    <span>调用路径</span>
                    {trace.map((id, i) => (
                      <button
                        key={id}
                        className={step === i ? 'step-active' : ''}
                        onClick={() => {
                          setStep(i);
                          selectNode(id);
                        }}
                      >
                        {i + 1}. {repo.nodes.find((n) => n.id === id)?.name}
                        {i < trace.length - 1 && <ChevronRight size={12} />}
                      </button>
                    ))}
                    <button
                      className="path-clear"
                      aria-label="清除路径"
                      onClick={() => {
                        setTrace([]);
                        setPlaying(false);
                        setStep(-1);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="explorer-body">
                  <Graph
                    nodes={visibleNodes}
                    edges={visibleEdges}
                    selected={selected}
                    path={trace}
                    activeStep={step}
                    labels={labels}
                    onSelect={selectNode}
                    onEdge={(e) => {
                      setSelectedEdge(e);
                      setSelected(e.source);
                    }}
                  />
                  <aside className="inspector">
                    <div className="inspector-heading">
                      <span>
                        <Code2 size={16} />
                        代码依据
                      </span>
                      <span className="subtle-label">SNAPSHOT</span>
                    </div>
                    {node ? (
                      <>
                        <div className="node-details">
                          <span className={`kind-badge ${node.kind}`}>
                            {selectedEdge
                              ? relationNames[selectedEdge.kind]
                              : node.kind.toUpperCase()}
                          </span>
                          <h2>
                            {selectedEdge
                              ? `${repo.nodes.find((n) => n.id === selectedEdge.source)?.name} → ${repo.nodes.find((n) => n.id === selectedEdge.target)?.name}`
                              : (labels.get(node.id) ?? node.name)}
                          </h2>
                          <p className="file-location">
                            {selectedEdge?.file ?? node.file}:{selectedEdge?.line ?? node.line}
                          </p>
                          <code>{selectedEdge?.expression ?? node.signature}</code>
                        </div>
                        <div className="source-preview">
                          <div className="code-header">
                            源代码 <span>扫描时的文件内容</span>
                          </div>
                          <pre>
                            {source
                              .split('\n')
                              .slice(
                                Math.max(0, (selectedEdge?.line ?? node.line) - 3),
                                Math.min(
                                  source.split('\n').length,
                                  selectedEdge
                                    ? selectedEdge.line + 4
                                    : Math.min(node.endLine + 1, node.line + 20),
                                ),
                              )
                              .map((line, i) => {
                                const num =
                                  Math.max(0, (selectedEdge?.line ?? node.line) - 3) + i + 1;
                                return (
                                  <div
                                    key={num}
                                    className={
                                      num === (selectedEdge?.line ?? node.line)
                                        ? 'highlight-line'
                                        : ''
                                    }
                                  >
                                    <span>{num}</span>
                                    {line || ' '}
                                  </div>
                                );
                              })}
                          </pre>
                        </div>
                        <div className="connections">
                          <h4>
                            关联关系 <span>{related.length}</span>
                          </h4>
                          {related.slice(0, 12).map((e) => (
                            <button
                              key={e.id}
                              onClick={() =>
                                selectNode(e.source === selected ? e.target : e.source)
                              }
                            >
                              <span className={e.source === selected ? 'outgoing' : 'incoming'}>
                                {e.source === selected ? '→' : '←'}
                              </span>
                              <span>
                                {
                                  repo.nodes.find(
                                    (n) => n.id === (e.source === selected ? e.target : e.source),
                                  )?.name
                                }
                              </span>
                              <ChevronRight size={12} />
                            </button>
                          ))}
                        </div>
                        <div className="ai-section">
                          <h4>
                            <Sparkles size={15} />
                            业务解读 <span>AI</span>
                          </h4>
                          <p>依据代码与文档，以{languageNames[language]}解读所选节点及邻近关系。</p>
                          <button
                            className="ai-button"
                            disabled={explaining || language === 'unknown'}
                            onClick={() => void generate()}
                          >
                            {explaining ? (
                              <Loader2 size={15} className="spin" />
                            ) : (
                              <Sparkles size={15} />
                            )}{' '}
                            {explaining ? '正在解读…' : '生成 AI 解读'}
                          </button>
                          <small>将相关代码片段与文档发送到已配置的模型服务。</small>
                        </div>
                      </>
                    ) : (
                      <div className="inspector-empty">
                        <Code2 size={31} />
                        <h3>从一个节点开始</h3>
                        <p>点击图中的函数或连线，查看源代码、调用关系与业务解读。</p>
                        <div>
                          每一条关系
                          <br />
                          都能回到代码。
                        </div>
                      </div>
                    )}
                  </aside>
                </div>
                <div className="graph-footer">
                  <span>
                    显示 {visibleNodes.length} / {allNodes.length} 个节点
                    {allNodes.length > 140 ? ' · 大图按模块筛选，最多显示 140 个节点' : ''}
                  </span>
                  <span>静态调用图 · 非运行时数据追踪</span>
                </div>
              </section>
            )}
            {view !== 'business' && explanation && (
              <section className="explanation-panel">
                <h3>
                  <Sparkles size={18} />
                  AI 业务解读{' '}
                  <span>
                    {explanation.model} · {languageNames[explanation.language]}
                  </span>
                  <button aria-label="关闭解读" onClick={() => setExplanation(null)}>
                    <X size={16} />
                  </button>
                </h3>
                <p>{explanation.summary}</p>
                <div className="explanation-nodes">
                  {explanation.nodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setView('flow');
                        setModule('');
                        setQuery('');
                        selectNode(n.id);
                      }}
                    >
                      <strong>{n.label}</strong>
                      <p>{n.description}</p>
                      <small>
                        依据：
                        {n.evidence
                          .map((id) => repo.nodes.find((n) => n.id === id)?.name)
                          .join('、')}
                      </small>
                    </button>
                  ))}
                </div>
                {explanation.caveats.map((c, i) => (
                  <p className="caveat" key={i}>
                    {c}
                  </p>
                ))}
                <small>模型生成的解释，引用有效不代表语义已经人工核验。</small>
              </section>
            )}
            <details className="analysis-notes">
              <summary>
                <AlertCircle size={14} />
                分析范围与限制 <span>{repo.warnings.length}</span>
              </summary>
              {repo.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          </>
        )}
        <footer className="page-footer">
          <span>
            <Terminal size={13} />
            本地分析 · 可追溯证据
          </span>
          <span>让复杂的代码，变得可以探索。</span>
        </footer>
      </main>
      {importOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setImportOpen(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-label="连接本地仓库">
            <button
              className="modal-close"
              aria-label="关闭连接窗口"
              onClick={() => setImportOpen(false)}
            >
              <X size={19} />
            </button>
            <div className="modal-icon">
              <Folder size={25} />
            </div>
            <h2>连接本地仓库</h2>
            <p>读取本机目录，生成代码关系图谱。不会执行或修改目标仓库的代码。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void scan(root);
              }}
            >
              <label>
                仓库绝对路径
                <input
                  autoFocus
                  placeholder="/Users/you/projects/my-repo"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                  required
                />
              </label>
              <div className="form-note">
                支持 .ts / .tsx / .js / .jsx 等文件；遵循 .gitignore，跳过隐藏目录、依赖和构建产物。
              </div>
              <button className="primary full" disabled={busy || !root.trim()}>
                {busy ? <Loader2 size={16} className="spin" /> : <Network size={16} />}{' '}
                {busy ? job.message : '开始扫描'}
              </button>
            </form>
            <button
              className="example-link"
              disabled={busy}
              onClick={() => {
                setRoot(defaults.examplePath);
                void scan(defaults.examplePath);
              }}
            >
              或扫描随附的订单示例 <ArrowRight size={15} />
            </button>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="模型设置">
            <button
              className="modal-close"
              aria-label="关闭模型设置"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={19} />
            </button>
            <div className="modal-icon">
              <Sparkles size={25} />
            </div>
            <h2>连接你的模型</h2>
            <p>
              第一版支持兼容 Chat Completions 的 API，包括本地 Ollama
              的兼容接口。模型仅用于主动生成业务解读。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                void api('/api/settings', { baseUrl, model, ...(apiKey ? { apiKey } : {}) })
                  .then(() => {
                    setHasKey(hasKey || !!apiKey);
                    setApiKey('');
                    setSettingsSaved(true);
                    setSettingsVersion((v) => v + 1);
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              <label>
                API Base URL
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setSettingsSaved(false);
                  }}
                  required
                  placeholder="http://127.0.0.1:11434/v1"
                />
              </label>
              <label>
                模型名称
                <input
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setSettingsSaved(false);
                  }}
                  required
                  placeholder="填写服务中可用的模型名称"
                />
              </label>
              <label>
                API Key <span>本地服务可留空</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setSettingsSaved(false);
                  }}
                  placeholder={hasKey ? '已配置 · 留空保留' : '可选'}
                />
              </label>
              <div className="form-note">
                设置仅在本次服务进程中保留。持久配置请使用 README 中的环境变量。
              </div>
              <button className="primary full">
                {settingsSaved ? <Check size={16} /> : <Settings2 size={16} />}{' '}
                {settingsSaved ? '配置已保存，尚未调用模型' : '保存模型配置'}
              </button>
            </form>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
