import fs from "node:fs";
import * as yaml from "js-yaml";

/**
 * A configuration error that lets the route distinguish a broken user-layer
 * file (409: the user must repair it) from an installation/read failure (500).
 */
export class PortalsConfigError extends Error {
  /**
   * @param {string} message
   * @param {"invalid-user-config" | "read-failed" | "invalid-template"} kind
   * @param {unknown} [cause]
   */
  constructor(message, kind, cause) {
    super(message, { cause });
    this.name = "PortalsConfigError";
    this.kind = kind;
  }
}

/** @param {unknown} value */
export function isMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Load portals.yml without treating parse/read failures as a missing file.
 * The shipped template is used only when the user-layer file is absent.
 *
 * @param {string} file
 * @param {string} templateFile
 * @returns {{ doc: Record<string, unknown>, seeded: boolean }}
 */
export function loadPortalsDocument(file, templateFile) {
  let source;
  let seeded = false;

  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw new PortalsConfigError("could not read portals.yml", "read-failed", error);
    }

    seeded = true;
    try {
      source = fs.readFileSync(templateFile, "utf8");
    } catch (templateError) {
      throw new PortalsConfigError("could not read portals template", "read-failed", templateError);
    }
  }

  let parsed;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    throw new PortalsConfigError(
      seeded ? "portals template contains invalid YAML" : "portals.yml contains invalid YAML",
      seeded ? "invalid-template" : "invalid-user-config",
      error,
    );
  }

  if (!isMapping(parsed)) {
    throw new PortalsConfigError(
      seeded ? "portals template must contain a YAML mapping" : "portals.yml must contain a YAML mapping",
      seeded ? "invalid-template" : "invalid-user-config",
    );
  }

  return { doc: parsed, seeded };
}

/**
 * Return a merge-safe document that changes only the filters owned by the web
 * onboarding flow. All scanner sources and user customizations are preserved.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} roles
 * @param {string[] | undefined} locations
 */
export function mergePortalFilters(doc, roles, locations) {
  const merged = { ...doc };
  const titleFilter = isMapping(doc.title_filter) ? { ...doc.title_filter } : {};
  titleFilter.positive = [...roles];
  merged.title_filter = titleFilter;

  if (locations?.length) {
    const locationFilter = isMapping(doc.location_filter) ? { ...doc.location_filter } : {};
    locationFilter.allow = [...locations];
    merged.location_filter = locationFilter;
  }

  return merged;
}

/** @param {unknown} value */
function asStrings(value) {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** The entry lists the UI can enable/disable, in display order. */
export const TOGGLEABLE_LISTS = ["tracked_companies", "job_boards", "search_queries"];

/** @param {Record<string, unknown>} doc */
function readEntries(doc) {
  /** @type {{ list: string, name: string, enabled: boolean }[]} */
  const entries = [];
  for (const list of TOGGLEABLE_LISTS) {
    const value = doc[list];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!isMapping(entry) || typeof entry.name !== "string") continue;
      entries.push({ list, name: entry.name, enabled: entry.enabled !== false });
    }
  }
  return entries;
}

/**
 * Read the filter blocks and the per-entry enabled flags the Portals page
 * shows. Read-only projection - nothing here writes.
 *
 * @param {Record<string, unknown>} doc
 */
export function readPortalsSettings(doc) {
  const title = isMapping(doc.title_filter) ? doc.title_filter : {};
  const location = isMapping(doc.location_filter) ? doc.location_filter : {};
  return {
    title: {
      positive: asStrings(title.positive),
      negative: asStrings(title.negative),
      seniority_boost: asStrings(title.seniority_boost),
    },
    location: {
      always_allow: asStrings(location.always_allow),
      allow: asStrings(location.allow),
      block: asStrings(location.block),
      block_hard: asStrings(location.block_hard),
    },
    entries: readEntries(doc),
  };
}

/**
 * Merge-safe writer for everything the Portals page owns: the four location
 * tiers, the three title tiers, and the per-entry `enabled` flag on
 * tracked_companies / job_boards / search_queries (matched by `name`). Every
 * other field on an entry, and every other block in the document, is
 * preserved. The input document is never mutated.
 *
 * @param {Record<string, unknown>} doc
 * @param {{ title?: Record<string, string[]>, location?: Record<string, string[]>, enabled?: { list: string, name: string, value: boolean }[] }} settings
 */
export function mergePortalsSettings(doc, settings) {
  const merged = { ...doc };

  if (settings.title) {
    const titleFilter = isMapping(doc.title_filter) ? { ...doc.title_filter } : {};
    for (const key of ["positive", "negative", "seniority_boost"]) {
      if (Array.isArray(settings.title[key])) titleFilter[key] = [...settings.title[key]];
    }
    merged.title_filter = titleFilter;
  }

  if (settings.location) {
    const locationFilter = isMapping(doc.location_filter) ? { ...doc.location_filter } : {};
    for (const key of ["always_allow", "allow", "block", "block_hard"]) {
      if (Array.isArray(settings.location[key])) locationFilter[key] = [...settings.location[key]];
    }
    merged.location_filter = locationFilter;
  }

  if (settings.enabled?.length) {
    for (const list of TOGGLEABLE_LISTS) {
      const value = merged[list];
      if (!Array.isArray(value)) continue;
      merged[list] = value.map((entry) => {
        if (!isMapping(entry) || typeof entry.name !== "string") return entry;
        const toggle = settings.enabled.find((t) => t.list === list && t.name === entry.name);
        if (!toggle) return entry;
        return { ...entry, enabled: !!toggle.value };
      });
    }
  }

  return merged;
}
