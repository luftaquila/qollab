import { createHash } from "node:crypto";
import { z } from "zod";
const column = z.string().regex(/^[A-Z]{1,2}$/);
export const connectionSchema = z
  .object({
    spreadsheetId: z.string().regex(/^[\w-]{15,150}$/),
    sheet: z.string().trim().min(1).max(100),
    reviewSheet: z.string().trim().min(1).max(100),
    firstRow: z.number().int().min(1).max(10000),
    lastRow: z.number().int().min(1).max(10000),
    year: z.number().int().min(2000).max(2200),
    columns: z.object({
      key: column,
      context: z.array(column).max(6),
      source: z.array(column).min(1).max(10),
      current: z.array(column).max(10),
      notes: column.optional(),
      decision: column.optional(),
      timing: column.optional(),
    }),
    decisions: z
      .array(
        z.object({
          value: z.string().min(1),
          action: z.enum(["insert", "replace", "keep", "hold"]),
        }),
      )
      .max(40),
    timings: z
      .array(
        z.object({
          value: z.string().min(1),
          year: z.number().int().min(2000).max(2200),
        }),
      )
      .max(30),
  })
  .refine(
    (c) => c.lastRow >= c.firstRow && c.sheet !== c.reviewSheet,
    "Invalid source or review range",
  );
export type Connection = z.infer<typeof connectionSchema>;
export const draftSchema = z.object({
  year: z.number().int().min(2000).max(2200).nullable(),
  action: z.enum(["insert", "replace", "keep", "hold"]),
  fileId: z.string().uuid().or(z.literal("")),
  anchor: z.string().max(200),
  before: z.string().max(100000),
  final: z.string().max(100000),
  confirmed: z.boolean(),
});
export type Draft = z.infer<typeof draftSchema>;
export interface Clause {
  id: string;
  key: string;
  sourceKey: string;
  context: string[];
  source: string;
  current: string;
  notes: string;
  decision: string;
  timing: string;
  firstRow: number;
  lastRow: number;
  sourceHash: string;
  approvalHash: string;
  missing: boolean;
  draft: Draft;
  appliedHash?: string;
  appliedRevision?: number;
  appliedBy?: string;
}
export interface Run {
  id: string;
  planId: string;
  ids: string[];
  fileId: string;
  status: "pending" | "applied" | "failed" | "uncertain";
  beforeHash: string;
  afterHash: string;
  revision?: number;
  checkpoint?: string;
  actor: string;
  actorName: string;
  at: string;
  sheetSynced?: boolean;
  error?: string;
}
export interface State {
  version: number;
  connection?: Connection;
  clauses: Clause[];
  runs: Run[];
}
export interface Plan {
  id: string;
  project: string;
  version: number;
  fileId: string;
  revision: number;
  before: string;
  after: string;
  ids: string[];
  digests: Record<string, string>;
  sourceDigest: string;
  reviewDigest: string;
  expires: number;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const changeDigest = (c: Clause) =>
  digest({ source: c.sourceHash, draft: c.draft });
export class ApplyError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail = "",
  ) {
    super(code);
  }
}
export function columnIndex(value: string) {
  return [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
export const quoteSheet = (name: string) =>
  "'" + name.replaceAll("'", "''") + "'";
export function sourceRange(connection: Connection) {
  const columns = Object.values(connection.columns)
    .flat()
    .filter((value): value is string => typeof value === "string");
  const last = columns.reduce((a, b) =>
    columnIndex(a) > columnIndex(b) ? a : b,
  );
  return `${quoteSheet(connection.sheet)}!A${connection.firstRow}:${last}${connection.lastRow}`;
}
export const reviewHeaders = [
  "처리 ID",
  "원본 식별자",
  "원본 위치",
  "원문",
  "기존 문안",
  "검토의견",
  "판단",
  "시행연도",
  "최종 문안",
  "확정",
  "대상 문서 ID",
  "대상 라벨",
  "작업",
  "교체할 원문",
  "원본 버전",
  "반영 상태",
  "반영 버전",
  "반영자",
];
export const reviewValues = (c: Clause) => [
  c.id,
  c.key,
  `${c.firstRow}:${c.lastRow}`,
  c.source,
  c.current,
  c.notes,
  c.decision,
  c.draft.year ?? "",
  c.draft.final,
  c.draft.confirmed,
  c.draft.fileId,
  c.draft.anchor,
  c.draft.action,
  c.draft.before,
  c.approvalHash,
  c.missing
    ? "원본 없음"
    : c.appliedHash === changeDigest(c)
      ? "반영 완료"
      : c.draft.confirmed
        ? "확정"
        : "검토 중",
  c.appliedRevision ?? "",
  c.appliedBy ?? "",
];
