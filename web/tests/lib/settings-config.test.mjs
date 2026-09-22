import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_BACKENDS,
  DEFAULT_BROWSER,
  MANAGED_BEGIN,
  MANAGED_END,
  mergeEnvText,
  mergeOpencodeModel,
  readBrowserBackend,
  readEnvKeys,
  readModel,
  upsertBrowserBlock,
} from "../../src/lib/settings-config.mjs";

test("readModel: empty doc yields empty strings", () => {
  assert.deepEqual(readModel({}), { model: "", small_model: "" });
});

test("readModel: reads both keys, ignores non-strings", () => {
  assert.deepEqual(readModel({ model: "opencode-go/deepseek-v4-flash", small_model: 7 }), {
    model: "opencode-go/deepseek-v4-flash",
    small_model: "",
  });
});

test("mergeOpencodeModel: preserves unrelated keys and only sets what is given", () => {
  const doc = { $schema: "x", model: "a/b", theme: "dark" };
  const merged = mergeOpencodeModel(doc, "c/d", undefined);
  assert.equal(merged.model, "c/d");
  assert.equal(merged.theme, "dark");
  assert.equal(merged.$schema, "x");
  assert.equal(merged.small_model, undefined);
  // input is never mutated
  assert.equal(doc.model, "a/b");
});

test("readEnvKeys: only non-empty values count, quotes stripped", () => {
  const text = ['# comment', 'OPENAI_API_KEY=sk-abc', 'OPENROUTER_API_KEY=""', 'GEMINI_API_KEY="  "'].join("\n");
  const keys = readEnvKeys(text);
  assert.equal(keys.OPENAI_API_KEY, true);
  assert.equal(keys.OPENROUTER_API_KEY, undefined);
  assert.equal(keys.GEMINI_API_KEY, undefined);
});

test("mergeEnvText: updates in place, appends new, preserves comments and order", () => {
  const before = ["# my keys", "OPENAI_API_KEY=old", "", "OTHER=keep"].join("\n");
  const after = mergeEnvText(before, { OPENAI_API_KEY: "new", GEMINI_API_KEY: "g1" });
  const lines = after.split("\n");
  assert.equal(lines[0], "# my keys");
  assert.equal(lines[1], "OPENAI_API_KEY=new");
  assert.equal(lines[2], "");
  assert.equal(lines[3], "OTHER=keep");
  assert.ok(lines.includes("GEMINI_API_KEY=g1"));
});

test("mergeEnvText: quotes values containing spaces or hashes", () => {
  const after = mergeEnvText("", { OPENAI_API_KEY: "has space" });
  assert.equal(after, 'OPENAI_API_KEY="has space"\n');
});

test("readBrowserBackend: default when no block, parses the block otherwise", () => {
  assert.equal(readBrowserBackend(""), DEFAULT_BROWSER);
  assert.equal(readBrowserBackend("# nothing here"), DEFAULT_BROWSER);
  const withJev = upsertBrowserBlock("# Custom", "jev");
  assert.equal(readBrowserBackend(withJev), "jev");
  const withLaya = upsertBrowserBlock(withJev, "laya");
  assert.equal(readBrowserBackend(withLaya), "laya");
});

test("upsertBrowserBlock: appends once, then replaces in place", () => {
  const once = upsertBrowserBlock("# Custom\n\n## House Rules\n- keep me\n", "laya");
  assert.ok(once.includes(MANAGED_BEGIN) && once.includes(MANAGED_END));
  assert.ok(once.includes("- keep me"));
  assert.equal(once.split(MANAGED_BEGIN).length, 2);

  const twice = upsertBrowserBlock(once, "jev");
  assert.equal(twice.split(MANAGED_BEGIN).length, 2, "must not duplicate the block");
  assert.ok(twice.includes("- keep me"));
  assert.equal(readBrowserBackend(twice), "jev");
});

test("BROWSER_BACKENDS contains the default", () => {
  assert.ok(BROWSER_BACKENDS.includes(DEFAULT_BROWSER));
});
