import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'skills/business-flow/scripts/flow.py'
spec = importlib.util.spec_from_file_location('flow', SCRIPT)
flow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flow)


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / 'source.py').write_text('def save():\n    return 1\n')
        self.ref = {'path': 'source.py', 'startLine': 1, 'endLine': 2}
        self.graph = {'version': 1, 'title': 'Example', 'scope': 'source.py',
                      'limitations': ['Static only'], 'questions': [],
                      'nodes': [dict(id='save', label='Save', kind='process', summary='Save data', core=True,
                                     inputs=[], outputs=[], states=[], evidence=[self.ref])], 'edges': []}

    def test_valid_graph_and_stale_snapshot(self):
        self.graph['sourceHashes'] = flow.validate(self.graph, self.repo)
        flow.validate(self.graph, self.repo)
        (self.repo / 'source.py').write_text('def save():\n    return 2\n')
        with self.assertRaisesRegex(ValueError, 'hashes changed'):
            flow.validate(self.graph, self.repo)

    def test_missing_and_out_of_range_evidence(self):
        for path, end in [('absent.py', 1), ('source.py', 999)]:
            self.ref.update(path=path, endLine=end)
            with self.assertRaises(ValueError):
                flow.validate(self.graph, self.repo)

    def test_paths_cannot_escape_or_follow_symlinks(self):
        (self.repo / 'link.py').symlink_to(self.repo / 'source.py')
        for path in ['../source.py', '/etc/passwd', 'link.py', 'C:\\private.txt']:
            self.ref['path'] = path
            with self.assertRaises(ValueError):
                flow.validate(self.graph, self.repo)

    def test_duplicate_node_and_unknown_endpoint(self):
        self.graph['nodes'].append(copy.deepcopy(self.graph['nodes'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            flow.validate(self.graph, self.repo)
        self.graph['nodes'].pop()
        self.graph['edges'] = [dict(id='bad', source='save', target='missing', label='write', reason='test', status='supported', evidence=[self.ref])]
        with self.assertRaisesRegex(ValueError, 'Unknown endpoint'):
            flow.validate(self.graph, self.repo)

    def test_empty_evidence_and_invalid_status_rejected(self):
        edge = dict(id='loop', source='save', target='save', label='retry', reason='test', status='inferred', evidence=[self.ref])
        self.graph['edges'] = [edge]
        flow.validate(self.graph, self.repo)
        edge['status'] = 'proven'
        with self.assertRaisesRegex(ValueError, 'status'):
            flow.validate(self.graph, self.repo)
        edge['status'], edge['evidence'] = 'supported', []
        with self.assertRaisesRegex(ValueError, 'requires evidence'):
            flow.validate(self.graph, self.repo)

    def test_inventory_excludes_hidden_dependency_and_sensitive_names(self):
        for name in ['.env.json', 'credentials.json', 'node_modules/index.js', 'dist/code.ts', '.business-flow/output.json']:
            file = self.repo / name
            file.parent.mkdir(exist_ok=True)
            file.write_text('{}')
        self.assertEqual(flow.inventory(self.repo)['files'], ['source.py'])

    def test_render_escapes_script_injection_and_preserves_old_on_failure(self):
        self.graph['title'] = '</script><script>alert(1)</script>'
        input_file, output = self.repo / 'graph.json', self.repo / 'report.html'
        input_file.write_text(json.dumps(self.graph))
        args = ['python3', str(SCRIPT), 'render', str(input_file), '--repo', str(self.repo), '--out', str(output)]
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        html = output.read_text()
        self.assertNotIn(self.graph['title'], html)
        self.assertIn('\\u003c/script', html)
        self.assertNotIn('__GRAPH_JSON__', html)
        self.assertNotIn('/*__VIEWER__*/', html)
        snapshot = json.loads(output.with_suffix('.snapshot.json').read_text())
        self.assertIn('source.py', snapshot['sourceHashes'])
        self.ref['endLine'] = 1000
        input_file.write_text(json.dumps(self.graph))
        self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
        self.assertEqual(output.read_text(), html)

    def test_detail_contract_rejects_bad_ownership_and_incomplete_rules(self):
        graph = json.loads((ROOT / 'docs/business-flow/order-service.json').read_text())
        repo = ROOT / 'examples/order-service'
        for mutate, message in [
            (lambda g: next(n for n in g['nodes'] if n['id'] == 'rule-sku').update(parentId='orders'), 'parent'),
            (lambda g: next(n for n in g['nodes'] if n['id'] == 'rule-sku').update(core=True), 'core'),
            (lambda g: next(n for n in g['nodes'] if n['id'] == 'rule-sku')['rule'].pop('onFail'), 'onFail'),
            (lambda g: g['edges'].remove(next(e for e in g['edges'] if e['id'] == 'rule-sku-fail')), 'branches'),
            (lambda g: next(e for e in g['edges'] if e['id'] == 'rule-sku-pass').update(flow='data'), 'branch'),
            (lambda g: next(e for e in g['edges'] if e['id'] == 'detail-validation').update(view='both'), 'detail view'),
        ]:
            with self.subTest(message=message):
                changed = copy.deepcopy(graph)
                mutate(changed)
                with self.assertRaisesRegex(ValueError, message):
                    flow.validate(changed, repo)

    def test_actual_order_example(self):
        graph = json.loads((ROOT / 'docs/business-flow/order-service.json').read_text())
        self.assertEqual(len(flow.validate(graph, ROOT / 'examples/order-service')), 5)


if __name__ == '__main__':
    unittest.main()
