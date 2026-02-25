import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Dices,
  Eye,
  EyeOff,
} from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Switch } from "@/src/components/ui/switch";
import { setApiSecret } from "@/src/lib/api-fetch";
import {
  disablePushNotifications,
  enablePushNotifications,
  fetchPushConfig,
  getCurrentPushSubscription,
  getPushPermissionState,
  isPushSupported,
  sendPushTestNotification,
  type PushPermissionState,
} from "@/src/lib/push-client";
import {
  isSoundEnabled,
  setSoundEnabled,
  isBrowserNotificationsEnabled,
  setBrowserNotificationsEnabled,
} from "@/src/lib/notification-preferences";
import { playNotificationSound } from "@/src/lib/notification-sound";
import type { ConfigResponse } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Security Card ────────────────────────────────────────────────────────────

function SecurityCard({
  config,
  onConfigChange,
}: {
  config: ConfigResponse;
  onConfigChange: () => void;
}) {
  const [enabled, setEnabled] = useState(
    config.security?.instanceSecretEnabled ?? false,
  );
  const [secret, setSecret] = useState(config.security?.instanceSecret ?? "");
  const [requireForReads, setRequireForReads] = useState(
    config.security?.readEndpointsRequireInstanceSecret ?? false,
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);

  useEffect(() => {
    setEnabled(config.security?.instanceSecretEnabled ?? false);
    setSecret(config.security?.instanceSecret ?? "");
    setRequireForReads(
      config.security?.readEndpointsRequireInstanceSecret ?? false,
    );
  }, [
    config.security?.instanceSecretEnabled,
    config.security?.instanceSecret,
    config.security?.readEndpointsRequireInstanceSecret,
  ]);

  const isDirty =
    enabled !== (config.security?.instanceSecretEnabled ?? false) ||
    secret !== (config.security?.instanceSecret ?? "") ||
    requireForReads !==
      (config.security?.readEndpointsRequireInstanceSecret ?? false);

  const hasValidationError = enabled && !secret.trim();

  async function handleSave() {
    if (hasValidationError) {
      setError("Instance secret cannot be empty when enabled.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSaved(false);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const currentServerSecret = config.security?.instanceSecret;
      if (currentServerSecret) {
        headers.Authorization = `Bearer ${currentServerSecret}`;
      }
      const res = await fetch("/api/v1/config/admin", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          security: {
            instanceSecretEnabled: enabled,
            instanceSecret: enabled ? secret.trim() : "",
            readEndpointsRequireInstanceSecret: requireForReads,
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          data.error ?? data.message ?? "Failed to save security settings.",
        );
      }
      setApiSecret(enabled ? secret.trim() : null);
      setSaved(true);
      onConfigChange();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to save security settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-0">
        <CardTitle className="text-sm">Instance secret</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <p className="text-xs text-muted-foreground">
          Require a Bearer token on API requests. Protects against cross-origin
          attacks and unauthorized access from other processes.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked === true);
              setSaved(false);
              setError(null);
            }}
          />
          <span className="text-sm">Enable instance secret</span>
        </label>

        {enabled && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="instance-secret">Secret</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                  onClick={() => {
                    if (secret.trim()) {
                      setShowGenerateConfirm(true);
                    } else {
                      setSecret(generateSecret());
                      setShowSecret(true);
                      setSaved(false);
                      setError(null);
                    }
                  }}
                >
                  <Dices size={12} />
                  Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="instance-secret"
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setSaved(false);
                    setError(null);
                  }}
                  placeholder="your-secret-here"
                  className="pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <Dialog
                open={showGenerateConfirm}
                onOpenChange={setShowGenerateConfirm}
              >
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Replace existing secret?</DialogTitle>
                    <DialogDescription>
                      This will replace your current secret. Any clients using
                      the old secret (e.g. OpenClaw) will need to be updated
                      with the new one.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      onClick={() => {
                        setSecret(generateSecret());
                        setShowSecret(true);
                        setSaved(false);
                        setError(null);
                        setShowGenerateConfirm(false);
                      }}
                    >
                      Replace
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={requireForReads}
                onCheckedChange={(checked) => {
                  setRequireForReads(checked === true);
                  setSaved(false);
                  setError(null);
                }}
              />
              <span className="text-sm">
                Also require secret for read endpoints
              </span>
            </label>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {saved && !error && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Security settings saved.
          </p>
        )}

        {isDirty && (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                handleSave().catch(() => undefined);
              }}
              disabled={saving || hasValidationError}
            >
              {saving ? "Saving\u2026" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── App Settings Tab ─────────────────────────────────────────────────────────

export function AppSettingsTab({
  config,
  onConfigChange,
}: {
  config: ConfigResponse;
  onConfigChange: () => void;
}) {
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [browserOn, setBrowserOn] = useState(isBrowserNotificationsEnabled);
  const [permission, setPermission] =
    useState<PushPermissionState>("unsupported");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [busyBrowser, setBusyBrowser] = useState(false);
  const [busyTest, setBusyTest] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshPushState = useCallback(async () => {
    setPermission(getPushPermissionState());
    if (!isPushSupported()) {
      setIsSubscribed(false);
      return;
    }
    const subscription = await getCurrentPushSubscription();
    const hasSubscription = Boolean(subscription);
    setIsSubscribed(hasSubscription);
    return hasSubscription;
  }, []);

  useEffect(() => {
    refreshPushState()
      .then((hasSubscription) => {
        if (!hasSubscription || !config.push?.enabled) {
          setBrowserNotificationsEnabled(false);
          setBrowserOn(false);
        }
      })
      .catch(() => undefined);
  }, [refreshPushState, config.push?.enabled]);

  function handleSoundToggle(checked: boolean) {
    setSoundEnabled(checked);
    setSoundOn(checked);
    if (checked) {
      playNotificationSound();
    }
  }

  async function handleBrowserToggle(checked: boolean) {
    setStatusMessage(null);

    if (!checked) {
      setBusyBrowser(true);
      try {
        await disablePushNotifications();
        setBrowserNotificationsEnabled(false);
        setBrowserOn(false);
        await refreshPushState();
      } catch {
        setStatusMessage("Unable to disable notifications.");
      } finally {
        setBusyBrowser(false);
      }
      return;
    }

    // Turning ON
    const perm = getPushPermissionState();
    if (perm === "denied") {
      setStatusMessage(
        "Notifications are blocked. Enable them in your browser settings, then try again.",
      );
      return;
    }
    if (!config.push?.enabled) {
      setStatusMessage("Push notifications are not enabled on the server.");
      return;
    }

    setBusyBrowser(true);
    try {
      const pushConfig = await fetchPushConfig();
      await enablePushNotifications(pushConfig.vapidPublicKey);
      setBrowserNotificationsEnabled(true);
      setBrowserOn(true);
      await refreshPushState();
    } catch {
      setStatusMessage(
        "Unable to enable notifications. Check browser permission settings.",
      );
      await refreshPushState();
    } finally {
      setBusyBrowser(false);
    }
  }

  async function handleSendTest() {
    try {
      setBusyTest(true);
      setStatusMessage(null);
      await sendPushTestNotification();
      setStatusMessage("Test notification sent.");
    } catch {
      setStatusMessage("Unable to send test notification.");
    } finally {
      setBusyTest(false);
    }
  }

  const showDeniedHint = permission === "denied" && !browserOn;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const showIosHint = isIos && permission === "default";
  const showTestButton = browserOn && isSubscribed && config.push?.enabled;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-0">
          <CardTitle className="text-sm">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {/* Sound toggle */}
          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Sound</p>
              <p className="text-xs text-muted-foreground">
                Play a sound when new messages arrive
              </p>
            </div>
            <Switch checked={soundOn} onCheckedChange={handleSoundToggle} />
          </div>

          <div className="border-t border-border/50" />

          {/* Browser notifications toggle */}
          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Desktop notifications</p>
              <p className="text-xs text-muted-foreground">
                Show popup notifications for new messages
              </p>
            </div>
            <Switch
              checked={browserOn}
              onCheckedChange={(checked) => {
                handleBrowserToggle(checked).catch(() => undefined);
              }}
              disabled={busyBrowser}
            />
          </div>

          {showDeniedHint && (
            <p className="pb-2 text-xs text-amber-600 dark:text-amber-400">
              Notifications are blocked by your browser. Open your
              browser&apos;s site settings to allow notifications.
            </p>
          )}
          {showIosHint && (
            <p className="pb-2 text-xs text-muted-foreground">
              iOS Safari requires installing OpenGram to your Home Screen before
              notifications can be enabled.
            </p>
          )}
          {statusMessage && (
            <p className="pb-2 text-xs text-muted-foreground">
              {statusMessage}
            </p>
          )}

          {showTestButton && (
            <div className="pb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleSendTest().catch(() => undefined);
                }}
                disabled={busyTest}
              >
                {busyTest ? "Sending\u2026" : "Send test notification"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SecurityCard config={config} onConfigChange={onConfigChange} />
    </div>
  );
}
