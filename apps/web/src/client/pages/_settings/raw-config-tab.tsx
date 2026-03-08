import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { Textarea } from "@/src/components/ui/textarea";
import { apiFetch } from "@/src/lib/api-fetch";
import type { ConfigResponse } from "./types";

export function RawConfigTab({
  config,
  onConfigSaved,
}: {
  config: ConfigResponse;
  onConfigSaved: () => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRaw(JSON.stringify(config, null, 2));
  }, [config]);

  function validate(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setParseError("Config must be a JSON object.");
        return null;
      }
      setParseError(null);
      return parsed as Record<string, unknown>;
    } catch (e) {
      setParseError(
        e instanceof SyntaxError
          ? `JSON parse error: ${e.message}`
          : "Invalid JSON.",
      );
      return null;
    }
  }

  async function handleSave() {
    const parsed = validate();
    if (!parsed) return;

    try {
      setSaving(true);
      setSaveError(null);
      setSaved(false);
      const res = await apiFetch("/api/v1/config/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawConfig: parsed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.error ?? data.message ?? "Failed to save config.");
      }
      setSaved(true);
      onConfigSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save config.");
    } finally {
      setSaving(false);
    }
  }

  const hasParseError = Boolean(parseError);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Edit the raw configuration JSON. The server will validate the config
        before saving. Invalid configs will be rejected with an error message.
      </p>

      <Textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setSaved(false);
          setSaveError(null);
        }}
        className="font-mono text-[11px] leading-relaxed"
        rows={24}
        spellCheck={false}
      />

      {parseError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}
      {saveError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      {saved && !saveError && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Config saved successfully.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            validate();
          }}
          disabled={saving}
        >
          Validate JSON
        </Button>
        <Button
          size="sm"
          onClick={() => {
            handleSave().catch(() => undefined);
          }}
          disabled={saving || hasParseError}
        >
          {saving ? "Saving\u2026" : "Save config"}
        </Button>
      </div>
    </div>
  );
}
