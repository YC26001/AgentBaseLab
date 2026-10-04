import { createAgentServer, DEFAULT_WEB_ORIGIN } from "./server.js";
import { describeError } from "../diagnostics.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3001");
const webOrigin = process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exitCode = 1;
} else {
  const server = createAgentServer({ webOrigin });
  server.on("error", (error) => {
    console.error("Local API failed:", describeError(error));
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Local API: http://${host}:${port}/api/agent/run`);
    console.log(`Web origin: ${webOrigin}`);
  });
}
