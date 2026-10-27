export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'unknown';
export interface LanguageChoice {
  code: Language;
  evidence: string[];
  reason: string;
}
export interface CodeNode {
  id: string;
  name: string;
  kind: 'file' | 'function' | 'method' | 'route';
  file: string;
  line: number;
  endLine: number;
  module: string;
  signature: string;
}
export interface CodeEdge {
  id: string;
  source: string;
  target: string;
  kind: 'calls' | 'imports' | 'handles';
  file: string;
  line: number;
  expression: string;
}
export interface SourceFile {
  path: string;
  hash: string;
  text: string;
}
export interface Snapshot {
  id: string;
  root: string;
  name: string;
  scannedAt: string;
  fingerprint: string;
  language: LanguageChoice;
  nodes: CodeNode[];
  edges: CodeEdge[];
  files: SourceFile[];
  documents: SourceFile[];
  warnings: string[];
  changes: {
    added: string[];
    modified: string[];
    deleted: string[];
    reused: number;
    parsed: number;
  };
  analysis: { unresolvedCalls: number; sourceCount: number };
}
export type PublicSnapshot = Omit<Snapshot, 'files' | 'documents'> & {
  files: Omit<SourceFile, 'text'>[];
  documents: Omit<SourceFile, 'text'>[];
};
export interface Explanation {
  language: Language;
  summary: string;
  nodes: { id: string; label: string; description: string; evidence: string[] }[];
  caveats: string[];
  model: string;
  createdAt: string;
}
export interface ScanJob {
  id: string;
  state: 'running' | 'done' | 'error';
  message: string;
  snapshotId?: string;
}
export function directedPath(
  nodes: CodeNode[],
  edges: CodeEdge[],
  start: string,
  end: string,
): string[] {
  if (!nodes.some((n) => n.id === start) || !nodes.some((n) => n.id === end)) return [];
  const queue = [start],
    previous = new Map<string, string | null>([[start, null]]);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === 'imports') continue;
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === end) {
      const path: string[] = [];
      let p: string | null = id;
      while (p !== null) {
        path.unshift(p);
        p = previous.get(p) ?? null;
      }
      return path;
    }
    for (const next of adjacency.get(id) ?? [])
      if (!previous.has(next)) {
        previous.set(next, id);
        queue.push(next);
      }
  }
  return [];
}

export interface BusinessEntry {
  id: string;
  name: string;
  file: string;
  kind: 'route' | 'function';
}
export interface BusinessStep {
  id: string;
  kind: 'entry' | 'action' | 'decision' | 'outcome' | 'unknown';
  title: string;
  description: string;
  input: string;
  output: string;
  evidence: string[];
}
export interface BusinessTransition {
  source: string;
  target: string;
  condition: string;
  data: string;
}
export interface BusinessFlow {
  title: string;
  goal: string;
  trigger: string;
  steps: BusinessStep[];
  transitions: BusinessTransition[];
  limitations: string[];
  documentEvidence: string[];
  entryId: string;
  language: Language;
  fingerprint: string;
  model: string;
  createdAt: string;
}

export type BusinessEntityKind = 'actor' | 'process' | 'data' | 'store' | 'outcome';
export type BusinessRelationKind =
  'triggers' | 'reads' | 'writes' | 'transforms' | 'produces' | 'transfers';
export interface BusinessDomain {
  id: string;
  title: string;
  description: string;
}
export interface BusinessEntity {
  id: string;
  domain: string;
  kind: BusinessEntityKind;
  title: string;
  description: string;
  fields: string[];
  evidence: string[];
}
export interface BusinessRelation {
  /** Set by the validator when subject/object direction is converted to data travel. */
  directionNormalized?: true;
  id: string;
  source: string;
  target: string;
  kind: BusinessRelationKind;
  label: string;
  data: string;
  description: string;
  evidence: string[];
}
export interface PendingBusinessRelation extends BusinessRelation {
  reason: 'incompatible_endpoints';
}
export interface BusinessKnowledge {
  pendingRelations?: PendingBusinessRelation[];
  title: string;
  summary: string;
  domains: BusinessDomain[];
  nodes: BusinessEntity[];
  edges: BusinessRelation[];
  limitations: string[];
  fingerprint: string;
  language: Language;
  model: string;
  createdAt: string;
  coverage: {
    includedCode: number;
    totalCode: number;
    includedDocs: number;
    totalDocs: number;
    truncated: boolean;
  };
}
