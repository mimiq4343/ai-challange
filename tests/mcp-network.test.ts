import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

import {
  isMcpAddressAllowed,
  limitMcpResponse,
  McpValidationError,
  parseMcpUrl,
} from "../src/lib/mcp-network";

test("MCP endpoints reject credentials, insecure transport and local IP spellings", () => {
  for (const value of [
    "http://example.com/mcp",
    "file:///etc/passwd",
    "https://user:password@example.com/mcp",
    "https://example.com/mcp?token=secret",
    "https://example.com/mcp#fragment",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://2130706433/mcp",
    "https://0x7f000001/mcp",
    "https://[::1]/mcp",
    "https://[::ffff:127.0.0.1]/mcp",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/mcp",
  ]) {
    assert.throws(() => parseMcpUrl(value), McpValidationError);
  }
  assert.equal(parseMcpUrl(" https://EXAMPLE.com:443/mcp ").href, "https://example.com/mcp");
});

test("DNS resolution cannot connect public MCP names to private or special addresses", () => {
  const origin = new URL("https://example.com/mcp");
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.100.100.200", "127.0.0.1",
    "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.2.1",
    "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1",
    "fc00::1", "fe80::1", "ff02::1", "::ffff:10.1.2.3", "2001:db8::1",
  ]) {
    assert.equal(isMcpAddressAllowed(origin, address), false, address);
  }
  assert.equal(isMcpAddressAllowed(origin, "1.1.1.1"), true);
  assert.equal(isMcpAddressAllowed(origin, "2606:4700:4700::1111"), true);
});

test("the trusted MCP origin permits private LAN addresses but never loopback or metadata", () => {
  const origin = parseMcpUrl("https://mcp.yees.ai/mcp");
  assert.equal(isMcpAddressAllowed(origin, "10.43.228.152"), true);
  for (const address of ["127.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isMcpAddressAllowed(origin, address), false);
  }
  assert.equal(isMcpAddressAllowed(new URL("https://mcp.yees.ai:8443/mcp"), "10.43.228.152"), false);
  assert.equal(isMcpAddressAllowed(new URL("https://mcp.yees.ai.attacker.example/mcp"), "10.43.228.152"), false);
});

test("compressed MCP bodies are limited after decompression, including error responses", async (t) => {
  const compressed = gzipSync("x".repeat(3 * 1024 * 1024));
  const server = createServer((_request, response) => {
    response.writeHead(502, { "Content-Encoding": "gzip", "Content-Type": "text/plain" });
    response.end(compressed);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}`);
  const limited = limitMcpResponse(response);
  assert.equal(limited.status, 502);
  await assert.rejects(() => limited.text(), McpValidationError);
});

test("an oversized MCP event stream is cancelled instead of being buffered indefinitely", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(() => limitMcpResponse(response).text(), McpValidationError);
  assert.equal(cancelled, true);
});
