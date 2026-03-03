import { useCallback, useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Switch } from "@/src/components/ui/switch";
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

export function NotificationsCard({ config }: { config: ConfigResponse }) {
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
      const result = await sendPushTestNotification();
      if (result.sent > 0) {
        setStatusMessage(
          `Test notification sent to ${result.sent} device(s).`,
        );
      } else if (result.failed > 0) {
        setStatusMessage(
          `Delivery failed for ${result.failed} device(s). Try disabling and re-enabling notifications.`,
        );
      } else {
        setStatusMessage(
          "No push subscriptions found. Try disabling and re-enabling notifications.",
        );
      }
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
  const showLocalhostWarning =
    config.push?.enabled && config.push.subject?.includes("localhost");

  return (
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
            <p className="text-sm font-medium">Push notifications</p>
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

        {showLocalhostWarning && (
          <p className="pb-2 text-xs text-amber-600 dark:text-amber-400">
            Push notifications won&apos;t be delivered until the server detects
            your domain. Try disabling and re-enabling push notifications to
            trigger auto-detection.
          </p>
        )}
        {showDeniedHint && (
          <p className="pb-2 text-xs text-amber-600 dark:text-amber-400">
            Notifications are blocked by your browser. Open your browser&apos;s
            site settings to allow notifications.
          </p>
        )}
        {showIosHint && (
          <p className="pb-2 text-xs text-muted-foreground">
            iOS Safari requires installing OpenGram to your Home Screen before
            notifications can be enabled.
          </p>
        )}
        {statusMessage && (
          <p className="pb-2 text-xs text-muted-foreground">{statusMessage}</p>
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
  );
}
