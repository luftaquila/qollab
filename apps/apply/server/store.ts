import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { State, Plan } from "./model.js";
import { ApplyError } from "./model.js";
export class ApplyStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,project TEXT NOT NULL,expires INTEGER NOT NULL,data TEXT NOT NULL);",
    );
  }
  get(id: string): State {
    const row = this.db.prepare("SELECT data FROM projects WHERE id=?").get(id);
    return row
      ? JSON.parse(String(row.data))
      : { version: 0, clauses: [], runs: [] };
  }
  put(id: string, state: State, expected: number) {
    const next = { ...state, version: expected + 1 };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.get(id).version !== expected)
        throw new ApplyError("STATE_CHANGED", 409);
      this.db
        .prepare(
          "INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data",
        )
        .run(id, next.version, JSON.stringify(next));
      this.db.exec("COMMIT");
      return next;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  plan(plan: Plan) {
    this.db
      .prepare("DELETE FROM plans WHERE expires<?")
      .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.db
      .prepare("INSERT INTO plans VALUES(?,?,?,?)")
      .run(plan.id, plan.project, plan.expires, JSON.stringify(plan));
  }
  getPlan(id: string, project: string, allowExpired = false): Plan {
    const row = this.db
      .prepare("SELECT data FROM plans WHERE id=? AND project=? AND expires>?")
      .get(id, project, allowExpired ? 0 : Date.now());
    if (!row) throw new ApplyError("PLAN_EXPIRED", 409);
    return JSON.parse(String(row.data));
  }
  close() {
    this.db.close();
  }
}
