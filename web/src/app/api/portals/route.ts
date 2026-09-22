import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import {
  loadPortalsDocument,
  mergePortalsSettings,
  readPortalsSettings,
  PortalsConfigError,
} from "@/lib/portals-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe reader/writer for the parts of portals.yml the web owns: the
// title and location filter tiers, and the per-entry `enabled` flag on
// tracked_companies / job_boards / search_queries. Everything else - every
// other block, every other field on an entry - is preserved. Seeds from
// templates/portals.example.yml on first create; a portals.yml that EXISTS but
// cannot be parsed is a 409, never overwritten. Atomic write.
//
// The legacy `{ roles, location }` body (used by the assistant's confirm-gated
// setPortals action) still works unchanged.

const LIST_KEYS = ["tracked_companies", "job_boards", "search_queries"];
const TITLE_KEYS = ["positive", "negative", "seniority_boost"];
const LOCATION_KEYS = ["always_allow", "allow", "block", "block_hard"];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function loadDoc(root: string) {
  return loadPortalsDocument(
    path.join(root, "portals.yml"),
    path.join(root, "templates", "portals.example.yml"),
  );
}

function loadError(error: unknown) {
  const invalidUserConfig = error instanceof PortalsConfigError && error.kind === "invalid-user-config";
  return Response.json(
    { error: error instanceof Error ? error.message : "could not load portals.yml" },
    { status: invalidUserConfig ? 409 : 500 },
  );
}

export async function GET() {
  try {
    const { doc, seeded } = loadDoc(careerOpsRoot());
    return Response.json({ seeded, ...readPortalsSettings(doc) });
  } catch (error) {
    return loadError(error);
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  /** @type {{ title?: Record<string, string[]>, location?: Record<string, string[]>, enabled?: { list: string, name: string, value: boolean }[] }} */
  const settings: {
    title?: Record<string, string[]>;
    location?: Record<string, string[]>;
    enabled?: { list: string; name: string; value: boolean }[];
  } = {};

  // Legacy body: { roles, location }
  const roles = cleanList(body.roles);
  if (roles?.length) settings.title = { positive: roles.slice(0, 24) };
  const legacyLocation = cleanList(body.location);
  if (legacyLocation?.length) settings.location = { allow: legacyLocation };

  // Filter tiers
  if (isObj(body.title)) {
    /** @type {Record<string, string[]>} */
    const title: Record<string, string[]> = {};
    for (const key of TITLE_KEYS) {
      const list = cleanList(body.title[key]);
      if (list) title[key] = list;
    }
    if (Object.keys(title).length) settings.title = { ...(settings.title ?? {}), ...title };
  }
  if (isObj(body.locationFilter)) {
    /** @type {Record<string, string[]>} */
    const location: Record<string, string[]> = {};
    for (const key of LOCATION_KEYS) {
      const list = cleanList(body.locationFilter[key]);
      if (list) location[key] = list;
    }
    if (Object.keys(location).length) settings.location = { ...(settings.location ?? {}), ...location };
  }

  // Per-entry enable/disable
  if (Array.isArray(body.enabled)) {
    const toggles = body.enabled
      .filter(isObj)
      .filter((t) => LIST_KEYS.includes(String(t.list)) && typeof t.name === "string")
      .map((t) => ({ list: String(t.list), name: String(t.name), value: !!t.value }));
    if (toggles.length) settings.enabled = toggles;
  }

  if (!settings.title && !settings.location && !settings.enabled) {
    return Response.json({ error: "nothing to write" }, { status: 400 });
  }

  const root = careerOpsRoot();
  let doc: Record<string, unknown>;
  try {
    ({ doc } = loadDoc(root));
  } catch (error) {
    return loadError(error);
  }

  const merged = mergePortalsSettings(doc, settings);
  try {
    atomicWriteWithBackup(path.join(root, "portals.yml"), yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, ...readPortalsSettings(merged) });
}
