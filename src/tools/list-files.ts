import { opendir } from "node:fs/promises";
import { MAX_LIST_ENTRIES, MAX_TOOL_OUTPUT_BYTES } from "../limits.js";
import { resolveWorkspacePath } from "./filesystem-path.js";

type FileEntry = {
  name: string;
  type: "file" | "directory";
};

export async function listFiles(
  workspace: string,
  relativePath: unknown = "."
): Promise<FileEntry[]> {
  const targetPath = await resolveWorkspacePath(workspace, relativePath);
  const directory = await opendir(targetPath);
  const result: FileEntry[] = [];

  for await (const entry of directory) {
    if (result.length >= MAX_LIST_ENTRIES) {
      throw new Error(`[size_limit] list_files exceeds ${MAX_LIST_ENTRIES} entries`);
    }
    result.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  if (Buffer.byteLength(JSON.stringify(result), "utf-8") > MAX_TOOL_OUTPUT_BYTES) {
    throw new Error(`[size_limit] list_files output exceeds ${MAX_TOOL_OUTPUT_BYTES} bytes`);
  }

  return result;
}
