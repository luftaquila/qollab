import pg from "pg";
import { config } from "./config.js";
export const pool = new pg.Pool({ connectionString: config.database, max: 10 });
export async function migrate() {
  await pool.query(`
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY, email text NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id text REFERENCES users(id),csrf text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oidc_states(id text PRIMARY KEY,verifier text NOT NULL,nonce text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id uuid PRIMARY KEY,name text NOT NULL,revision bigint NOT NULL DEFAULT 0,data jsonb NOT NULL,created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id text REFERENCES users(id),role text NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS invites(id text PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,email text NOT NULL,role text NOT NULL CHECK(role IN ('editor','viewer')),expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS document_generations(id uuid PRIMARY KEY,epoch integer NOT NULL);
CREATE TABLE IF NOT EXISTS updates(document_id uuid NOT NULL,epoch integer NOT NULL,message_id uuid NOT NULL,user_id text NOT NULL,seq bigserial,bytes bytea NOT NULL,created timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(document_id,epoch,message_id));
CREATE TABLE IF NOT EXISTS checkpoints(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,revision bigint NOT NULL,label text NOT NULL,actor text,snapshot jsonb NOT NULL,git_hash text,created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS restores(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,target uuid NOT NULL,status text NOT NULL,created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS builds(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,revision bigint NOT NULL,epoch integer NOT NULL,target text NOT NULL,status text NOT NULL,input jsonb NOT NULL,lease text,lease_until timestamptz,log text,pdf bytea,image text,created timestamptz NOT NULL DEFAULT now(),finished timestamptz);
CREATE INDEX IF NOT EXISTS builds_queue ON builds(status,created);
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,project_id uuid,actor text,event text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS maintenance(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),frozen boolean NOT NULL DEFAULT false,backup_id text);
INSERT INTO maintenance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture text;
ALTER TABLE projects ALTER COLUMN updated SET DEFAULT now();
CREATE TABLE IF NOT EXISTS blobs(id text PRIMARY KEY,bytes bytea NOT NULL);
`);
}
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock_shared(917240)");
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 400,
    public params: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
export const assert = (
  condition: unknown,
  code: string,
  status = 400,
): asserts condition => {
  if (!condition) throw new Fault(code, status);
};
