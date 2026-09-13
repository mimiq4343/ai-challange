import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SqliteConversationStore } from "../src/lib/conversation-store";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("restores a conversation after reopening SQLite and deletes it with its messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flash-agent-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");

  const firstStore = new SqliteConversationStore(databasePath);
  const conversation = firstStore.createConversation();
  firstStore.saveExchange(
    conversation.id,
    "Запомни кодовое слово: КЕДР",
    "Запомнил кодовое слово: КЕДР",
  );
  firstStore.close();

  const restoredStore = new SqliteConversationStore(databasePath);
  assert.equal(
    restoredStore.getConversation(conversation.id)?.title,
    "Запомни кодовое слово: КЕДР",
  );
  assert.deepEqual(
    restoredStore.getMessages(conversation.id).map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Запомни кодовое слово: КЕДР" },
      { role: "assistant", content: "Запомнил кодовое слово: КЕДР" },
    ],
  );

  assert.equal(restoredStore.deleteConversation(conversation.id), true);
  assert.equal(restoredStore.getConversation(conversation.id), null);
  assert.deepEqual(restoredStore.getMessages(conversation.id), []);
  restoredStore.close();
});
