import { MAX_ERROR_PREVIEW_CHARS, MAX_ERROR_MESSAGE_CHARS } from "./limits.js";

export function previewText(text: string, limit = MAX_ERROR_PREVIEW_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated]`;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return previewText(message, MAX_ERROR_MESSAGE_CHARS);
}
