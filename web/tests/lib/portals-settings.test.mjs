import assert from "node:assert/strict";
import { test } from "node:test";
import { mergePortalsSettings, readPortalsSettings } from "../../src/lib/portals-config.mjs";

function baseDoc() {
  return {
    scan_history: "data/scan-history.tsv",
    title_filter: { positive: ["AI"], negative: ["Junior"], seniority_boost: ["Senior"] },
    location_filter: { always_allow: ["Prague"], allow: ["Remote"], block: ["India"] },
    tracked_companies: [
      { name: "Anthropic", careers_url: "https://x", enabled: true, notes: "keep me" },
      { name: "OpenAI", careers_url: "https://y", enabled: true },
    ],
    job_boards: [{ name: "SolidJobs IT", provider: "solidjobs", enabled: false }],
    search_queries: [{ name: "AI Prague", enabled: true }],
    company_aliases: { x: "y" },
  };
}

test("readPortalsSettings: projects filters and entry flags", () => {
  const s = readPortalsSettings(baseDoc());
  assert.deepEqual(s.title.positive, ["AI"]);
  assert.deepEqual(s.location.allow, ["Remote"]);
  assert.deepEqual(s.location.block_hard, []);
  assert.deepEqual(s.entries, [
    { list: "tracked_companies", name: "Anthropic", enabled: true },
    { list: "tracked_companies", name: "OpenAI", enabled: true },
    { list: "job_boards", name: "SolidJobs IT", enabled: false },
    { list: "search_queries", name: "AI Prague", enabled: true },
  ]);
});

test("readPortalsSettings: tolerates missing blocks", () => {
  const s = readPortalsSettings({});
  assert.deepEqual(s.title.positive, []);
  assert.deepEqual(s.location.always_allow, []);
  assert.deepEqual(s.entries, []);
});

test("mergePortalsSettings: toggles enabled by list+name and preserves other fields", () => {
  const doc = baseDoc();
  const merged = mergePortalsSettings(doc, {
    enabled: [
      { list: "tracked_companies", name: "Anthropic", value: false },
      { list: "job_boards", name: "SolidJobs IT", value: true },
    ],
  });
  assert.equal(merged.tracked_companies[0].enabled, false);
  assert.equal(merged.tracked_companies[0].notes, "keep me");
  assert.equal(merged.tracked_companies[0].careers_url, "https://x");
  assert.equal(merged.tracked_companies[1].enabled, true);
  assert.equal(merged.job_boards[0].enabled, true);
  assert.equal(merged.job_boards[0].provider, "solidjobs");
  // input not mutated
  assert.equal(doc.tracked_companies[0].enabled, true);
});

test("mergePortalsSettings: writes the four location tiers and three title tiers", () => {
  const merged = mergePortalsSettings(baseDoc(), {
    title: { positive: ["Platform Engineer"], negative: [], seniority_boost: ["Staff"] },
    location: { always_allow: ["Czech Republic"], allow: ["Prague", "Remote"], block: ["India"], block_hard: ["Brazil"] },
  });
  assert.deepEqual(merged.title_filter.positive, ["Platform Engineer"]);
  assert.deepEqual(merged.title_filter.negative, []);
  assert.deepEqual(merged.title_filter.seniority_boost, ["Staff"]);
  assert.deepEqual(merged.location_filter.always_allow, ["Czech Republic"]);
  assert.deepEqual(merged.location_filter.block_hard, ["Brazil"]);
});

test("mergePortalsSettings: leaves every other block untouched", () => {
  const merged = mergePortalsSettings(baseDoc(), {
    title: { positive: ["X"] },
  });
  assert.equal(merged.scan_history, "data/scan-history.tsv");
  assert.deepEqual(merged.company_aliases, { x: "y" });
  assert.equal(merged.tracked_companies.length, 2);
});

test("mergePortalsSettings: legacy roles/location shape still behaves", () => {
  const merged = mergePortalsSettings(baseDoc(), {
    title: { positive: ["Data Engineer"] },
    location: { allow: ["Brno"] },
  });
  assert.deepEqual(merged.title_filter.positive, ["Data Engineer"]);
  assert.deepEqual(merged.location_filter.allow, ["Brno"]);
  // the tiers it was not asked to change survive
  assert.deepEqual(merged.location_filter.always_allow, ["Prague"]);
  assert.deepEqual(merged.title_filter.negative, ["Junior"]);
});
