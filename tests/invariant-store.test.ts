import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  DuplicateInvariantError,
  InvariantNotFoundError,
  SqliteInvariantStore,
} from "../src/lib/invariant-store";
import { SqliteProfileStore } from "../src/lib/profile-store";

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createStores() {
  const directory = await mkdtemp(join(tmpdir(), "flash-invariant-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "chat.sqlite");
  const profiles = new SqliteProfileStore(databasePath);
  const invariants = new SqliteInvariantStore(databasePath);
  return { profiles, invariants, profileId: profiles.getActiveProfile().id };
}

test("an invariant is created once and logged", async () => {
  const { profiles, invariants, profileId } = await createStores();
  const created = invariants.create(
    profileId,
    {
      category: "stack",
      statement: "Только PostgreSQL, без ORM",
      rationale: "команда держит SQL под контролем",
    },
    "user",
  );

  assert.equal(created.status, "active");
  assert.equal(created.blockedCount, 0);
  assert.deepEqual(
    invariants.listActive(profileId).map((invariant) => invariant.statement),
    ["Только PostgreSQL, без ORM"],
  );
  assert.equal(invariants.listEvents(profileId)[0].kind, "created");

  assert.throws(
    () =>
      invariants.create(
        profileId,
        { category: "stack", statement: "Только PostgreSQL, без ORM", rationale: null },
        "user",
      ),
    DuplicateInvariantError,
  );

  invariants.close();
  profiles.close();
});

test("retiring keeps the rule in history and stops enforcing it", async () => {
  const { profiles, invariants, profileId } = await createStores();
  const rule = invariants.create(
    profileId,
    { category: "architecture", statement: "Монолит до 100k MAU", rationale: null },
    "user",
  );

  invariants.setStatus(rule.id, "retired");
  assert.equal(invariants.listActive(profileId).length, 0);
  assert.equal(invariants.listInvariants(profileId).length, 1);
  assert.equal(invariants.listEvents(profileId)[0].kind, "retired");

  invariants.setStatus(rule.id, "active");
  assert.equal(invariants.listActive(profileId).length, 1);
  assert.equal(invariants.listEvents(profileId)[0].kind, "restored");

  assert.throws(() => invariants.setStatus(9_999, "retired"), InvariantNotFoundError);

  invariants.close();
  profiles.close();
});

test("a blocked request bumps the counter and writes the journal", async () => {
  const { profiles, invariants, profileId } = await createStores();
  const rule = invariants.create(
    profileId,
    { category: "stack", statement: "Только PostgreSQL", rationale: null },
    "user",
  );

  invariants.recordViolation({
    profileId,
    invariantIds: [rule.id],
    request: "Давай возьмём MongoDB",
    explanation: "MongoDB — другая СУБД",
    conversationId: null,
  });

  assert.equal(invariants.getInvariant(rule.id)?.blockedCount, 1);
  const event = invariants.listEvents(profileId)[0];
  assert.equal(event.kind, "violation_blocked");
  assert.equal(event.invariantId, rule.id);
  assert.equal(event.statement, "Давай возьмём MongoDB");
  assert.equal(event.detail, "MongoDB — другая СУБД");

  invariants.close();
  profiles.close();
});

test("proposals skip duplicates and become invariants on acceptance", async () => {
  const { profiles, invariants, profileId } = await createStores();
  invariants.create(
    profileId,
    { category: "stack", statement: "Только PostgreSQL", rationale: null },
    "user",
  );

  const saved = invariants.saveProposals(
    profileId,
    [
      { category: "stack", statement: "Только PostgreSQL", rationale: null },
      { category: "business_rule", statement: "Возврат средств за 14 дней", rationale: null },
      { category: "business_rule", statement: "Возврат средств за 14 дней", rationale: null },
    ],
    null,
  );
  assert.equal(saved, 1);

  const [proposal] = invariants.listProposals(profileId);
  const accepted = invariants.acceptProposal(proposal.id);
  assert.equal(accepted.statement, "Возврат средств за 14 дней");
  assert.equal(accepted.origin, "agent");
  assert.equal(invariants.listProposals(profileId).length, 0);
  assert.equal(
    invariants.listEvents(profileId).some((event) => event.kind === "proposal_accepted"),
    true,
  );

  invariants.close();
  profiles.close();
});

test("rejecting a proposal leaves a trace and no rule", async () => {
  const { profiles, invariants, profileId } = await createStores();
  invariants.saveProposals(
    profileId,
    [{ category: "tech_decision", statement: "Очередь только на Kafka", rationale: null }],
    null,
  );

  const [proposal] = invariants.listProposals(profileId);
  assert.equal(invariants.discardProposal(proposal.id), true);
  assert.equal(invariants.listProposals(profileId).length, 0);
  assert.equal(invariants.listActive(profileId).length, 0);
  assert.equal(invariants.listEvents(profileId)[0].kind, "proposal_rejected");
  assert.equal(invariants.discardProposal(proposal.id), false);

  invariants.close();
  profiles.close();
});

test("invariants are isolated per profile and die with it", async () => {
  const { profiles, invariants, profileId } = await createStores();
  const second = profiles.createProfile({ name: "Второй" });
  invariants.create(
    profileId,
    { category: "stack", statement: "Только PostgreSQL", rationale: null },
    "user",
  );
  invariants.create(
    second.id,
    { category: "stack", statement: "Только MySQL", rationale: null },
    "user",
  );

  assert.equal(invariants.listActive(profileId).length, 1);
  assert.equal(invariants.listActive(second.id).length, 1);

  profiles.deleteProfile(second.id);
  assert.equal(invariants.listActive(second.id).length, 0);
  assert.equal(invariants.listActive(profileId).length, 1);

  invariants.close();
  profiles.close();
});
