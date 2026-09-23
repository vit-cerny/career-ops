"use client";

import { useEffect, useState } from "react";
import { Check, Cpu, Compass, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Settings = {
  model: string;
  smallModel: string;
  browser: string;
  browsers: string[];
  keyNames: string[];
  keys: Record<string, boolean>;
  envExists: boolean;
  malformed: boolean;
};

const BROWSER_LABELS: Record<string, string> = {
  laya: "Local Laya first, jev fallback",
  jev: "jev MCP only",
};

const BROWSER_HINTS: Record<string, string> = {
  laya: "Runs offline on this machine, no API key. Falls back to jev when Laya can't load a page.",
  jev: "Drives a real Chrome through the jev MCP. Needs the jev MCP enabled in opencode.",
};

export function SettingsPanel() {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [smallModel, setSmallModel] = useState("");
  const [browser, setBrowser] = useState("laya");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error("could not load settings");
    const d = (await res.json()) as Settings;
    setLoaded(d);
    setModel(d.model || "");
    setSmallModel(d.smallModel || "");
    setBrowser(d.browser || "laya");
  }

  useEffect(() => {
    refresh().catch(() => setError("Could not load settings."));
  }, []);

  async function save() {
    setError("");
    const body: Record<string, unknown> = { browser };
    if (model.trim()) body.model = model.trim();
    if (smallModel.trim()) body.smallModel = smallModel.trim();
    const filled: Record<string, string> = {};
    for (const [name, value] of Object.entries(keys)) {
      if (value.trim()) filled[name] = value.trim();
    }
    if (Object.keys(filled).length > 0) body.keys = filled;

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error || "Save failed.");
      return;
    }
    setKeys({});
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mt-8">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Runtime settings
      </label>
      <p className="mb-3 text-xs text-faint">
        These write the files career-ops actually reads: <span className="text-muted">opencode.json</span> (model),{" "}
        <span className="text-muted">.env</span> (keys, gitignored) and <span className="text-muted">modes/_custom.md</span>{" "}
        (browser rule).
      </p>

      {loaded === null ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading settings…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Model */}
          <div className="rounded-xl border border-border bg-surface/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Cpu className="size-4 text-brand" />
              <span className="text-sm font-medium text-foreground">AI model</span>
            </div>
            {loaded.malformed ? (
              <p className="text-xs text-amber-400">
                opencode.json exists but is not valid JSON. Fix it by hand before saving — a save would refuse.
              </p>
            ) : null}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="opencode-go/deepseek-v4-flash"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
            />
            <input
              value={smallModel}
              onChange={(e) => setSmallModel(e.target.value)}
              placeholder="small_model (optional, e.g. opencode-go/deepseek-v4-flash)"
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-border bg-surface/60 px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
            />
          </div>

          {/* Browser backend */}
          <div className="rounded-xl border border-border bg-surface/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Compass className="size-4 text-brand" />
              <span className="text-sm font-medium text-foreground">Browser backend</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {loaded.browsers.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBrowser(b)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    browser === b
                      ? "border-brand/50 bg-brand-soft text-foreground"
                      : "border-border bg-surface/50 text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <span className="block font-medium">{BROWSER_LABELS[b] ?? b}</span>
                  <span className="mt-0.5 block text-xs text-faint">{BROWSER_HINTS[b] ?? ""}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API keys */}
          <div className="rounded-xl border border-border bg-surface/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <KeyRound className="size-4 text-brand" />
              <span className="text-sm font-medium text-foreground">API keys</span>
            </div>
            <p className="mb-3 text-xs text-faint">
              Written to <span className="text-muted">.env</span> in the project root (gitignored). Leave a field blank to
              keep the existing key. Values are never sent back to this page.
            </p>
            <div className="space-y-2">
              {loaded.keyNames.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 font-mono text-xs text-muted">{name}</span>
                  {loaded.keys[name] ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <Check className="size-3" /> set
                    </span>
                  ) : (
                    <span className="text-xs text-faint">not set</span>
                  )}
                  <input
                    type="password"
                    value={keys[name] ?? ""}
                    onChange={(e) => setKeys((k) => ({ ...k, [name]: e.target.value }))}
                    placeholder={loaded.keys[name] ? "•••••• (replace)" : "paste key"}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface/60 px-3 py-1.5 font-mono text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/50"
                  />
                </div>
              ))}
            </div>
          </div>

          {error ? <p className="text-xs text-red-400">{error}</p> : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
            >
              {saved ? <Check className="size-4" /> : null}
              {saved ? "Saved" : "Save runtime settings"}
            </button>
            <span className="text-xs text-faint">
              Model → opencode.json · keys → .env · browser → modes/_custom.md
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
