import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import ignore from 'ignore';
import { detectLanguage } from './language';
import type { Snapshot, SourceFile, CodeNode, CodeEdge } from '../shared/types';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const skip = new Set([
  '.git',
  '.codescope',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
]);
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const astCache = new Map<string, { hash: string; ast: ts.SourceFile }>();
export async function scanRepository(
  input: string,
  previous?: Snapshot,
  progress = (_: string) => {},
): Promise<Snapshot> {
  if (!input || !path.isAbsolute(input)) throw new Error('请输入本地仓库的绝对路径。');
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('仓库路径必须是目录。');
  const files: SourceFile[] = [],
    documents: SourceFile[] = [],
    warnings: string[] = [];
  let unsupported = 0,
    visited = 0,
    totalBytes = 0;
  async function walk(dir: string, rules: { base: string; matcher: ReturnType<typeof ignore> }[]) {
    const relDir = path.relative(root, dir).split(path.sep).join('/');
    const localIgnore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8').catch(() => '');
    if (localIgnore) rules = [...rules, { base: relDir, matcher: ignore().add(localIgnore) }];
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (++visited > 30000)
        throw new Error('目录条目超过 30,000；请选择更小的目录或补充 .gitignore。');
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name),
        rel = path.relative(root, absolute).split(path.sep).join('/');
      if (
        rules.some((r) =>
          r.matcher.ignores(
            (r.base ? rel.slice(r.base.length + 1) : rel) + (entry.isDirectory() ? '/' : ''),
          ),
        )
      )
        continue;
      if (entry.isDirectory()) {
        await walk(absolute, rules);
        continue;
      }
      if (!entry.isFile()) continue;
      const isSource = sourcePattern.test(rel) && !/\.d\.[cm]?ts$/.test(rel);
      const isDoc = /\.(md|mdx|rst|txt)$/i.test(rel) && !/(license|lock)/i.test(entry.name);
      if (!isSource && !isDoc) {
        if (/\.(py|go|rs|java|cs|vue)$/.test(rel)) unsupported++;
        continue;
      }
      const stat = await fs.stat(absolute);
      if (stat.size > 512_000) {
        warnings.push(`${rel}: 超过 500 KB，已跳过。`);
        continue;
      }
      totalBytes += stat.size;
      if (files.length + documents.length >= 4000 || totalBytes > 30_000_000)
        throw new Error('第一版单次扫描上限为 4,000 个文件、30 MB 文本；请选择子目录。');
      const text = await fs.readFile(absolute, 'utf8');
      if (text.includes('\0')) continue;
      (isSource ? files : documents).push({ path: rel, text, hash: hash(text) });
    }
  }
  progress('读取代码和文档');
  await walk(root, []);
  if (unsupported)
    warnings.push(
      `${unsupported} 个其他语言文件尚未分析。当前分析器支持 TypeScript / JavaScript。`,
    );
  warnings.push(
    '第一版未读取 tsconfig 路径别名或第三方类型声明；动态分派、回调传递、复杂框架注入可能无法解析。',
  );
  warnings.push(
    '当前连线表示静态调用、模块引用或路由绑定，不代表字段级数据流，也不代表实际执行顺序。',
  );
  const old = new Map(
    (previous?.root === root ? [...previous.files, ...previous.documents] : []).map((f) => [
      f.path,
      f.hash,
    ]),
  );
  const all = [...files, ...documents],
    current = new Map(all.map((f) => [f.path, f.hash]));
  const changes = {
    added: all.filter((f) => !old.has(f.path)).map((f) => f.path),
    modified: all.filter((f) => old.has(f.path) && old.get(f.path) !== f.hash).map((f) => f.path),
    deleted: [...old.keys()].filter((p) => !current.has(p)),
    reused: 0,
    parsed: 0,
  };
  const fingerprint = hash(all.map((f) => `${f.path}:${f.hash}`).join('\n'));
  if (previous?.root === root && previous.fingerprint === fingerprint)
    return {
      ...previous,
      scannedAt: new Date().toISOString(),
      changes: { ...changes, reused: files.length },
    };
  progress('解析符号与跨文件调用');
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noEmit: true,
  };
  const sources = new Map(files.map((f) => [path.join(root, f.path), f]));
  const host = ts.createCompilerHost(options);
  host.fileExists = (name) => sources.has(path.resolve(name));
  host.readFile = (name) => sources.get(path.resolve(name))?.text;
  host.directoryExists = (name) =>
    [...sources.keys()].some((p) => p.startsWith(path.resolve(name) + path.sep));
  host.getCurrentDirectory = () => root;
  host.getSourceFile = (name, languageVersion) => {
    const f = sources.get(path.resolve(name));
    if (!f) return undefined;
    const key = path.resolve(name),
      existing = astCache.get(key);
    if (existing?.hash === f.hash) {
      changes.reused++;
      return existing.ast;
    }
    changes.parsed++;
    const ast = ts.createSourceFile(name, f.text, languageVersion, true);
    astCache.set(key, { hash: f.hash, ast });
    return ast;
  };
  // No repository code, plugins, tsconfig extensions or package scripts are executed.
  const program = ts.createProgram([...sources.keys()], options, host),
    checker = program.getTypeChecker();
  const nodes: CodeNode[] = [],
    edges: CodeEdge[] = [],
    declarationIds = new Map<ts.Node, string>();
  const fileIds = new Map<string, string>(),
    duplicateNames = new Map<string, number>();
  const addEdge = (
    source: string,
    target: string,
    kind: CodeEdge['kind'],
    sf: ts.SourceFile,
    n: ts.Node,
  ) => {
    const file = path.relative(root, sf.fileName).split(path.sep).join('/'),
      line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const id = hash(`${source}:${target}:${kind}:${file}:${line}`).slice(0, 24);
    if (!edges.some((e) => e.id === id))
      edges.push({ id, source, target, kind, file, line, expression: n.getText(sf).slice(0, 240) });
  };
  for (const sf of program.getSourceFiles()) {
    const file = path.relative(root, sf.fileName).split(path.sep).join('/'),
      fileId = `file:${file}`;
    fileIds.set(sf.fileName, fileId);
    nodes.push({
      id: fileId,
      name: path.basename(file),
      kind: 'file',
      file,
      line: 1,
      endLine: sf.getLineAndCharacterOfPosition(sf.end).line + 1,
      module: path.dirname(file),
      signature: file,
    });
    const syntax = program.getSyntacticDiagnostics(sf);
    if (syntax.length) warnings.push(`${file}: ${syntax.length} 个语法诊断，关系可能不完整。`);
    const visit = (n: ts.Node, scope: string[]) => {
      let name: string | undefined,
        kind: CodeNode['kind'] = 'function';
      if (ts.isFunctionDeclaration(n) && n.name) name = n.name.text;
      else if (ts.isMethodDeclaration(n) && n.name) {
        name = n.name.getText(sf);
        kind = 'method';
      } else if (
        (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
        ts.isVariableDeclaration(n.parent)
      )
        name = n.parent.name.getText(sf);
      else if (
        (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
        ts.isPropertyAssignment(n.parent)
      )
        name = n.parent.name.getText(sf);
      else if (ts.isArrowFunction(n) || ts.isFunctionExpression(n))
        name = `callback@${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      if (name) {
        const base = `symbol:${file}:${[...scope, name].join('.')}`,
          count = duplicateNames.get(base) ?? 0;
        duplicateNames.set(base, count + 1);
        const id = count ? `${base}#${count}` : base;
        declarationIds.set(n, id);
        if (ts.isVariableDeclaration(n.parent) || ts.isPropertyAssignment(n.parent))
          declarationIds.set(n.parent, id);
        nodes.push({
          id,
          name: [...scope, name].join('.'),
          kind,
          file,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(n.end).line + 1,
          module: path.dirname(file),
          signature: n.getText(sf).split(/\{|=>/)[0].trim().slice(0, 180),
        });
        scope = [...scope, name];
      } else if (ts.isClassDeclaration(n) && n.name) scope = [...scope, n.name.text];
      ts.forEachChild(n, (child) => visit(child, scope));
    };
    visit(sf, []);
  }
  const resolveSymbol = (n: ts.Node): string | undefined => {
    let symbol = checker.getSymbolAtLocation(n);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const d of symbol?.declarations ?? []) {
      const id = declarationIds.get(d);
      if (id) return id;
    }
    return undefined;
  };
  let unresolvedCalls = 0;
  for (const sf of program.getSourceFiles()) {
    const visit = (n: ts.Node, owner: string) => {
      owner = declarationIds.get(n) ?? owner;
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const resolved = ts.resolveModuleName(
          n.moduleSpecifier.text,
          sf.fileName,
          options,
          host,
        ).resolvedModule;
        const target = resolved && fileIds.get(resolved.resolvedFileName);
        if (target) addEdge(fileIds.get(sf.fileName)!, target, 'imports', sf, n);
      }
      if (ts.isCallExpression(n)) {
        let target: string | undefined;
        const signature = checker.getResolvedSignature(n),
          declaration = signature?.declaration;
        if (declaration) target = declarationIds.get(declaration);
        target ??= resolveSymbol(
          ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression,
        );
        if (target) addEdge(owner, target, 'calls', sf, n);
        else unresolvedCalls++;
        // Conservative route candidates: named router/app receiver and literal path.
        if (
          ts.isPropertyAccessExpression(n.expression) &&
          /^(app|router|server)$/.test(n.expression.expression.getText(sf)) &&
          /^(get|post|put|patch|delete)$/.test(n.expression.name.text) &&
          n.arguments[0] &&
          ts.isStringLiteral(n.arguments[0])
        ) {
          const last = n.arguments[n.arguments.length - 1],
            handler = declarationIds.get(last) ?? resolveSymbol(last);
          if (handler) {
            const file = path.relative(root, sf.fileName).split(path.sep).join('/'),
              line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
            const id = `route:${file}:${line}`,
              name = `${n.expression.name.text.toUpperCase()} ${n.arguments[0].text}`;
            nodes.push({
              id,
              name,
              kind: 'route',
              file,
              line,
              endLine: sf.getLineAndCharacterOfPosition(n.end).line + 1,
              module: path.dirname(file),
              signature: name,
            });
            addEdge(id, handler, 'handles', sf, n);
          }
        }
      }
      ts.forEachChild(n, (child) => visit(child, owner));
    };
    visit(sf, fileIds.get(sf.fileName)!);
  }
  if (unresolvedCalls)
    warnings.push(
      `${unresolvedCalls} 个调用未解析到仓库内符号（可能是外部库、动态调用或不支持的语法），未生成猜测连线。`,
    );
  if (nodes.some((n) => n.kind === 'route'))
    warnings.push('路由绑定根据 app/router/server 的字面量注册形式识别，属于框架启发式候选。');
  for (const key of astCache.keys()) if (!sources.has(key)) astCache.delete(key);
  progress('保存图谱与文档语言判断');
  return {
    id: hash(root).slice(0, 20),
    root,
    name: path.basename(root),
    scannedAt: new Date().toISOString(),
    fingerprint,
    language: detectLanguage(documents),
    nodes,
    edges,
    files,
    documents,
    warnings,
    changes,
    analysis: { unresolvedCalls, sourceCount: files.length },
  };
}
