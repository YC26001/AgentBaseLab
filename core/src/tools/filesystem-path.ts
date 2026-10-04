import { realpath } from "node:fs/promises";
import path from "node:path";

export function validateRelativePath(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("[path_input] input.path must be a string");
  }
  if (value.trim().length === 0) {
    throw new Error("[path_input] input.path must not be empty or whitespace");
  }
  if (value.includes("\0")) {
    throw new Error("[path_input] input.path must not contain a null byte");
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error("[path_input] Absolute paths are not allowed");
  }
  return value;
}

function assertWithinWorkspace(workspace: string, target: string): void {
  const relative = path.relative(workspace, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("[workspace_boundary] Path escapes workspace");
  }
}

export async function resolveWorkspacePath(
  workspace: string,
  requestedPath: unknown
): Promise<string> {
  const relativePath = validateRelativePath(requestedPath);
  const workspacePath = path.resolve(workspace);
  const targetPath = path.resolve(workspacePath, relativePath);
  assertWithinWorkspace(workspacePath, targetPath);

  let realWorkspace: string;
  let realTarget: string;
  try {
    realWorkspace = await realpath(workspacePath);
    realTarget = await realpath(targetPath);
  } catch (error) {
    throw new Error(
      "[filesystem] Cannot resolve workspace or requested path (missing, broken symlink, or inaccessible)",
      { cause: error }
    );
  }

  assertWithinWorkspace(realWorkspace, realTarget);
  return realTarget;
}
