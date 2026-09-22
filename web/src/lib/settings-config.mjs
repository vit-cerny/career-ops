import fs from "node:fs";

/**
 * Pure helpers behind the web Config page's runtime settings.
 *
 * Three settings, three different homes - each one chosen because it is the
 * file the runtime ACTUALLY reads:
 *   - AI model     -> opencode.json  (top-level `model` / `small_model`)
 *   - API keys     -> .env           (repo root, gitignored; doctor.mjs loads it)
 *   - browser      -> a managed block in modes/_custom.md (the agent-read
 *                     house-rule file that modes/_shared.md says is ALWAYS read)
 *
 * No IO beyond the read helpers; the route owns every write. Keeping the merge
 * logic pure is what lets `node --test` assert it (web/AGENTS.md: "a component
 * is not a place to put a rule you want to assert").
 */

/** @param {unknown} value */
export function isMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Selectable browser backends. `laya` is the local/offline engine; `jev` the MCP. */
export const BROWSER_BACKENDS = ["laya", "jev"];

/** Laya is local (no key, no network) - the sane default. */
export const DEFAULT_BROWSER = "laya";

/** Markers delimiting the managed block in modes/_custom.md. */
export const MANAGED_BEGIN = "<!-- co-web:browser -->";
export const MANAGED_END = "<!-- /co-web:browser -->";

/** AI-provider keys the Config page can write to .env. */
export const KEY_NAMES = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read opencode.json. A missing file is not an error (fresh checkout); a file
 * that exists but is not parseable IS - the caller must 409 rather than
 * overwrite a config the user hand-edited.
 *
 * @param {string} file
 * @returns {{ doc: Record<string, unknown>, missing: boolean }}
 */
export function readOpencodeConfig(file) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { doc: {}, missing: true };
    }
    throw error;
  }
  const parsed = JSON.parse(source);
  if (!isMapping(parsed)) throw new Error("opencode.json must contain a JSON object");
  return { doc: parsed, missing: false };
}

/** @param {Record<string, unknown>} doc */
export function readModel(doc) {
  return {
    model: typeof doc.model === "string" ? doc.model : "",
    small_model: typeof doc.small_model === "string" ? doc.small_model : "",
  };
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string | undefined} model
 * @param {string | undefined} smallModel
 */
export function mergeOpencodeModel(doc, model, smallModel) {
  const merged = { ...doc };
  if (model) merged.model = model;
  if (smallModel) merged.small_model = smallModel;
  return merged;
}

/**
 * Which of the known keys are set to a non-empty value. Returns booleans only -
 * a key value must never travel back to the browser.
 *
 * @param {string} text
 * @returns {Record<string, boolean>}
 */
export function readEnvKeys(text) {
  /** @type {Record<string, boolean>} */
  const set = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // trim -> strip quotes -> trim again, so `KEY="  "` counts as unset.
    const value = m[2].trim().replace(/^["']|["']$/g, "").trim();
    if (value !== "") set[m[1]] = true;
  }
  return set;
}

/** @param {string} v */
function envValue(v) {
  // dotenv strips an unquoted trailing `#comment`, so quote anything with
  // whitespace, a quote, or a `#`.
  return /[\s#"']/.test(v) ? JSON.stringify(v) : v;
}

/**
 * Upsert KEY=value pairs into an .env text, preserving every other line
 * (comments, blank lines, unrelated keys) and line order.
 *
 * @param {string} text
 * @param {Record<string, string>} values
 */
export function mergeEnvText(text, values) {
  const lines = text.length ? text.split(/\r?\n/) : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && Object.prototype.hasOwnProperty.call(values, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${envValue(String(values[m[1]]))}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) out.push(`${key}=${envValue(String(value))}`);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "") + "\n";
}

/**
 * The house rule the agent reads every session. Written in the same voice as
 * the rule it replaces, and deliberately explicit that a failed fetch is a
 * failure - never a fabricated page.
 *
 * @param {string} backend
 */
export function browserRule(backend) {
  if (backend === "jev") {
    return [
      "- **Browser tooling is the `jev` MCP.** Call `jev_search` with the target",
      "  URL and a one-line goal. If jev is unavailable, fall back to the local",
      "  Laya browser (`laya-browse <url>`).",
      "- **Never fabricate page content.** If a page cannot be loaded, report the",
      "  block and mark the verification unconfirmed.",
    ].join("\n");
  }
  return [
    "- **Browser tooling is the LOCAL Laya browser first.** Use `laya-browse <url>`",
    "  (the `laya-browser` skill) - it runs offline on this machine and needs no",
    "  API key. Fall back to the `jev` MCP (`jev_search`) when Laya is unavailable",
    "  or the page needs a real interactive Chrome (forms, WAF, login).",
    "- **Never fabricate page content.** If a page cannot be loaded, report the",
    "  block and mark the verification unconfirmed.",
  ].join("\n");
}

/**
 * Read the chosen backend out of the managed block, falling back to the
 * default when the block is absent or names nothing we recognise.
 *
 * @param {string} customText
 */
export function readBrowserBackend(customText) {
  const re = new RegExp(`${escapeRe(MANAGED_BEGIN)}([\\s\\S]*?)${escapeRe(MANAGED_END)}`);
  const match = re.exec(customText);
  if (!match) return DEFAULT_BROWSER;
  // Read the explicit marker line, NOT a word search: both rule texts mention
  // the other backend by name (the fallback), so matching on words is
  // ambiguous and would always resolve to whichever is listed first.
  const marker = /^[-*]\s*Backend:\s*([A-Za-z-]+)\s*$/m.exec(match[1]);
  const found = marker && BROWSER_BACKENDS.find((b) => b === marker[1].toLowerCase());
  return found ?? DEFAULT_BROWSER;
}

/**
 * Insert or replace the managed block, leaving the user's own house rules
 * untouched. Mirrors the marker-block contract already used for
 * modes/_profile.md notes.
 *
 * @param {string} text
 * @param {string} backend
 */
export function upsertBrowserBlock(text, backend) {
  const block = `${MANAGED_BEGIN}\n- Backend: ${backend}\n${browserRule(backend)}\n${MANAGED_END}`;
  const re = new RegExp(`${escapeRe(MANAGED_BEGIN)}[\\s\\S]*?${escapeRe(MANAGED_END)}`);
  if (re.test(text)) return text.replace(re, block);
  return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
}
