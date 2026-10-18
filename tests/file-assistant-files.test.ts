import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ProjectFiles, applyFileProposal } from "../src/lib/file-assistant-files";

let root: string;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-assistant-"));
  git("init", "-q", "-b", "day-34");
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "src/button.tsx"), "export function Button() {}\n");
  writeFileSync(join(root, "src/page.tsx"), "import { Button } from './button';\nexport const page = Button;\n");
  writeFileSync(join(root, "docs/api.md"), "# API\n\nСтарая документация.\n");
  writeFileSync(join(root, "AGENTS.md"), "# Rules\n");
  writeFileSync(join(root, ".gitignore"), ".env*\ndata/\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("reads actual lines with a whole-file hash and searches across source files", () => {
  const files = new ProjectFiles(root);
  const read = files.read("src/page.tsx", 2, 2);
  assert.equal(read.content, "export const page = Button;");
  assert.match(read.hash, /^[a-f0-9]{64}$/);
  assert.equal(read.startLine, 2);
  assert.equal(read.endLine, 2);
  const found = files.search("Button", "src");
  assert.deepEqual(found.matches.map(match => [match.path, match.line]), [["src/button.tsx", 1], ["src/page.tsx", 1], ["src/page.tsx", 2]]);
  assert.equal(found.truncated, false);
  assert.deepEqual(found.skipped, []);
});

test("secrets, private data, traversal and symbolic links are outside file access", () => {
  const files = new ProjectFiles(root);
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, ".env.local"), "SECRET=hidden");
  writeFileSync(join(root, "data/private.json"), "hidden");
  symlinkSync(join(root, ".env.local"), join(root, "src/leak.ts"));
  symlinkSync(join(root, "data"), join(root, "docs/linked"));
  git("add", "src/leak.ts", "docs/linked");
  for (const path of ["../README.md", "/etc/passwd", ".env.local", "data/private.json", "src/leak.ts", "docs/linked/private.md"]) {
    assert.throws(() => files.read(path));
  }
  assert.equal(files.search("hidden").matches.length, 0);
});

test("preparing an update stores a diff without changing the file; applying writes once", () => {
  const files = new ProjectFiles(root);
  const before = files.read("docs/api.md");
  const proposal = files.propose("docs/api.md", before.hash, "# API\n\nНовая документация.\n");
  assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "# API\n\nСтарая документация.\n");
  assert.match(proposal.patch, /--- a\/docs\/api.md/);
  assert.match(proposal.patch, /\+Новая документация/);
  assert.equal(proposal.status, "pending");
  const applied = applyFileProposal(root, proposal.id);
  assert.equal(applied.status, "applied");
  assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "# API\n\nНовая документация.\n");
  assert.equal(applyFileProposal(root, proposal.id).status, "applied");
});

test("creates a new document and makes it available to subsequent reading and search", () => {
  const files = new ProjectFiles(root);
  const proposal = files.propose("docs/adr/new.md", null, "# ADR\n\nButton architecture.\n");
  assert.match(proposal.patch, /--- \/dev\/null/);
  applyFileProposal(root, proposal.id);
  assert.equal(new ProjectFiles(root).read("docs/adr/new.md").content, "# ADR\n\nButton architecture.\n");
  assert.ok(new ProjectFiles(root).search("architecture").matches.some(match => match.path === "docs/adr/new.md"));
});

test("refuses stale targets and a file appearing after a create proposal", () => {
  const files = new ProjectFiles(root);
  const before = files.read("docs/api.md");
  const update = files.propose("docs/api.md", before.hash, "# Changed\n");
  writeFileSync(join(root, "docs/api.md"), "Human edit\n");
  assert.throws(() => applyFileProposal(root, update.id), /изменился/);
  assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "Human edit\n");
  const create = files.propose("docs/new.md", null, "# New\n");
  writeFileSync(join(root, "docs/new.md"), "Human file\n");
  assert.throws(() => applyFileProposal(root, create.id), /изменился|существует/);
  assert.equal(readFileSync(join(root, "docs/new.md"), "utf8"), "Human file\n");
});

test("requires a fresh target read and allows writes only to product Markdown", () => {
  const files = new ProjectFiles(root);
  assert.throws(() => files.propose("docs/api.md", "a".repeat(64), "# New\n"), /прочитать/);
  for (const path of ["src/button.tsx", "AGENTS.md", "docs/AGENTS.md", "docs/CLAUDE.md", "docs/SKILL.md", "docs/.hidden.md", ".harness/report.md"]) {
    assert.throws(() => files.propose(path, null, "new\n"));
  }
  const read = files.read("docs/api.md");
  writeFileSync(join(root, "docs/api.md"), "Other\n");
  assert.throws(() => files.propose("docs/api.md", read.hash, "new\n"), /изменился/);
});

test("a proposal cannot apply to a different branch or through a replaced directory", () => {
  const files = new ProjectFiles(root);
  const branchProposal = files.propose("docs/new.md", null, "# New\n");
  git("switch", "-qc", "other");
  assert.throws(() => applyFileProposal(root, branchProposal.id), /ветка|HEAD/);
  git("switch", "-q", "day-34");
  const linkProposal = files.propose("docs/linked/new.md", null, "# New\n");
  mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(root, "docs/linked"));
  assert.throws(() => applyFileProposal(root, linkProposal.id), /ссылк/);
});

test("search explicitly reports skipped non-text and oversized files", () => {
  writeFileSync(join(root, "src/large.ts"), "x".repeat(300_000));
  writeFileSync(join(root, "src/binary.ts"), Buffer.from([0, 1, 2]));
  git("add", "src/large.ts", "src/binary.ts");
  const result = new ProjectFiles(root).search("Button");
  assert.deepEqual(result.skipped.map(item => item.path).sort(), ["src/binary.ts", "src/large.ts"]);
  assert.equal(result.truncated, false);
});

test("a focused replacement preserves a large README and rejects ambiguous matches", () => {
  const content = "# README\n" + "Existing text\n".repeat(7_000) + "Unique section\n";
  writeFileSync(join(root, "README.md"), content);
  git("add", "README.md");
  const files = new ProjectFiles(root);
  const read = files.read("README.md", 7_002);
  const proposal = files.propose("README.md", read.hash, [{ oldText: "Unique section", newText: "Updated section" }]);
  applyFileProposal(root, proposal.id);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), content.replace("Unique section", "Updated section"));
  const fresh = files.read("README.md");
  assert.throws(() => files.propose("README.md", fresh.hash, [{ oldText: "Existing text", newText: "Other" }]), /один раз|неоднознач/);
});

test("diff preserves hunk lines resembling file headers", () => {
  writeFileSync(join(root, "docs/api.md"), "# Example\n-- old text\n");
  const files = new ProjectFiles(root);
  const read = files.read("docs/api.md");
  const proposal = files.propose("docs/api.md", read.hash, "# Example\n++ new text\n");
  assert.ok(proposal.patch.includes("\n--- old text\n"), proposal.patch);
  assert.ok(proposal.patch.includes("\n+++ new text\n"), proposal.patch);
  assert.match(proposal.patch, /--- a\/docs\/api.md\n\+\+\+ b\/docs\/api.md/);
  applyFileProposal(root, proposal.id);
  assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), "# Example\n++ new text\n");
});
