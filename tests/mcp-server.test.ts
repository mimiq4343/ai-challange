import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createDemoMcpServer } from "../src/lib/mcp-demo-server";

test("the advertised addition tool executes numeric inputs and rejects invalid results", async (t) => {
  const server = createDemoMcpServer();
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({ name: "add", arguments: { a: 2.5, b: -0.5 } });
  assert.deepEqual(result.structuredContent, { sum: 2 });
  assert.deepEqual(result.content, [{ type: "text", text: "2" }]);

  const invalid = await client.callTool({ name: "add", arguments: { a: "2", b: 3 } });
  assert.equal(invalid.isError, true);
  const overflow = await client.callTool({ name: "add", arguments: { a: Number.MAX_VALUE, b: Number.MAX_VALUE } });
  assert.equal(overflow.isError, true);
  assert.equal(overflow.structuredContent, undefined);
});
