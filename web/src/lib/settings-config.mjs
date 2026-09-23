import fs from "node:fs";

export const BROWSER_BACKENDS = ["laya", "jev"];
export const DEFAULT_BROWSER = "laya";
export const MANAGED_BEGIN = "<!-- co-web:browser -->";
export const MANAGED_END = "<!-- /co-web:browser -->";
export const KEY_NAMES = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

export function isMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
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

/**
 * @param {Record<string, unknown>} doc
 */
export function readModel(doc) {
  return {
    model: typeof doc.model === "string" ? doc.model : "",
    small_model: typeof doc.small_model === "string" ? doc.small_model : "",
  };
}

export function mergeOpencodeModel(doc, model, smallModel) {
  const merged = { ...doc };
  if (model) merged.model = model;
  if (smallModel) merged.small_model = smallModel;
  return merged;
}

/**
 * @param {string} text
 * @returns {Record<string, boolean>}
 */
export function readEnvKeys(text) {
  const set = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "").trim();
    if (value !== "") set[m[1]] = true;
  }
  return set;
}

function envValue(v) {
  // dotenv strips an unquoted trailing `#comment`, so quote anything that has one.
  return /[\s#"']/.test(v) ? JSON.stringify(v) : v;
}

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

export function readBrowserBackend(customText) {
  const re = new RegExp(`${escapeRe(MANAGED_BEGIN)}([\\s\\S]*?)${escapeRe(MANAGED_END)}`);
  const match = re.exec(customText);
  if (!match) return DEFAULT_BROWSER;
  // Read the explicit marker, not a word search: both rule texts name the other
  // backend as the fallback, so a word match always resolves to whichever is first.
  const marker = /^[-*]\s*Backend:\s*([A-Za-z-]+)\s*$/m.exec(match[1]);
  const found = marker && BROWSER_BACKENDS.find((b) => b === marker[1].toLowerCase());
  return found ?? DEFAULT_BROWSER;
}

export function upsertBrowserBlock(text, backend) {
  const block = `${MANAGED_BEGIN}\n- Backend: ${backend}\n${browserRule(backend)}\n${MANAGED_END}`;
  const re = new RegExp(`${escapeRe(MANAGED_BEGIN)}[\\s\\S]*?${escapeRe(MANAGED_END)}`);
  if (re.test(text)) return text.replace(re, block);
  return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
}
