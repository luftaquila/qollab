import { createHash } from "node:crypto";
import { z } from "zod";
const column = z.string().regex(/^[A-Z]{1,2}$/);
export const connectionSchema = z
  .object({
    spreadsheetId: z.string().regex(/^[\w-]{15,150}$/),
    sheet: z.string().trim().min(1).max(100),
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
          action: z.enum(["insert", "replace", "keep", "hold", "exclude"]),
        }),
      )
      .max(40),
    timings: z
      .array(
        z.object({
          value: z.string().min(1),
          year: z.union([
            z.number().int().min(2000).max(2200),
            z.literal("edition"),
            z.null(),
          ]),
        }),
      )
      .max(30),
  })
  .refine((c) => c.lastRow >= c.firstRow, "Invalid source range");
export type Connection = z.infer<typeof connectionSchema>;
export const draftSchema = z.object({
  year: z.number().int().min(2000).max(2200).nullable(),
  action: z.enum(["insert", "replace", "keep", "hold", "schedule"]),
  fileId: z.string().uuid().or(z.literal("")),
  anchor: z.string().max(200),
  before: z.string().max(100000),
  final: z.string().max(100000),
  confirmed: z.boolean(),
  deferred: z.boolean().optional(),
  replacements: z
    .array(
      z.object({
        from: z.string().min(1).max(10000),
        to: z.string().max(100000),
      }),
    )
    .max(2000)
    .optional(),
  placement: z
    .object({
      heading: z.string().max(1000),
      parents: z
        .array(
          z.object({
            label: z.string().max(200),
            heading: z.string().max(1000),
          }),
        )
        .max(5),
      next: z.string().max(200).optional(),
      previous: z.string().max(200).optional(),
    })
    .optional(),
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
  matches?: boolean;
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
  year?: number;
  before: string;
  after: string;
  ids: string[];
  digests: Record<string, string>;
  sourceDigest: string;
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
