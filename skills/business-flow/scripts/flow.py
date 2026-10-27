#!/usr/bin/env python3
"""Portable inventory, graph validation and offline report rendering (stdlib only)."""
import argparse
import hashlib
from html import escape
import json
import os
import re
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

SKIP = {'node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'target', 'venv'}
EXTENSIONS = {'.md', '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.sql', '.prisma', '.graphql', '.yml', '.yaml', '.toml', '.json', '.kt', '.vue', '.svelte', '.c', '.cpp', '.h'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def safe_path(repo, name):
    repo = repo.resolve()
    require(isinstance(name, str) and bool(name), 'Evidence path must be a string')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name, f'Unsafe path: {name}')
    current = repo
    for part in p.parts:
        current = current / part
        require(not current.is_symlink(), f'Symlink evidence is not allowed: {name}')
    require(current.resolve().is_relative_to(repo), f'Path outside repository: {name}')
    require(current.is_file(), f'Missing source: {name}')
    return current


def strings(value, field):
    require(isinstance(value, list) and all(isinstance(x, str) for x in value), f'{field} must be a string array')


def resolve_ui(graph):
    catalogs = json.loads((Path(__file__).resolve().parent.parent / 'assets/locales.json').read_text(encoding='utf-8'))
    language = graph.get('language')
    # Compatibility for old Chinese reports only; new analyses must record a language decision.
    code = language['code'] if language else 'zh-CN'
    builtin = 'en' if code.lower().split('-')[0] == 'en' else 'zh-CN' if code.lower() in ('zh', 'zh-cn', 'zh-hans', 'zh-hans-cn') else None
    overrides = graph.get('ui', {})
    require(isinstance(overrides, dict), 'ui must be an object')
    require(all(k in catalogs['en'] and isinstance(v, str) and v.strip() for k, v in overrides.items()), 'Invalid UI translation key or value')
    if not builtin:
        require(set(overrides) == set(catalogs['en']), 'This language requires a complete UI translation catalog')
    ui = {**catalogs.get(builtin, {}), **overrides}
    for key, value in ui.items():
        placeholders = lambda text: set(re.findall(r'\{([a-zA-Z]+)\}', text))
        require(placeholders(value) == placeholders(catalogs['en'][key]), f'UI placeholders mismatch: {key}')
    return code, ui


def validate(graph, repo):
    require(isinstance(graph, dict), 'Graph must be an object')
    require(type(graph.get('version')) is int and graph['version'] == 1, 'Expected version 1')
    for field in ('title', 'scope'):
        require(isinstance(graph.get(field), str) and graph[field].strip(), f'Missing {field}')
    for field in ('limitations', 'questions'):
        strings(graph.get(field), field)
    nodes, edges = graph.get('nodes'), graph.get('edges')
    require(isinstance(nodes, list) and 1 <= len(nodes) <= 160, 'Expected 1–160 nodes')
    require(isinstance(edges, list) and len(edges) <= 400, 'Expected at most 400 edges')
    hashes, sources = {}, {}
    def check_refs(refs):
        require(isinstance(refs, list) and refs, "Impact requires evidence")
        for ref in refs:
            require(isinstance(ref, dict), 'Evidence must be an object')
            path = ref.get('path')
            file = safe_path(repo, path)
            if path not in sources:
                require(file.stat().st_size <= 2_000_000, f'Source too large: {path}')
                data = file.read_bytes()
                sources[path] = len(data.decode('utf-8').splitlines())
                hashes[path] = hashlib.sha256(data).hexdigest()
            start, end = ref.get('startLine'), ref.get('endLine')
            require(type(start) is int and type(end) is int and 1 <= start <= end <= sources[path], f'Invalid evidence lines: {path}')

    node_ids = set()
    for group, rows in (('node', nodes), ('edge', edges)):
        ids = set()
        for row in rows:
            require(isinstance(row, dict), f'{group} must be an object')
            for field in (('id', 'label', 'summary') if group == 'node' else ('id', 'source', 'target', 'label', 'reason')):
                require(isinstance(row.get(field), str) and row[field].strip(), f'{group}: missing {field}')
            require(row['id'] not in ids, f'Duplicate {group} ID: {row["id"]}')
            ids.add(row['id'])
            if group == 'node':
                node_ids.add(row['id'])
                require(row.get('kind') in ('actor', 'process', 'data', 'store', 'outcome', 'rule'), 'Invalid node kind')
                require(type(row.get('core')) is bool, 'core must be boolean')
                require(row.get('layer', 'business') in ('business', 'detail'), 'Invalid node layer')
                if row.get('layer') == 'detail':
                    require(not row['core'], 'Detail nodes cannot be core')
                    require(isinstance(row.get('parentId'), str) and row['parentId'], 'Detail node requires parentId')
                else:
                    require('parentId' not in row, 'Only detail nodes can have parentId')
                if row['kind'] == 'rule':
                    require(row.get('layer') == 'detail', 'Rule must be a detail node')
                    rule = row.get('rule')
                    require(isinstance(rule, dict), 'Rule requires structured condition')
                    for field in ('condition', 'onPass', 'onFail'):
                        require(isinstance(rule.get(field), str) and rule[field].strip(), f'Rule requires {field}')
                for field in ('inputs', 'outputs', 'states'):
                    strings(row.get(field), field)
            else:
                require(row['source'] in node_ids and row['target'] in node_ids, f'Unknown endpoint: {row["id"]}')
                require(row.get('status') in ('supported', 'inferred'), 'Invalid edge status')
                require(row.get('view', 'both') in ('overview', 'detail', 'both'), 'Invalid edge view')
                require(row.get('flow', 'data') in ('data', 'control'), 'Invalid edge flow')
                if 'branch' in row:
                    require(row['branch'] in ('pass', 'fail') and row.get('flow') == 'control', 'Invalid rule branch')
            refs = row.get('evidence')
            require(isinstance(refs, list) and refs, f'{group} {row["id"]} requires evidence')
            check_refs(refs)
    by_id = {n['id']: n for n in nodes}
    for node in nodes:
        if node.get('layer') == 'detail':
            parent = by_id.get(node['parentId'])
            require(parent is not None and parent.get('layer', 'business') == 'business' and parent['kind'] == 'process', 'Detail parent must be a business process')
        if node['kind'] == 'rule':
            branches = {e.get('branch') for e in edges if e['source'] == node['id'] and e.get('view') == 'detail'}
            require({'pass', 'fail'} <= branches, f'Rule {node["id"]} requires pass and fail branches')
    for edge in edges:
        if any(by_id[edge[k]].get('layer') == 'detail' for k in ('source', 'target')):
            require(edge.get('view') == 'detail', 'Edges involving detail nodes must use detail view')
        if 'branch' in edge:
            require(by_id[edge['source']]['kind'] == 'rule', 'Branch source must be a rule')
    require(any(n['core'] for n in nodes), 'At least one core node is required')
    impact = graph.get('impact')
    if impact is not None:
        require(isinstance(impact, dict), 'impact must be an object')
        require(impact.get('mode') in ('requirement', 'diff'), 'Invalid impact mode')
        for field in ('request', 'summary'):
            require(isinstance(impact.get(field), str) and impact[field].strip(), f'Impact requires {field}')
        for field in ('checks', 'limitations'):
            strings(impact.get(field), f'impact.{field}')
        if impact['mode'] == 'diff':
            comparison = impact.get('comparison')
            require(isinstance(comparison, dict), 'Diff impact requires comparison')
            for field in ('base', 'target'):
                require(isinstance(comparison.get(field), str) and comparison[field].strip(), f'Comparison requires {field}')
        edge_map = {e['id']: e for e in edges}
        impact_nodes = impact.get('nodes')
        impact_edges = impact.get('edges')
        require(isinstance(impact_nodes, list) and isinstance(impact_edges, list), 'Impact nodes/edges must be arrays')
        impacted = {}
        for item in impact_nodes:
            require(isinstance(item, dict), 'Impact node must be an object')
            id = item.get('id')
            require(isinstance(id, str) and id in by_id and id not in impacted, 'Unknown or duplicate impact node')
            require(item.get('level') in ('direct', 'indirect'), 'Invalid impact level')
            require(isinstance(item.get('reason'), str) and item['reason'].strip(), 'Impact reason required')
            strings(item.get('via'), 'impact.via')
            require(all(e in edge_map for e in item['via']), 'Unknown impact path edge')
            check_refs(item.get('evidence'))
            impacted[id] = item
        direct = {id for id, item in impacted.items() if item['level'] == 'direct'}
        for id, item in impacted.items():
            if item['level'] == 'direct':
                require(not item['via'], 'Direct impact cannot have a propagation path')
                continue
            require(item['via'], 'Indirect impact requires path')
            path = [edge_map[e] for e in item['via']]
            require(path[0]['source'] in direct and path[-1]['target'] == id and
                    all(a['target'] == b['source'] for a, b in zip(path, path[1:])), 'Impact path must connect a direct node to its target')
        seen = set()
        for item in impact_edges:
            require(isinstance(item, dict), 'Impact edge must be an object')
            id = item.get('id')
            require(isinstance(id, str) and id in edge_map and id not in seen, 'Unknown or duplicate impact edge')
            seen.add(id)
            require(isinstance(item.get('reason'), str) and item['reason'].strip(), 'Impact edge reason required')
            require(edge_map[id]['source'] in impacted and edge_map[id]['target'] in impacted, 'Impact edge endpoints must be analyzed')
            check_refs(item.get('evidence'))
    language = graph.get('language')
    if language is not None:
        require(isinstance(language, dict), 'language must be an object')
        require(isinstance(language.get('code'), str) and re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*', language['code']), 'Invalid language code')
        require(language.get('selection') in ('project', 'override', 'fallback'), 'Invalid language selection')
        require(isinstance(language.get('reason'), str) and language['reason'].strip(), 'Language rationale required')
        refs = language.get('evidence')
        require(isinstance(refs, list), 'Language evidence must be an array')
        if language['selection'] == 'project' or refs:
            check_refs(refs)
    resolve_ui(graph)
    recorded = graph.get('sourceHashes', {})
    require(isinstance(recorded, dict), 'sourceHashes must be an object')
    if recorded:
        require(recorded == hashes, 'Source hashes changed or incomplete; re-analyze current sources before rendering')
    return hashes


def inventory(repo):
    def allowed(path):
        p = PurePosixPath(path)
        return (not any(x.startswith('.') or x in SKIP for x in p.parts)
                and not any(x in p.name.lower() for x in ('secret', 'credential', 'lock', 'private-key'))
                and p.suffix.lower() in EXTENSIONS)
    try:
        result = subprocess.run(['git', '-C', str(repo), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], capture_output=True, check=True)
        paths = sorted(set(result.stdout.decode().split('\0')) - {''})
        mode = 'git tracked and unignored files'
    except (OSError, subprocess.CalledProcessError):
        paths = []
        for base, dirs, files in os.walk(repo, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in SKIP and not (Path(base) / d).is_symlink())
            for name in sorted(files):
                paths.append((Path(base) / name).relative_to(repo).as_posix())
            if len(paths) > 20000:
                break
        mode = 'filesystem fallback; .gitignore not interpreted; discovery capped at 20000 entries'
    files = []
    for p in paths:
        if not allowed(p):
            continue
        try:
            file = safe_path(repo, p)
            if file.stat().st_size <= 500_000:
                files.append(p)
        except ValueError:
            continue
    return {'mode': mode, 'files': files[:4000], 'truncated': len(files) > 4000 or len(paths) > 20000,
            'note': 'Filenames only, not semantic analysis. Hidden, dependency, generated and common sensitive paths excluded; inspect scope manually.'}


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as f:
            temp = Path(f.name)
            f.write(content)
        os.replace(temp, path)
    finally:
        if temp and temp.exists():
            temp.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inventory', 'validate', 'render'])
    parser.add_argument('graph', nargs='?')
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        require(repo.is_dir(), 'Repository does not exist')
        if args.command == 'inventory':
            print(json.dumps(inventory(repo), ensure_ascii=False, indent=2))
            return
        require(args.graph is not None, 'Graph JSON is required')
        graph = json.loads(Path(args.graph).read_text(encoding='utf-8'))
        hashes = validate(graph, repo)
        if args.command == 'render':
            require(args.out is not None and args.out.suffix.lower() == '.html', '--out must be an HTML path')
            graph['sourceHashes'] = hashes
            assets = Path(__file__).resolve().parent.parent / 'assets'
            code, graph['ui'] = resolve_ui(graph)
            payload = json.dumps(graph, ensure_ascii=False).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
            template = (assets / 'report.html').read_text(encoding='utf-8')
            template = re.sub(r'\{\{ui:([A-Za-z]+)\}\}', lambda match: escape(graph['ui'][match[1]], quote=True), template)
            html = template.replace('__REPORT_LANG__', escape(code, quote=True)).replace('/*__VIEWER__*/', (assets / 'viewer.js').read_text(encoding='utf-8')).replace('__GRAPH_JSON__', payload)
            atomic_write(args.out.with_suffix('.snapshot.json'), json.dumps(graph, ensure_ascii=False, indent=2) + '\n')
            atomic_write(args.out, html)
            print(f'Rendered {args.out}; snapshot {args.out.with_suffix(".snapshot.json")}')
        else:
            print(f'Valid: {len(graph["nodes"])} nodes, {len(graph["edges"])} edges, {len(hashes)} source files; semantics require review')
    except (ValueError, OSError, UnicodeError) as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
