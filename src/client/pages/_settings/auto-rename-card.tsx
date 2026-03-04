import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Switch } from "@/src/components/ui/switch";
import { apiFetch } from "@/src/lib/api-fetch";
import type { ConfigResponse } from "./types";

export function AutoRenameCard({
  config,
  onConfigChange,
}: {
  config: ConfigResponse;
  onConfigChange: () => void;
}) {
  const providers = useMemo(() => config.autoRenameProviders ?? [], [config.autoRenameProviders]);
  const existing = config.autoRename;

  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [provider, setProvider] = useState(
    existing?.provider ?? providers[0]?.id ?? "",
  );
  const [modelId, setModelId] = useState(() => {
    const saved = existing?.modelId ?? "";
    if (!saved) return "";
    const providerObj = providers.find(
      (p) => p.id === (existing?.provider ?? providers[0]?.id ?? ""),
    );
    const inList = providerObj?.cheapModels?.some((m) => m.id === saved);
    return inList ? saved : "__custom__";
  });
  const [customModelId, setCustomModelId] = useState(() => {
    const saved = existing?.modelId ?? "";
    if (!saved) return "";
    const providerObj = providers.find(
      (p) => p.id === (existing?.provider ?? providers[0]?.id ?? ""),
    );
    const inList = providerObj?.cheapModels?.some((m) => m.id === saved);
    return inList ? "" : saved;
  });
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnabled(existing?.enabled ?? false);
    setProvider(existing?.provider ?? providers[0]?.id ?? "");
    const saved = existing?.modelId ?? "";
    const providerObj = providers.find(
      (p) => p.id === (existing?.provider ?? providers[0]?.id ?? ""),
    );
    const inList = providerObj?.cheapModels?.some((m) => m.id === saved);
    if (saved && !inList) {
      setModelId("__custom__");
      setCustomModelId(saved);
    } else {
      setModelId(saved);
      setCustomModelId("");
    }
    setApiKey("");
  }, [existing?.enabled, existing?.provider, existing?.modelId, providers]);

  const selectedProvider = providers.find((p) => p.id === provider);
  const models = useMemo(() => selectedProvider?.cheapModels ?? [], [selectedProvider?.cheapModels]);

  // When provider changes, auto-select first model if current isn't in new list (skip if custom)
  useEffect(() => {
    if (modelId !== "__custom__" && modelId && !models.some((m) => m.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [provider, models, modelId]);

  const effectiveModelId = modelId === "__custom__" ? customModelId : modelId;

  async function handleSave() {
    if (enabled && !provider) {
      setError("Provider is required.");
      return;
    }
    if (enabled && !effectiveModelId) {
      setError("Model is required.");
      return;
    }
    try {
      setError(null);
      setValidationError(null);
      setSaved(false);

      // Validate key when enabling
      if (enabled) {
        setValidating(true);
        const valBody: Record<string, string> = { provider, modelId: effectiveModelId };
        if (apiKey.trim()) valBody.apiKey = apiKey.trim();
        const valRes = await apiFetch("/api/v1/config/admin/validate-auto-rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(valBody),
        });
        if (!valRes.ok) {
          const data = (await valRes.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          setValidationError(
            data.error?.message ?? "API key validation failed.",
          );
          setValidating(false);
          return;
        }
        setValidating(false);
      }

      // Save config
      setSaving(true);
      const payload: Record<string, unknown> = {
        enabled,
        provider,
        modelId: effectiveModelId,
      };
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim();
      }

      const res = await apiFetch("/api/v1/config/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRename: payload }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          data.error ?? data.message ?? "Failed to save auto-rename settings.",
        );
      }
      setApiKey("");
      setSaved(true);
      onConfigChange();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to save auto-rename settings.",
      );
    } finally {
      setValidating(false);
      setSaving(false);
    }
  }

  const busy = validating || saving;
  const buttonLabel = validating
    ? "Validating\u2026"
    : saving
      ? "Saving\u2026"
      : "Save";

  return (
    <Card>
      <CardHeader className="p-0">
        <CardTitle className="text-sm">Auto-rename chats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <p className="text-xs text-muted-foreground">
          Automatically generate chat titles from conversation content using a
          cheap AI model.
        </p>

        <div className="flex items-center justify-between">
          <span className="text-sm">Enable auto-rename</span>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setSaved(false);
              setError(null);
              setValidationError(null);
            }}
          />
        </div>

        {enabled && (
          <>
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={provider}
                onValueChange={(val) => {
                  setProvider(val);
                  setSaved(false);
                  setError(null);
                  setValidationError(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.name}
                        {p.hasEnvKey && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0"
                          >
                            key detected
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select
                value={modelId}
                onValueChange={(val) => {
                  setModelId(val);
                  setSaved(false);
                  setError(null);
                  setValidationError(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom model…</SelectItem>
                </SelectContent>
              </Select>
              {modelId === "__custom__" && (
                <Input
                  value={customModelId}
                  onChange={(e) => {
                    setCustomModelId(e.target.value);
                    setSaved(false);
                    setError(null);
                    setValidationError(null);
                  }}
                  placeholder="e.g. claude-haiku-4-5"
                  className="font-mono text-xs"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-rename-api-key">
                  API key{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                {(existing?.hasApiKey || selectedProvider?.hasEnvKey) && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 text-muted-foreground"
                  >
                    {existing?.hasApiKey ? "saved in config" : "using env var"}
                  </Badge>
                )}
              </div>
              <div className="relative">
                <Input
                  id="auto-rename-api-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setSaved(false);
                    setError(null);
                    setValidationError(null);
                  }}
                  placeholder={
                    selectedProvider
                      ? `${selectedProvider.envVar} or paste key`
                      : "API key"
                  }
                  className="pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </>
        )}

        {validationError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {saved && !error && !validationError && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Auto-rename settings saved.
          </p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              handleSave().catch(() => undefined);
            }}
            disabled={busy}
          >
            {buttonLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
