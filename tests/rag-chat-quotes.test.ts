import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteOptions, resolveQuoteSelection } from "../src/lib/rag-chat-quotes";

test("selected quote IDs restore exact whitespace and reject invented or foreign quote IDs", () => {
  const source = { id: "S1", text: "First paragraph with evidence.\n\n  database.exec(`\n    PRAGMA foreign_keys = ON;\n  `);\n" };
  const options = quoteOptions(source.text);
  const selected = options.find((option) => option.text.includes("database.exec"))!;
  const result = resolveQuoteSelection(JSON.stringify({ status: "answered", answer: "Foreign keys enabled [S1].", clarification: null, sources: [], quotes: [{ sourceId: "S1", quoteId: selected.id }] }), [{ ...source, quoteOptions: options }]);
  assert.equal(JSON.parse(result).quotes[0].text, selected.text);
  assert.ok(source.text.includes(JSON.parse(result).quotes[0].text));
  for (const quote of [{ sourceId: "S1", quoteId: "invented" }, { sourceId: "S99", quoteId: selected.id }, { sourceId: "S1", text: "reconstructed quote" }]) {
    assert.throws(() => resolveQuoteSelection(JSON.stringify({ quotes: [quote] }), [{ ...source, quoteOptions: options }]), /цитат/i);
  }
});
