import type { Numbering } from "../../../packages/codec/src/numbering";

export interface PdfSnapshot {
  project: string;
  target: string;
  overrides: Record<string, string>;
  assets: Record<string, string>;
  numbering?: Numbering;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Render inputs only: checkpoints, presence and other project metadata do not invalidate a PDF. */
export function pdfCacheKey({
  project,
  target,
  overrides,
  assets,
  numbering,
}: PdfSnapshot) {
  return JSON.stringify(
    canonical({ project, target, overrides, assets, numbering }),
  );
}

/** An export can race a remote image replacement. Do not cache it under the old image identities. */
export async function verifyPdfAssets(
  files: Record<string, Uint8Array>,
  assets: Record<string, string>,
) {
  for (const [path, identity] of Object.entries(assets)) {
    const bytes = files[path];
    if (!bytes || !/^[a-f0-9]{64}$/.test(identity)) return false;
    const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
    const hex = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (identity !== hex) return false;
  }
  return true;
}
