import type { FileEntry } from "../tools/list-files.js";

export type ListFilesObservation = {
  type: "list_files";
  path: string;
  count: number;
  entries: FileEntry[];
};

export type ReadFileObservation = {
  type: "read_file";
  path: string;
  // UTF-8 bytes in returned text; empty text has 0 lines, trailing newline adds none.
  bytes: number;
  lines: number;
  content: string;
};

export type StructuredObservation = ListFilesObservation | ReadFileObservation;
