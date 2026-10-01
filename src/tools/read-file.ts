import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readFileTool(
  workspace: string,
  relativePath: string
): Promise<string> {
  const targetPath = path.resolve(workspace, relativePath);

  return await readFile(targetPath, "utf-8");
}
