import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import {
  BROWSER_BACKENDS,
  KEY_NAMES,
  mergeEnvText,
  mergeOpencodeModel,
  readBrowserBackend,
  readEnvKeys,
  readModel,
  readOpencodeConfig,
  upsertBrowserBlock,
} from "@/lib/settings-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runtime settings the CLI/agent actually reads:
//   - AI model  -> opencode.json (top-level `model` / `small_model`)
//   - API keys  -> .env (repo root, gitignored; doctor.mjs loads it)
//   - browser   -> a managed block in modes/_custom.md (ALWAYS read per
//                  modes/_shared.md), so the agent honours the choice
// Reads are live; writes are merge-safe + atomic and never clobber the rest of
// the file. A key VALUE never travels back to the browser - GET returns
// booleans only.

const OPENCODE_FILE = "opencode.json";
const ENV_FILE = ".env";
const CUSTOM_FILE = path.join("modes", "_custom.md");
const CUSTOM_TEMPLATE = path.join("modes", "_custom.template.md");

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readTextIfPresent(file: string): { text: string; unreadable: boolean } {
  if (!fs.existsSync(file)) return { text: "", unreadable: false };
  try {
    return { text: fs.readFileSync(file, "utf8"), unreadable: false };
  } catch {
    return { text: "", unreadable: true };
  }
}

export async function GET() {
  const root = careerOpsRoot();

  let model = { model: "", small_model: "" };
  let malformed = false;
  try {
    const { doc } = readOpencodeConfig(path.join(root, OPENCODE_FILE));
    model = readModel(doc);
  } catch {
    // Best-effort read: a hand-broken opencode.json surfaces as `malformed`
    // rather than crashing the page. Writes still 409 on it.
    malformed = true;
  }

  const env = readTextIfPresent(path.join(root, ENV_FILE));
  const keys = readEnvKeys(env.text);
  const custom = readTextIfPresent(path.join(root, CUSTOM_FILE));

  return Response.json({
    model: model.model,
    smallModel: model.small_model,
    browser: readBrowserBackend(custom.text),
    browsers: BROWSER_BACKENDS,
    keyNames: KEY_NAMES,
    keys: Object.fromEntries(KEY_NAMES.map((k) => [k, !!keys[k]])),
    envExists: fs.existsSync(path.join(root, ENV_FILE)),
    malformed,
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const written: string[] = [];

  // --- AI model -> opencode.json ---
  const model = typeof body.model === "string" ? body.model.trim() : undefined;
  const smallModel = typeof body.smallModel === "string" ? body.smallModel.trim() : undefined;
  if (model || smallModel) {
    const file = path.join(root, OPENCODE_FILE);
    let doc: Record<string, unknown> = {};
    try {
      ({ doc } = readOpencodeConfig(file));
    } catch {
      return Response.json(
        { error: "opencode.json exists but is not valid JSON - refusing to overwrite it." },
        { status: 409 },
      );
    }
    atomicWriteWithBackup(file, JSON.stringify(mergeOpencodeModel(doc, model, smallModel), null, 2) + "\n");
    written.push(OPENCODE_FILE);
  }

  // --- API keys -> .env ---
  const rawKeys = isObj(body.keys) ? body.keys : null;
  if (rawKeys) {
    /** @type {Record<string, string>} */
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawKeys)) {
      if (!KEY_NAMES.includes(key)) continue;
      // An empty value means "leave the existing key alone" - never blank a
      // working credential because the form field was submitted empty.
      if (typeof value !== "string" || value.trim() === "") continue;
      updates[key] = value.trim();
    }
    if (Object.keys(updates).length > 0) {
      const file = path.join(root, ENV_FILE);
      const { text, unreadable } = readTextIfPresent(file);
      if (unreadable) {
        return Response.json({ error: ".env exists but could not be read - refusing to overwrite it." }, { status: 409 });
      }
      atomicWriteWithBackup(file, mergeEnvText(text, updates));
      written.push(ENV_FILE);
    }
  }

  // --- browser backend -> managed block in modes/_custom.md ---
  const browser = typeof body.browser === "string" ? body.browser : undefined;
  if (browser) {
    if (!BROWSER_BACKENDS.includes(browser)) {
      return Response.json({ error: `unknown browser backend: ${browser}` }, { status: 400 });
    }
    const file = path.join(root, CUSTOM_FILE);
    let text = "";
    if (fs.existsSync(file)) {
      const read = readTextIfPresent(file);
      if (read.unreadable) {
        return Response.json(
          { error: "modes/_custom.md exists but could not be read - refusing to overwrite it." },
          { status: 409 },
        );
      }
      text = read.text;
    } else {
      // First write: seed from the shipped template so the user keeps the
      // example house rules rather than getting a block-only file.
      const seeded = readTextIfPresent(path.join(root, CUSTOM_TEMPLATE));
      text = seeded.text || "# Custom Instructions -- career-ops\n";
    }
    atomicWriteWithBackup(file, upsertBrowserBlock(text, browser));
    written.push(CUSTOM_FILE);
  }

  if (written.length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });
  return Response.json({ ok: true, written });
}
