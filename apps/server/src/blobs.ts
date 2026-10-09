import { createHash } from "node:crypto";
import type pg from "pg";
import { pool, Fault } from "./db.js";
import type { ProjectFile } from "./model.js";

// Image bytes live in content-addressed blobs; project data, checkpoints and
// build inputs keep only the SHA-256. Saving a document then writes the text
// and not every image again. Blobs are never deleted: history keeps pointing
// at them. Projects saved before blobs keep `bytes` until they are written.

export const blobId = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export async function putBlob(db: pg.Pool | pg.PoolClient, bytes: Buffer) {
  const id = blobId(bytes);
  await db.query(
    "INSERT INTO blobs(id,bytes) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
    [id, bytes],
  );
  return id;
}

/** Moves inline image bytes of these files into blobs. */
export async function storeBlobs(
  db: pg.Pool | pg.PoolClient,
  files: ProjectFile[],
) {
  for (const f of files)
    if (f.bytes !== undefined) {
      const bytes = Buffer.from(f.bytes, "base64");
      f.blob = await putBlob(db, bytes);
      f.size = bytes.length;
      delete f.bytes;
    }
}

export async function readBlob(id: string, db: pg.Pool | pg.PoolClient = pool) {
  const r = await db.query("SELECT bytes FROM blobs WHERE id=$1", [id]);
  if (!r.rowCount) throw new Fault("NOT_FOUND", 404);
  return r.rows[0].bytes as Buffer;
}

/** A file's content: text, or image bytes from its blob (or inline bytes). */
export async function content(f: ProjectFile): Promise<Buffer | string> {
  if (f.bytes !== undefined) return Buffer.from(f.bytes, "base64");
  if (f.blob) return readBlob(f.blob);
  return f.source || "";
}

export const fileSize = (f: ProjectFile) =>
  f.size ??
  (f.bytes !== undefined
    ? Buffer.byteLength(f.bytes, "base64")
    : Buffer.byteLength(f.source || ""));

/** Projects saved before blobs: move their images out, one project at a time. */
export async function migrateBlobs() {
  const ids = await pool.query(
    "SELECT id FROM projects WHERE jsonb_path_exists(data, '$.files[*].bytes')",
  );
  for (const { id } of ids.rows) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const r = await db.query(
        "SELECT data FROM projects WHERE id=$1 FOR UPDATE",
        [id],
      );
      await storeBlobs(db, r.rows[0].data.files);
      await db.query("UPDATE projects SET data=$2 WHERE id=$1", [
        id,
        r.rows[0].data,
      ]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}
