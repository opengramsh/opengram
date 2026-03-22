import { AutoRenameCard } from "./auto-rename-card";
import { NotificationsCard } from "./notifications-card";
import { SecurityCard } from "./security-card";
import type { ConfigResponse } from "./types";

export function AppSettingsTab({
  config,
  onConfigChange,
}: {
  config: ConfigResponse;
  onConfigChange: () => void;
}) {
  return (
    <div className="space-y-4">
      <NotificationsCard config={config} />
      <SecurityCard config={config} onConfigChange={onConfigChange} />
      <AutoRenameCard config={config} onConfigChange={onConfigChange} />
    </div>
  );
}
