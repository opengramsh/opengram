import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Braces,
  ChevronDown,
  Settings,
} from "lucide-react";

import { HamburgerMenu } from "@/src/components/navigation/hamburger-menu";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import { apiFetch, setApiSecret } from "@/src/lib/api-fetch";
import { cn } from "@/src/lib/utils";
import type { ConfigResponse } from "./_settings/types";
import { AppSettingsTab } from "./_settings/app-settings-tab";
import { AgentsTab } from "./_settings/agents-tab";
import { RawConfigTab } from "./_settings/raw-config-tab";

// ─── Responsive Tabs Header ───────────────────────────────────────────────────

const TABS = [
  { value: "app", label: "App", icon: Settings },
  { value: "agents", label: "Agents", icon: Bot },
  { value: "raw", label: "Raw config", icon: Braces },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function ResponsiveTabsHeader({
  value,
  onValueChange,
}: {
  value: TabValue;
  onValueChange: (v: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const check = () =>
      setOverflow(measure.offsetWidth > container.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const active = TABS.find((t) => t.value === value) ?? TABS[0];
  const ActiveIcon = active.icon;

  return (
    <div ref={containerRef} className="relative mb-4">
      {/* Hidden element that renders the tab list at its natural fit-content width for measurement */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute w-fit"
        aria-hidden
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              <tab.icon size={13} />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {overflow ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between gap-2"
            >
              <span className="flex items-center gap-1.5">
                <ActiveIcon size={13} />
                {active.label}
              </span>
              <ChevronDown size={13} className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[--radix-dropdown-menu-trigger-width]"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <DropdownMenuItem
                  key={tab.value}
                  onClick={() => onValueChange(tab.value)}
                  className={cn(
                    "gap-2",
                    tab.value === value && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon size={13} />
                  {tab.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <TabsList className="w-full justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              <tab.icon size={13} />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>("app");

  const loadConfig = useCallback(async () => {
    try {
      const response = await apiFetch("/api/v1/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load config");
      const loaded = (await response.json()) as ConfigResponse;
      setApiSecret(loaded.security?.instanceSecret ?? null);
      setConfig(loaded);
    } catch {
      setError("Failed to load configuration.");
    }
  }, []);

  useEffect(() => {
    loadConfig().catch(() => undefined);
  }, [loadConfig]);

  return (
    <div className="min-h-screen w-full bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">
              Settings
            </h1>
            <p className="text-xs text-muted-foreground">
              Agents &amp; app controls
            </p>
          </div>
          <div />
        </div>
      </header>

      <main className="px-4 py-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !config && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {config && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabValue)}
            className="w-full"
          >
            <ResponsiveTabsHeader
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabValue)}
            />

            <TabsContent value="app">
              <AppSettingsTab
                config={config}
                onConfigChange={() => loadConfig()}
              />
            </TabsContent>

            <TabsContent value="agents">
              <AgentsTab
                agents={config.agents}
                onAgentsChange={(agents) => setConfig({ ...config, agents })}
              />
            </TabsContent>

            <TabsContent value="raw">
              <RawConfigTab
                config={config}
                onConfigSaved={() => loadConfig()}
              />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
