import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeMcpRequest } from "../src/lib/mcp-auth";

const token = "a".repeat(64);

test("protected MCP rejects missing credentials and never accepts a profile without authentication", () => {
  assert.equal(authorizeMcpRequest({ "x-flash-profile-id": "1" }, token).status, 401);
  assert.equal(authorizeMcpRequest({ authorization: `Bearer ${"b".repeat(64)}`, "x-flash-profile-id": "1" }, token).status, 401);
  assert.equal(authorizeMcpRequest({ authorization: `Bearer ${token}` }, undefined).status, 503);
});

test("protected MCP accepts only a single authenticated positive safe profile identifier", () => {
  assert.deepEqual(authorizeMcpRequest({ authorization: `Bearer ${token}`, "x-flash-profile-id": "12" }, token), { status: 200, profileId: 12 });
  for (const profile of ["0", "-1", "1e2", "1.1", "01", "9007199254740992", ["1", "2"]]) {
    assert.equal(authorizeMcpRequest({ authorization: `Bearer ${token}`, "x-flash-profile-id": profile }, token).status, 400);
  }
  assert.equal(authorizeMcpRequest({ authorization: `Bearer ${token}, Bearer ${token}`, "x-flash-profile-id": "1" }, token).status, 401);
});
