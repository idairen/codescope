import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { knowledgeKey, generateKnowledge } from './knowledge';
import { businessEntries, businessKey, generateBusinessFlow } from './business';
import { explain, explanationKey, validateSettings, type ModelSettings } from './llm';
import type { Snapshot, PublicSnapshot, ScanJob, Language } from '../shared/types';
export function createApplication(options: {
  base: string;
  port: number;
  dataDir: string;
  modelFetch?: typeof fetch;
  fallback?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}) {
  const { base, port } = options;
  const store = new Store(options.dataDir);
  let settings: ModelSettings = {
    baseUrl: process.env.CODESCOPE_LLM_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    model: process.env.CODESCOPE_LLM_MODEL ?? '',
    apiKey: process.env.CODESCOPE_LLM_API_KEY ?? '',
  };
  const jobs = new Map<string, ScanJob>();
  let active: ScanJob | undefined;
  let worker: ChildProcess | undefined;
  let explaining = false;
  function publicSnapshot(s: Snapshot): PublicSnapshot {
    return {
      ...s,
      files: s.files.map(({ text, ...rest }) => rest),
      documents: s.documents.map(({ text, ...rest }) => rest),
    };
  }
  function getWorker() {
    if (worker?.connected) return worker;
    worker = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    worker.on('message', (m: { type: string; text: string; snapshot?: Snapshot }) => {
      if (!active) return;
      if (m.type === 'progress') active.message = m.text;
      if (m.type === 'done' && m.snapshot) {
        try {
          store.save(m.snapshot);
          active.state = 'done';
          active.snapshotId = m.snapshot.id;
          active.message = '扫描完成';
        } catch {
          active.state = 'error';
          active.message = '保存扫描结果失败。';
        }
        active = undefined;
      }
      if (m.type === 'error' && active) {
        active.state = 'error';
        active.message = m.text;
        active = undefined;
      }
    });
    worker.on('exit', () => {
      if (active) {
        active.state = 'error';
        active.message = '扫描进程退出；上次成功图谱仍保留。';
        active = undefined;
      }
      worker = undefined;
    });
    return worker;
  }
  async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 128000) throw new Error('请求过大。');
      chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('请求必须为 JSON 对象。');
    return parsed;
  }
  const send = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) {
      if (options.fallback) options.fallback(req, res);
      else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }
    // Loopback host + same-origin checks prevent a remote page from triggering local scans.
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (
      !hosts.includes(req.headers.host ?? '') ||
      (req.headers.origin && !hosts.some((h) => req.headers.origin === `http://${h}`)) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      send(res, 403, { error: '仅允许本机同源请求。' });
      return;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/repositories') {
        send(res, 200, store.list().map(publicSnapshot));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/defaults') {
        send(res, 200, {
          examplePath: path.join(base, 'examples/order-service'),
          workspacePath: base,
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/settings') {
        send(res, 200, {
          baseUrl: settings.baseUrl,
          model: settings.model,
          hasKey: !!settings.apiKey,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const b = await body(req);
        const nextUrl = String(b.baseUrl ?? '');
        settings = validateSettings({
          baseUrl: nextUrl,
          model: String(b.model ?? ''),
          apiKey:
            typeof b.apiKey === 'string'
              ? b.apiKey
              : nextUrl.replace(/\/+$/, '') === settings.baseUrl
                ? settings.apiKey
                : '',
        });
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/scan') {
        if (active) {
          send(res, 409, { error: '已有扫描正在进行。' });
          return;
        }
        const b = await body(req),
          input = String(b.root ?? '');
        if (!path.isAbsolute(input)) throw new Error('请输入本地仓库的绝对路径。');
        const root = await fs.realpath(input);
        if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择目录。');
        const previous = store.list().find((s) => s.root === root);
        const job: ScanJob = { id: randomUUID(), state: 'running', message: '准备扫描' };
        jobs.set(job.id, job);
        active = job;
        while (jobs.size > 50) jobs.delete(jobs.keys().next().value!);
        getWorker().send({ root, previous });
        send(res, 202, job);
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const job = jobs.get(url.pathname.split('/').pop()!);
        send(res, job ? 200 : 404, job ?? { error: '扫描任务不存在。' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/source') {
        const snapshot = store.get(url.searchParams.get('repo') ?? ''),
          file = [...(snapshot?.files ?? []), ...(snapshot?.documents ?? [])].find(
            (f) => f.path === url.searchParams.get('file'),
          );
        send(res, file ? 200 : 404, file ?? { error: '文件不在扫描快照中。' });
        return;
      }
      if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/knowledge') {
        const b = req.method === 'POST' ? await body(req) : Object.fromEntries(url.searchParams);
        const snapshot = store.get(String(b.repo ?? ''));
        if (!snapshot) throw new Error('请先扫描仓库。');
        const language = String(b.language ?? snapshot.language.code) as Language;
        if (!['zh', 'en', 'ja', 'ko', 'ru', 'unknown'].includes(language))
          throw new Error('请选择解释语言。');
        const key = knowledgeKey(snapshot, language, settings),
          cached = store.getKnowledge(key);
        if (req.method === 'GET') {
          send(res, 200, { graph: cached ?? null, configured: !!settings.model });
          return;
        }
        if (cached && !b.refresh) {
          send(res, 200, cached);
          return;
        }
        if (explaining) {
          send(res, 409, { error: '已有解读任务，请等待完成。' });
          return;
        }
        explaining = true;
        try {
          const result = await generateKnowledge(
            snapshot,
            language,
            { ...settings },
            options.modelFetch,
          );
          store.saveKnowledge(key, result);
          send(res, 200, result);
        } finally {
          explaining = false;
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/business') {
        const snapshot = store.get(url.searchParams.get('repo') ?? '');
        if (!snapshot) throw new Error('请先扫描仓库。');
        const language = (url.searchParams.get('language') ?? snapshot.language.code) as Language;
        const entries = businessEntries(snapshot);
        const flows = entries
          .map((e) => store.getBusinessFlow(businessKey(snapshot, e.id, language, settings)))
          .filter(Boolean);
        send(res, 200, { entries, flows, configured: !!settings.model });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/business') {
        const b = await body(req),
          snapshot = store.get(String(b.repo ?? ''));
        if (!snapshot) throw new Error('请先扫描仓库。');
        const language = String(b.language ?? snapshot.language.code) as Language;
        if (!['zh', 'en', 'ja', 'ko', 'ru'].includes(language)) throw new Error('请选择解释语言。');
        const entryId = String(b.entryId ?? ''),
          key = businessKey(snapshot, entryId, language, settings),
          cached = store.getBusinessFlow(key);
        if (cached && !b.refresh) {
          send(res, 200, cached);
          return;
        }
        if (explaining) {
          send(res, 409, { error: '已有业务解读正在进行。' });
          return;
        }
        explaining = true;
        try {
          const result = await generateBusinessFlow(
            snapshot,
            entryId,
            language,
            { ...settings },
            options.modelFetch,
          );
          store.saveBusinessFlow(key, result);
          send(res, 200, result);
        } finally {
          explaining = false;
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/explain') {
        const b = await body(req),
          snapshot = store.get(String(b.repo ?? ''));
        if (!snapshot) throw new Error('请先扫描仓库。');
        const language = String(b.language ?? snapshot.language.code) as Language;
        if (!['zh', 'en', 'ja', 'ko', 'ru'].includes(language)) throw new Error('请选择解释语言。');
        const nodeId = String(b.nodeId ?? ''),
          key = explanationKey(snapshot, nodeId, language, settings),
          cached = store.getExplanation(key);
        if (cached) {
          send(res, 200, cached);
          return;
        }
        if (explaining) {
          send(res, 409, { error: '已有解读任务，请等待完成。' });
          return;
        }
        explaining = true;
        try {
          const result = await explain(snapshot, nodeId, language, settings);
          store.saveExplanation(key, result);
          send(res, 200, result);
        } finally {
          explaining = false;
        }
        return;
      }
      send(res, 404, { error: '接口不存在。' });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : '操作失败' });
    }
  };
  return {
    handler,
    close: () => {
      worker?.kill();
      store.close();
    },
  };
}
