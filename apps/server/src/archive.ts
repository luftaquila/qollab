import { unzipSync, zipSync } from "fflate";
import { safePath } from "./paths.js";
import { config } from "./config.js";
import { Fault } from "./db.js";
import type { ProjectFile, ProjectData } from "./model.js";
import { content } from "./blobs.js";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { numberingSchema } from "../../../packages/codec/src/numbering.js";
export const regulationManifest = "_qollab-regulations.yml";
export const projectManifest = "_qollab.yml";
const legacySchema = z.object({
  version: z.literal(1),
  numbering: z.unknown().optional(),
  reviews: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export function restoreRegulations(
  entries: Record<string, Uint8Array>,
  data: ProjectData,
) {
  const current = entries[projectManifest];
  if (current) {
    const parsed = z
      .object({ version: z.literal(2), numbering: numberingSchema.optional() })
      .parse(parse(new TextDecoder().decode(current), { maxAliasCount: 0 }));
    data.numbering = parsed.numbering;
  }
  // Preserve old metadata on export/import without interpreting any domain-specific fields.
  const bytes = entries[regulationManifest];
  if (!bytes) return;
  const parsed = legacySchema.parse(
    parse(new TextDecoder().decode(bytes), { maxAliasCount: 0 }),
  );
  data.regulations = { numbering: parsed.numbering, reviews: {} };
  for (const [path, reviews] of Object.entries(parsed.reviews)) {
    const file = data.files.find((f) => f.path === path);
    if (file) data.regulations.reviews![file.id] = reviews;
  }
}
export function readZip(data: Buffer): Record<string, Uint8Array> {
  if (data.length > config.projectBytes) throw new Fault("PROJECT_LIMIT", 413);
  // Inspect the central directory before allocation, including Unix file mode.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Fault("INVALID_ZIP");
  const count = data.readUInt16LE(eocd + 10);
  let at = data.readUInt32LE(eocd + 16),
    total = 0;
  const names = new Set<string>();
  if (count > 1000 || count === 65535) throw new Fault("FILE_COUNT", 413);
  for (let i = 0; i < count; i++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50)
      throw new Fault("INVALID_ZIP");
    const size = data.readUInt32LE(at + 24),
      nl = data.readUInt16LE(at + 28),
      el = data.readUInt16LE(at + 30),
      cl = data.readUInt16LE(at + 32),
      mode = data.readUInt32LE(at + 38) >>> 16;
    const name = data.subarray(at + 46, at + 46 + nl).toString("utf8");
    at += 46 + nl + el + cl;
    if (
      (mode & 0xf000) === 0xa000 ||
      data.readUInt16LE(at - (46 + nl + el + cl) + 8) & 1
    )
      throw new Fault("ZIP_LINK_OR_ENCRYPTION");
    if (name.endsWith("/")) {
      safePath(name + "empty.md");
      continue;
    }
    safePath(name);
    if (names.has(name)) throw new Fault("DUPLICATE_PATH");
    names.add(name);
    total += size;
    if (
      total > config.projectBytes ||
      size >
        (/\.(png|jpe?g)$/i.test(name)
          ? config.imageBytes
          : config.documentBytes)
    )
      throw new Fault("PROJECT_LIMIT", 413);
  }
  const out = unzipSync(data, {
    filter: (f) => !f.name.endsWith("/") && names.has(f.name),
  });
  if (Object.keys(out).length !== names.size) throw new Fault("INVALID_ZIP");
  return out;
}
export async function writeZip(files: ProjectFile[], data?: ProjectData) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    const data = await content(f);
    entries[f.path] = typeof data === "string" ? Buffer.from(data) : data;
  }
  if (data?.regulations) {
    if (entries[regulationManifest]) throw new Fault("PATH_EXISTS", 409);
    entries[regulationManifest] = Buffer.from(
      stringify({
        version: 1,
        numbering: data.regulations.numbering,
        reviews: Object.fromEntries(
          files
            .filter((f) => data.regulations?.reviews?.[f.id])
            .map((f) => [f.path, data.regulations!.reviews![f.id]]),
        ),
      }),
    );
  }
  if (data?.numbering) {
    if (entries[projectManifest]) throw new Fault("PATH_EXISTS", 409);
    entries[projectManifest] = Buffer.from(
      stringify({ version: 2, numbering: data.numbering }),
    );
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}
