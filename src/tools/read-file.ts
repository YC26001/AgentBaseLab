import { open } from "node:fs/promises";
import { MAX_READ_FILE_BYTES, MAX_TOOL_OUTPUT_BYTES } from "../limits.js";
import { resolveWorkspacePath } from "./filesystem-path.js";

export async function readFileTool(
  workspace: string,
  relativePath: unknown
): Promise<string> {
  const targetPath = await resolveWorkspacePath(workspace, relativePath);
  const file = await open(targetPath, "r");

  try {
    const info = await file.stat();
    if (!info.isFile()) {
      throw new Error("[filesystem] read_file requires a regular file");
    }
    if (info.size > MAX_READ_FILE_BYTES) {
      throw new Error(`[size_limit] read_file exceeds ${MAX_READ_FILE_BYTES} bytes`);
    }

    // The extra byte detects growth beyond the limit without an unbounded read.
    const buffer = Buffer.alloc(MAX_READ_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_READ_FILE_BYTES) {
      throw new Error(`[size_limit] read_file exceeds ${MAX_READ_FILE_BYTES} bytes`);
    }

    const content = buffer.subarray(0, total).toString("utf-8");
    if (Buffer.byteLength(content, "utf-8") > MAX_TOOL_OUTPUT_BYTES) {
      throw new Error(`[size_limit] read_file output exceeds ${MAX_TOOL_OUTPUT_BYTES} bytes`);
    }
    return content;
  } finally {
    await file.close();
  }
}
