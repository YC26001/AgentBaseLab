export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "gemma4:12b";

export async function callModel(
  messages: Message[],
  format?: "json"
): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      format,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama request failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data: unknown = await response.json();

  if (typeof data !== "object" || data === null || !("message" in data)) {
    throw new Error("Ollama response is missing message");
  }

  const message = data.message;

  if (
    typeof message !== "object" ||
    message === null ||
    !("content" in message) ||
    typeof message.content !== "string"
  ) {
    throw new Error("Ollama response is missing a string message.content");
  }

  return message.content;
}
