"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Entry = { list: string; name: string; enabled: boolean };
type State = {
  seeded: boolean;
  title: { positive: string[]; negative: string[]; seniority_boost: string[] };
  location: { always_allow: string[]; allow: string[]; block: string[]; block_hard: string[] };
  entries: Entry[];
};

const LIST_LABELS: Record<string, string> = {
  tracked_companies: "Companies",
  job_boards: "Job boards",
  search_queries: "Search queries",
};

function toText(values: string[]): string {
  return values.join(", ");
}
function fromText(text: string): string[] {
  return text.split(",").map((v) => v.trim()).filter(Boolean);
}
function entryKey(e: Entry): string {
  return `${e.list}:${e.name}`;
}

export function ScanTargets() {
  const [state, setState] = useState<State | null>(null);
  const [roles, setRoles] = useState("");
  const [exclude, setExclude] = useState("");
  const [boost, setBoost] = useState("");
  const [allow, setAllow] = useState("");
  const [alwaysAllow, setAlwaysAllow] = useState("");
  const [block, setBlock] = useState("");
  const [blockHard, setBlockHard] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const res = await fetch("/api/portals");
    const data = (await res.json().catch(() => ({}))) as Partial<State> & { error?: string };
    if (!res.ok) throw new Error(data.error || "could not load portals.yml");
    const d = data as State;
    setState(d);
    setRoles(toText(d.title.positive));
    setExclude(toText(d.title.negative));
    setBoost(toText(d.title.seniority_boost));
    setAllow(toText(d.location.allow));
    setAlwaysAllow(toText(d.location.always_allow));
    setBlock(toText(d.location.block));
    setBlockHard(toText(d.location.block_hard));
    const next: Record<string, boolean> = {};
    for (const e of d.entries) next[entryKey(e)] = e.enabled;
    setEnabled(next);
  }

  useEffect(() => {
    refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : "could not load portals.yml"));
  }, []);

  function setAll(value: boolean) {
    if (!state) return;
    const next: Record<string, boolean> = {};
    for (const e of state.entries) next[entryKey(e)] = value;
    setEnabled(next);
  }

  async function save() {
    if (!state) return;
    setError("");
    const body = {
      title: {
        positive: fromText(roles),
        negative: fromText(exclude),
        seniority_boost: fromText(boost),
      },
      locationFilter: {
        allow: fromText(allow),
        always_allow: fromText(alwaysAllow),
        block: fromText(block),
        block_hard: fromText(blockHard),
      },
      enabled: state.entries.map((e) => ({ list: e.list, name: e.name, value: !!enabled[entryKey(e)] })),
    };
    const res = await fetch("/api/portals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error || "save failed");
      return;
    }
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (state === null) {
    return error ? (
      <p className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">{error}</p>
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading scan targets…
      </div>
    );
  }

  const byList = new Map<string, Entry[]>();
  for (const e of state.entries) {
    const arr = byList.get(e.list) ?? [];
    arr.push(e);
    byList.set(e.list, arr);
  }
  const selected = state.entries.filter((e) => enabled[entryKey(e)]).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="mb-3 text-sm font-medium text-foreground">What to look for</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role keywords (match any)" value={roles} onChange={setRoles} placeholder="Platform Engineer, AI, ML" />
          <Field label="Exclude" value={exclude} onChange={setExclude} placeholder="Junior, Intern" />
          <Field label="Seniority boost" value={boost} onChange={setBoost} placeholder="Senior, Staff" />
          <Field label="Locations (match any)" value={allow} onChange={setAllow} placeholder="Prague, Brno, Remote" />
          <Field label="Always allow" value={alwaysAllow} onChange={setAlwaysAllow} placeholder="Czech Republic" />
          <Field label="Block" value={block} onChange={setBlock} placeholder="India, London" />
          <Field label="Block hard (never overridden)" value={blockHard} onChange={setBlockHard} placeholder="Brazil" />
        </div>
        <p className="mt-3 text-xs text-faint">
          Comma-separated, case-insensitive substring match. There is no geographic radius - list the cities you accept.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-foreground">
            Portals to scan <span className="text-muted">({selected}/{state.entries.length})</span>
          </p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setAll(true)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand">
              All
            </button>
            <button type="button" onClick={() => setAll(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand">
              None
            </button>
          </div>
        </div>
        {state.entries.length === 0 ? (
          <p className="text-xs text-faint">No portals in portals.yml yet.</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {[...byList.entries()].map(([list, entries]) => (
              <div key={list}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
                  {LIST_LABELS[list] ?? list}
                </p>
                <ul className="space-y-1">
                  {entries.map((e) => {
                    const on = !!enabled[entryKey(e)];
                    return (
                      <li key={entryKey(e)}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-surface-hover">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setEnabled((prev) => ({ ...prev, [entryKey(e)]: !on }))}
                            className="size-4 accent-[var(--brand,currentColor)]"
                          />
                          <span className={cn("truncate", on ? "text-foreground" : "text-muted line-through")}>{e.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
        >
          {saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : "Save scan targets"}
        </button>
        <span className="text-xs text-faint">Writes portals.yml (gitignored) · read by scan.mjs</span>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
      />
    </label>
  );
}
