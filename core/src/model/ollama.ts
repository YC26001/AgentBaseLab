import { describeError, previewText } from "../diagnostics.js";
import { MAX_THINKING_CHARS } from "../limits.js";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelResponse = {
  content: string;
  thinking: string;
  thinkingTruncated: boolean;
};

// Retain bounded partial thinking when the stream fails before completion.
export class ModelStreamError extends Error {
  constructor(
    message: string,
    public readonly thinking: string,
    public readonly thinkingTruncated: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ModelStreamError";
  }
}

export async function callModel(
  messages: Message[],
  format?: "json",
  onThinkingDelta?: (delta: string) => void
): Promise<ModelResponse> {
  const ollamaUrl = new URL("/api/chat", process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").toString();
  const response = await fetch(ollamaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? "gemma4:12b",
      messages,
      think: true,
      stream: true,
      format,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama request failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error("Ollama response is missing a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let contentBuffer = "";
  let thinkingBuffer = "";
  let thinkingTruncated = false;

  function consume(line: string): boolean {
    const data: unknown = JSON.parse(line);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("Ollama stream chunk must be a JSON object");
    }
    if ("error" in data) {
      throw new Error(`Ollama stream error: ${previewText(String(data.error))}`);
    }
    if (!("done" in data) || typeof data.done !== "boolean") {
      throw new Error("Ollama stream chunk is missing a boolean done");
    }
    if ("message" in data) {
      const message = data.message;
      if (typeof message !== "object" || message === null || Array.isArray(message)) {
        throw new Error("Ollama stream chunk has an invalid message");
      }
      if ("content" in message) {
        if (typeof message.content !== "string") {
          throw new Error("Ollama stream message.content must be a string");
        }
        contentBuffer += message.content;
      }
      if ("thinking" in message) {
        if (typeof message.thinking !== "string") {
          throw new Error("Ollama stream message.thinking must be a string");
        }
        const delta = message.thinking;
        const remaining = MAX_THINKING_CHARS - thinkingBuffer.length;
        thinkingBuffer += delta.slice(0, remaining);
        thinkingTruncated ||= delta.length > remaining;
        if (delta.length > 0) onThinkingDelta?.(delta);
      }
    } else if (!data.done) {
      throw new Error("Ollama stream chunk is missing message");
    }
    return data.done;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line && consume(line)) {
          return { content: contentBuffer, thinking: thinkingBuffer, thinkingTruncated };
        }
      }
      if (done) {
        if (pending.trim() && consume(pending.trim())) {
          return { content: contentBuffer, thinking: thinkingBuffer, thinkingTruncated };
        }
        throw new Error("Ollama stream ended before done: true");
      }
    }
  } catch (error) {
    throw new ModelStreamError(
      `Ollama stream failed before completion: ${describeError(error)}`,
      thinkingBuffer,
      thinkingTruncated,
      { cause: error }
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
