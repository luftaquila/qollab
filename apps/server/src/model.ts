import type { Preservation } from "../../../packages/codec/src/index.js";
export type Role = "owner" | "editor" | "viewer";
export interface ProjectFile {
  id: string;
  path: string;
  kind: "document" | "image" | "text";
  source?: string;
  bytes?: string;
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
