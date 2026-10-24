import type { Preservation } from "../../../packages/codec/src/index.js";
import type { Numbering } from "../../../packages/codec/src/numbering.js";
export type Role = "owner" | "editor" | "viewer";
export interface ProjectFile {
  id: string;
  path: string;
  kind: "document" | "image" | "text";
  source?: string;
  /** Inline image bytes (base64): uploads and data saved before blobs. */
  bytes?: string;
  /** SHA-256 of the image bytes in the blobs table, and their length. */
  blob?: string;
  size?: number;
  mime?: string;
  state?: string;
  preservation?: Preservation;
  mode?: "visual" | "raw";
  epoch: number;
  rawVersion?: number;
  rawOwner?: string;
  rawUntil?: number;
  uploadId?: string;
  name?: string;
}
export interface ProjectData {
  numbering?: Numbering;
  /** Opaque metadata from older archives; never interpreted as formatting. */
  regulations?: {
    numbering?: unknown;
    reviews?: Record<string, Record<string, unknown>>;
  };
  /** Existing projects retain auto builds until explicitly switched to manual. */
  autoBuild?: boolean;
  files: ProjectFile[];
  epoch: number;
  target: string;
  /** Folders without files; folders that hold files follow from file paths. */
  folders?: string[];
  contentRevision?: number;
  pdfBuild?: string;
  pdfRevision?: number;
}
export interface Project {
  id: string;
  name: string;
  revision: number;
  data: ProjectData;
  role?: Role;
}
