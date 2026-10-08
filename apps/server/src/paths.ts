import path from "node:path";
import { Fault } from "./db.js";
export function safeFolder(value: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 240 ||
    /[\x00-\x1f\\:]/.test(value) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (x) =>
          !x ||
          x === "." ||
          x === ".." ||
          x.startsWith(".") ||
          x.startsWith("-"),
      ) ||
    value
      .split("/")
      .some((x) =>
        ["_extensions", "node_modules", "_freeze", "_site"].includes(x),
      )
  )
    throw new Fault("INVALID_PATH");
  return value;
}
export function safePath(value: string) {
  safeFolder(value);
  const ext = path.extname(value).toLowerCase();
  if (
    ![
      ".qmd",
      ".md",
      ".yml",
      ".yaml",
      ".bib",
      ".csl",
      ".png",
      ".jpg",
      ".jpeg",
      ".tex",
      ".sty",
    ].includes(ext)
  )
    throw new Fault("FILE_TYPE");
  return value;
}
export function relativeAsset(documentPath: string, assetPath: string) {
  return path.posix.relative(path.posix.dirname(documentPath), assetPath);
}
export function resolveReference(documentPath: string, reference: string) {
  const p = path.posix.normalize(
    path.posix.join(path.posix.dirname(documentPath), reference),
  );
  if (p.startsWith("../") || p.startsWith("/")) throw new Fault("INVALID_PATH");
  return p;
}
