import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Snapshot, Explanation, BusinessFlow, BusinessKnowledge } from '../shared/types';
export class Store {
  private db: DatabaseSync;
  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'codescope.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS explanations (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS business_flows (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS business_knowledge (key TEXT PRIMARY KEY, data TEXT NOT NULL);',
    );
  }
  list(): Snapshot[] {
    return (this.db.prepare('SELECT data FROM snapshots').all() as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  get(id: string): Snapshot | undefined {
    const row = this.db.prepare('SELECT data FROM snapshots WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  save(s: Snapshot) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?)').run(s.id, JSON.stringify(s));
  }
  getExplanation(key: string): Explanation | undefined {
    const row = this.db.prepare('SELECT data FROM explanations WHERE key=?').get(key) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveExplanation(key: string, value: Explanation) {
    this.db
      .prepare('INSERT OR REPLACE INTO explanations VALUES (?,?)')
      .run(key, JSON.stringify(value));
  }
  getBusinessFlow(key: string): BusinessFlow | undefined {
    const row = this.db.prepare('SELECT data FROM business_flows WHERE key=?').get(key) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveBusinessFlow(key: string, flow: BusinessFlow) {
    this.db
      .prepare('INSERT OR REPLACE INTO business_flows VALUES (?,?)')
      .run(key, JSON.stringify(flow));
  }
  getKnowledge(key: string): BusinessKnowledge | undefined {
    const row = this.db.prepare('SELECT data FROM business_knowledge WHERE key=?').get(key) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveKnowledge(key: string, graph: BusinessKnowledge) {
    this.db
      .prepare('INSERT OR REPLACE INTO business_knowledge VALUES (?,?)')
      .run(key, JSON.stringify(graph));
  }
  close() {
    this.db.close();
  }
}
