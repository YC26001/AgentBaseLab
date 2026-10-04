const defaultCoreBaseUrl = "http://127.0.0.1:3001";
const runPath = "/api/agent/run";

export function getAgentRunUrl(): string {
  // Use a direct env reference so Next.js can inline it in the browser bundle.
  const configured = process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL?.trim();
  const base = new URL(configured || defaultCoreBaseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Agent Core URL 必須使用 http 或 https。");
  }
  return new URL(runPath, base).toString();
}
