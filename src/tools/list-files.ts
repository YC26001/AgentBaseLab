import { readdir } from "node:fs/promises";
import path from "node:path";

type FileEntry = {
  name: string;
  type: "file" | "directory";
};

export async function listFiles(
  workspace: string,
  relativePath: string = "."
): Promise<FileEntry[]> {
  const targetPath = path.resolve(workspace, relativePath);
  const entries = await readdir(targetPath, { withFileTypes: true });

  const result: FileEntry[] = entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : "file",
  }));

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
