import { createServer } from "node:http";
import { once } from "node:events";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { MCP_PUBLIC_URL, MCP_SERVER_RESPONSE_TIMEOUT_MS } from "../src/lib/mcp-config";
import { createDemoMcpServer } from "../src/lib/mcp-demo-server";
import { authorizeSchedulerRequest } from "../src/lib/scheduler-auth";
import { SCHEDULER_MCP_URL } from "../src/lib/scheduler-config";
import { createSchedulerMcpServer } from "../src/lib/scheduler-mcp-server";
import { getProfileStore } from "../src/lib/profile-store";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MCP_PORT должен быть целым числом от 1 до 65535.");
}
const publicUrl = new URL(MCP_PUBLIC_URL);
const schedulerPath = new URL(SCHEDULER_MCP_URL).pathname;
const allowedHosts = [publicUrl.host, `127.0.0.1:${port}`, `localhost:${port}`];

const httpServer = createServer(async (request, response) => {
  // Проверка на HTTP-границе вместо устаревших DNS-rebinding опций SDK.
  if (!allowedHosts.includes(request.headers.host ?? "") ||
      (request.headers.origin !== undefined && request.headers.origin !== publicUrl.origin)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (request.url !== publicUrl.pathname && request.url !== schedulerPath) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end("Method not allowed");
    return;
  }

  let server;
  try {
    if (request.url === schedulerPath) {
      const authorization = authorizeSchedulerRequest(request.headers, process.env.MCP_SCHEDULER_TOKEN);
      if (authorization.status !== 200) {
        response.writeHead(authorization.status, { "Content-Type": "text/plain" }).end(authorization.message);
        return;
      }
      if (!getProfileStore().getProfile(authorization.profileId)) {
        response.writeHead(404).end("Profile not found");
        return;
      }
      server = createSchedulerMcpServer(authorization.profileId);
    } else {
      server = createDemoMcpServer();
    }
  } catch (error) {
    console.error("mcp_initialization_failed", { error: error instanceof Error ? error.name : "UnknownError" });
    response.writeHead(503).end("MCP server unavailable");
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 16 * 1024,
  });
  const closeWait = new AbortController();
  const connectionClosed = once(response, "close", { signal: closeWait.signal });
  const deadline = setTimeout(() => {
    if (!response.headersSent) response.writeHead(504).end("MCP response timeout");
    else response.destroy();
  }, MCP_SERVER_RESPONSE_TIMEOUT_MS);
  try {
    // Отменённый JSON-RPC запрос может не получить ответа от SDK. Разрыв
    // соединения и абсолютный deadline также должны завершать HTTP-обработчик.
    await Promise.race([
      server.connect(transport).then(() => transport.handleRequest(request, response)),
      connectionClosed,
    ]);
  } catch (error) {
    console.error("mcp_request_failed", {
      method: request.method,
      path: publicUrl.pathname,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", id: null,
        error: { code: -32603, message: "Internal error" },
      }));
    } else {
      response.destroy();
    }
  } finally {
    clearTimeout(deadline);
    closeWait.abort();
    await server.close();
  }
});

httpServer.on("error", (error) => {
  console.error("mcp_server_failed", error);
  process.exitCode = 1;
});
httpServer.listen(port, host, () => {
  console.log(`MCP server listening on http://${host}:${port}${publicUrl.pathname}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    httpServer.close();
    httpServer.closeAllConnections();
  });
}
