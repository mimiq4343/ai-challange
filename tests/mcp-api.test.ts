import assert from "node:assert/strict";
import { test } from "node:test";

import { validateMcpMutation } from "../src/lib/mcp-api";

test("MCP mutations accept the browser Host when Next uses an internal request URL", () => {
  const request = new Request("http://0.0.0.0:3000/api/mcp-servers", {
    method: "POST",
    headers: {
      host: "10.43.228.165:3000",
      origin: "http://10.43.228.165:3000",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(validateMcpMutation(request), null);
});

test("MCP mutation origin checks do not trust forwarded headers or other sites", () => {
  for (const extra of [
    { origin: "https://attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
    { origin: "http://10.43.228.165:3000", "sec-fetch-site": "cross-site" },
    { origin: "http://10.43.228.165:3000", "sec-fetch-site": "same-site" },
    { origin: "null" },
  ]) {
    const headers = new Headers({ host: "10.43.228.165:3000", "content-type": "application/json" });
    for (const [name, value] of Object.entries(extra)) if (value !== undefined) headers.set(name, value);
    const response = validateMcpMutation(new Request("http://0.0.0.0:3000/api/mcp-servers", {
      method: "POST", headers, body: "{}",
    }));
    assert.equal(response?.status, 403);
  }
});
