import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Braces, ChevronDown, Pencil, Plus, Settings, Trash2 } from 'lucide-react';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/src/components/ui/dialog';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { cn } from '@/src/lib/utils';
import { Textarea } from '@/src/components/ui/textarea';
import {
  disablePushNotifications,
  enablePushNotifications,
  fetchPushConfig,
  getCurrentPushSubscription,
  getPushPermissionState,
  isPushSupported,
  sendPushTestNotification,
  type PushPermissionState,
} from '@/src/lib/push-client';

// ─── Types ────────────────────────────────────────────────────────────────────

type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  defaultModelId?: string;
};

type Model = {
  id: string;
  name: string;
  description: string;
};

type ConfigResponse = {
  appName: string;
  agents: Agent[];
  models: Model[];
  push?: {
    enabled?: boolean;
    subject?: string;
    vapidPublicKey?: string;
  };
  security?: {
    instanceSecretEnabled?: boolean;
    readEndpointsRequireInstanceSecret?: boolean;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function permissionLabel(permission: PushPermissionState) {
  if (permission === 'unsupported') return 'Not supported in this browser';
  if (permission === 'granted') return 'Granted';
  if (permission === 'denied') return 'Denied';
  return 'Not requested';
}

// ─── Agent Dialog ─────────────────────────────────────────────────────────────

type AgentDialogProps = {
  mode: 'add' | 'edit';
  initial?: Agent;
  trigger: React.ReactNode;
  onSave: (agent: Agent) => Promise<void>;
};

function AgentDialog({ mode, initial, trigger, onSave }: AgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? '');
  const [id, setId] = useState(initial?.id ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalId = useRef(initial?.id);
  const idChanged = mode === 'edit' && id !== originalId.current;

  function reset() {
    setName(initial?.name ?? '');
    setId(initial?.id ?? '');
    setDescription(initial?.description ?? '');
    setError(null);
    originalId.current = initial?.id;
  }

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!name.trim() || !id.trim()) {
      setError('Name and ID are required.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await onSave({ id: id.trim(), name: name.trim(), description: description.trim() });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save agent.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add Agent' : 'Edit Agent'}</DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'Configure a new agent that will be available for chats.'
              : 'Update the agent details. The ID must match what is configured in the source system.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Assistant"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-id">ID</Label>
            <Input
              id="agent-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. my-assistant"
              className={idChanged ? 'border-amber-500 focus-visible:ring-amber-500/30' : ''}
            />
            {idChanged && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  Changing the ID will break the connection to this agent if the new ID does not
                  match the source system (e.g., OpenClaw).
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Description</Label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              handleSave().catch(() => undefined);
            }}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Model Dialog — commented out while feature is disabled ──────────────────
//
// type ModelDialogProps = {
//   mode: 'add' | 'edit';
//   initial?: Model;
//   trigger: React.ReactNode;
//   onSave: (model: Model) => Promise<void>;
// };
//
// function ModelDialog({ mode, initial, trigger, onSave }: ModelDialogProps) {
//   const [open, setOpen] = useState(false);
//   const [name, setName] = useState(initial?.name ?? '');
//   const [id, setId] = useState(initial?.id ?? '');
//   const [description, setDescription] = useState(initial?.description ?? '');
//   const [saving, setSaving] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const originalId = useRef(initial?.id);
//   const idChanged = mode === 'edit' && id !== originalId.current;
//
//   function reset() {
//     setName(initial?.name ?? '');
//     setId(initial?.id ?? '');
//     setDescription(initial?.description ?? '');
//     setError(null);
//     originalId.current = initial?.id;
//   }
//
//   useEffect(() => {
//     if (open) reset();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [open]);
//
//   async function handleSave() {
//     if (!name.trim() || !id.trim()) {
//       setError('Name and ID are required.');
//       return;
//     }
//     try {
//       setSaving(true);
//       setError(null);
//       await onSave({ id: id.trim(), name: name.trim(), description: description.trim() });
//       setOpen(false);
//     } catch (e) {
//       setError(e instanceof Error ? e.message : 'Failed to save model.');
//     } finally {
//       setSaving(false);
//     }
//   }
//
//   return (
//     <Dialog open={open} onOpenChange={setOpen}>
//       <DialogTrigger asChild>{trigger}</DialogTrigger>
//       <DialogContent className="max-w-md">
//         <DialogHeader>
//           <DialogTitle>{mode === 'add' ? 'Add Model' : 'Edit Model'}</DialogTitle>
//           <DialogDescription>
//             {mode === 'add'
//               ? 'Configure a new model that agents can use.'
//               : 'Update the model details. The ID must match what is configured in the source system.'}
//           </DialogDescription>
//         </DialogHeader>
//
//         <div className="space-y-4">
//           <div className="space-y-1.5">
//             <Label htmlFor="model-name">Name</Label>
//             <Input
//               id="model-name"
//               value={name}
//               onChange={(e) => setName(e.target.value)}
//               placeholder="e.g. GPT-4o"
//             />
//           </div>
//
//           <div className="space-y-1.5">
//             <Label htmlFor="model-id">ID</Label>
//             <Input
//               id="model-id"
//               value={id}
//               onChange={(e) => setId(e.target.value)}
//               placeholder="e.g. gpt-4o"
//               className={idChanged ? 'border-amber-500 focus-visible:ring-amber-500/30' : ''}
//             />
//             {idChanged && (
//               <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
//                 <AlertTriangle size={13} className="mt-0.5 shrink-0" />
//                 <span>
//                   Changing the ID will break the connection to this model if the new ID does not
//                   match the source system (e.g., OpenClaw).
//                 </span>
//               </div>
//             )}
//           </div>
//
//           <div className="space-y-1.5">
//             <Label htmlFor="model-description">Description</Label>
//             <Textarea
//               id="model-description"
//               value={description}
//               onChange={(e) => setDescription(e.target.value)}
//               placeholder="Optional description"
//               rows={3}
//             />
//           </div>
//
//           {error && <p className="text-xs text-destructive">{error}</p>}
//         </div>
//
//         <DialogFooter>
//           <DialogClose asChild>
//             <Button variant="outline" disabled={saving}>
//               Cancel
//             </Button>
//           </DialogClose>
//           <Button
//             onClick={() => {
//               handleSave().catch(() => undefined);
//             }}
//             disabled={saving}
//           >
//             {saving ? 'Saving…' : 'Save'}
//           </Button>
//         </DialogFooter>
//       </DialogContent>
//     </Dialog>
//   );
// }

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

type DeleteDialogProps = {
  label: string;
  trigger: React.ReactNode;
  onConfirm: () => Promise<void>;
};

function DeleteDialog({ label, trigger, onConfirm }: DeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    try {
      setDeleting(true);
      setError(null);
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>
            This will remove <strong>{label}</strong> from the configuration. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={deleting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              handleConfirm().catch(() => undefined);
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

function AgentsTab({ agents, onAgentsChange }: { agents: Agent[]; onAgentsChange: (a: Agent[]) => void }) {
  async function saveAgents(updated: Agent[]) {
    const res = await fetch('/api/v1/config/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: updated }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Failed to save agents.');
    }
    onAgentsChange(updated);
  }

  async function handleAdd(agent: Agent) {
    if (agents.some((a) => a.id === agent.id)) {
      throw new Error(`An agent with ID "${agent.id}" already exists.`);
    }
    await saveAgents([...agents, agent]);
  }

  async function handleEdit(original: Agent, updated: Agent) {
    if (updated.id !== original.id && agents.some((a) => a.id === updated.id)) {
      throw new Error(`An agent with ID "${updated.id}" already exists.`);
    }
    await saveAgents(agents.map((a) => (a.id === original.id ? updated : a)));
  }

  async function handleDelete(agent: Agent) {
    if (agents.length <= 1) {
      throw new Error('At least one agent is required.');
    }
    await saveAgents(agents.filter((a) => a.id !== agent.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {agents.length} {agents.length === 1 ? 'agent' : 'agents'} configured
        </p>
        <AgentDialog
          mode="add"
          trigger={
            <Button size="sm" className="gap-1.5">
              <Plus size={13} />
              Add agent
            </Button>
          }
          onSave={handleAdd}
        />
      </div>

      <ul className="space-y-2">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{agent.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{agent.id}</p>
              {agent.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{agent.description}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <AgentDialog
                mode="edit"
                initial={agent}
                trigger={
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Pencil size={13} />
                  </Button>
                }
                onSave={(updated) => handleEdit(agent, updated)}
              />
              <DeleteDialog
                label={agent.name}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={agents.length <= 1}
                  >
                    <Trash2 size={13} />
                  </Button>
                }
                onConfirm={() => handleDelete(agent)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Models Tab — commented out while feature is disabled ─────────────────────
//
// function ModelsTab({ models, onModelsChange }: { models: Model[]; onModelsChange: (m: Model[]) => void }) {
//   async function saveModels(updated: Model[]) {
//     const res = await fetch('/api/v1/config/admin', {
//       method: 'PATCH',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ models: updated }),
//     });
//     if (!res.ok) {
//       const data = (await res.json().catch(() => ({}))) as { error?: string };
//       throw new Error(data.error ?? 'Failed to save models.');
//     }
//     onModelsChange(updated);
//   }
//
//   async function handleAdd(model: Model) {
//     if (models.some((m) => m.id === model.id)) {
//       throw new Error(`A model with ID "${model.id}" already exists.`);
//     }
//     await saveModels([...models, model]);
//   }
//
//   async function handleEdit(original: Model, updated: Model) {
//     if (updated.id !== original.id && models.some((m) => m.id === updated.id)) {
//       throw new Error(`A model with ID "${updated.id}" already exists.`);
//     }
//     await saveModels(models.map((m) => (m.id === original.id ? updated : m)));
//   }
//
//   async function handleDelete(model: Model) {
//     if (models.length <= 1) {
//       throw new Error('At least one model is required.');
//     }
//     await saveModels(models.filter((m) => m.id !== model.id));
//   }
//
//   return (
//     <div className="space-y-3">
//       <div className="flex items-center justify-between">
//         <p className="text-xs text-muted-foreground">
//           {models.length} {models.length === 1 ? 'model' : 'models'} configured
//         </p>
//         <ModelDialog
//           mode="add"
//           trigger={
//             <Button size="sm" className="gap-1.5">
//               <Plus size={13} />
//               Add model
//             </Button>
//           }
//           onSave={handleAdd}
//         />
//       </div>
//
//       <ul className="space-y-2">
//         {models.map((model) => (
//           <li
//             key={model.id}
//             className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5"
//           >
//             <div className="flex min-w-0 flex-1 flex-col gap-0.5">
//               <p className="text-sm font-medium text-foreground">{model.name}</p>
//               <p className="font-mono text-[11px] text-muted-foreground">{model.id}</p>
//               {model.description && (
//                 <p className="mt-0.5 text-xs text-muted-foreground">{model.description}</p>
//               )}
//             </div>
//             <div className="flex shrink-0 gap-1">
//               <ModelDialog
//                 mode="edit"
//                 initial={model}
//                 trigger={
//                   <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
//                     <Pencil size={13} />
//                   </Button>
//                 }
//                 onSave={(updated) => handleEdit(model, updated)}
//               />
//               <DeleteDialog
//                 label={model.name}
//                 trigger={
//                   <Button
//                     variant="ghost"
//                     size="icon"
//                     className="h-7 w-7 text-muted-foreground hover:text-destructive"
//                     disabled={models.length <= 1}
//                   >
//                     <Trash2 size={13} />
//                   </Button>
//                 }
//                 onConfirm={() => handleDelete(model)}
//               />
//             </div>
//           </li>
//         ))}
//       </ul>
//     </div>
//   );
// }

// ─── App Settings Tab ─────────────────────────────────────────────────────────

function AppSettingsTab({ config }: { config: ConfigResponse }) {
  const [permission, setPermission] = useState<PushPermissionState>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'enable' | 'disable' | 'test' | null>(null);

  const refreshPushState = useCallback(async () => {
    setPermission(getPushPermissionState());
    if (!isPushSupported()) {
      setIsSubscribed(false);
      return;
    }
    const subscription = await getCurrentPushSubscription();
    setIsSubscribed(Boolean(subscription));
  }, []);

  useEffect(() => {
    refreshPushState().catch(() => undefined);
  }, [refreshPushState]);

  const handleEnable = useCallback(async () => {
    if (!config.push?.enabled) {
      setStatusMessage('Push is disabled in server config.');
      return;
    }
    try {
      setBusyAction('enable');
      setStatusMessage(null);
      const pushConfig = await fetchPushConfig();
      await enablePushNotifications(pushConfig.vapidPublicKey);
      setStatusMessage('Notifications enabled.');
      await refreshPushState();
    } catch {
      setStatusMessage('Unable to enable notifications. Check browser permission settings.');
      await refreshPushState();
    } finally {
      setBusyAction(null);
    }
  }, [config.push?.enabled, refreshPushState]);

  const handleDisable = useCallback(async () => {
    try {
      setBusyAction('disable');
      setStatusMessage(null);
      await disablePushNotifications();
      setStatusMessage('Notifications disabled.');
      await refreshPushState();
    } catch {
      setStatusMessage('Unable to disable notifications.');
    } finally {
      setBusyAction(null);
    }
  }, [refreshPushState]);

  const handleSendTest = useCallback(async () => {
    try {
      setBusyAction('test');
      setStatusMessage(null);
      await sendPushTestNotification();
      setStatusMessage('Test notification sent.');
    } catch {
      setStatusMessage('Unable to send test notification.');
    } finally {
      setBusyAction(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-0">
          <CardTitle className="text-sm">Push notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-0">
          <p className="text-sm text-muted-foreground">
            {config.push?.enabled ? 'Enabled in config.' : 'Disabled in config.'}
          </p>
          <p className="text-sm text-muted-foreground">Permission: {permissionLabel(permission)}</p>
          <p className="text-sm text-muted-foreground">
            Subscription: {isSubscribed ? 'Active' : 'Not active'}
          </p>
          {config.push?.subject && (
            <p className="text-xs text-muted-foreground">Subject: {config.push.subject}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                handleEnable().catch(() => undefined);
              }}
              disabled={busyAction !== null || !config.push?.enabled}
            >
              {busyAction === 'enable' ? 'Enabling…' : 'Enable notifications'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                handleDisable().catch(() => undefined);
              }}
              disabled={busyAction !== null || !isSubscribed}
            >
              {busyAction === 'disable' ? 'Disabling…' : 'Disable notifications'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                handleSendTest().catch(() => undefined);
              }}
              disabled={busyAction !== null || !config.push?.enabled || !isSubscribed}
            >
              {busyAction === 'test' ? 'Sending…' : 'Send test notification'}
            </Button>
          </div>

          {statusMessage && <p className="text-xs text-muted-foreground">{statusMessage}</p>}

          <p className="text-xs text-muted-foreground">
            iOS Safari requires installing OpenGram to Home Screen before push permissions can be
            granted.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-0">
          <CardTitle className="text-sm">Write security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-0">
          <p className="text-sm text-muted-foreground">
            {config.security?.instanceSecretEnabled
              ? 'Instance secret enforcement is enabled.'
              : 'Instance secret enforcement is disabled.'}
          </p>
          {config.security?.instanceSecretEnabled && (
            <p className="text-sm text-muted-foreground">
              {config.security.readEndpointsRequireInstanceSecret
                ? 'Read endpoints also require the instance secret.'
                : 'Read endpoints do not require the instance secret.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Raw Config Tab ───────────────────────────────────────────────────────────

function RawConfigTab({ config, onConfigSaved }: { config: ConfigResponse; onConfigSaved: () => void }) {
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
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('Config must be a JSON object.');
        return null;
      }
      setParseError(null);
      return parsed as Record<string, unknown>;
    } catch (e) {
      setParseError(e instanceof SyntaxError ? `JSON parse error: ${e.message}` : 'Invalid JSON.');
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
      const res = await fetch('/api/v1/config/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawConfig: parsed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.error ?? data.message ?? 'Failed to save config.');
      }
      setSaved(true);
      onConfigSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save config.');
    } finally {
      setSaving(false);
    }
  }

  const hasParseError = Boolean(parseError);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Edit the raw configuration JSON. The server will validate the config before saving. Invalid
        configs will be rejected with an error message.
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
        <p className="text-xs text-green-600 dark:text-green-400">Config saved successfully.</p>
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
          {saving ? 'Saving…' : 'Save config'}
        </Button>
      </div>
    </div>
  );
}

// ─── Responsive Tabs Header ───────────────────────────────────────────────────

const TABS = [
  { value: 'agents', label: 'Agents', icon: Bot },
  // { value: 'models', label: 'Models', icon: Cpu },
  { value: 'app', label: 'App', icon: Settings },
  { value: 'raw', label: 'Raw config', icon: Braces },
] as const;

type TabValue = (typeof TABS)[number]['value'];

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
    const check = () => setOverflow(measure.offsetWidth > container.clientWidth);
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
      <div ref={measureRef} className="pointer-events-none invisible absolute w-fit" aria-hidden>
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
            <Button variant="outline" size="sm" className="w-full justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <ActiveIcon size={13} />
                {active.label}
              </span>
              <ChevronDown size={13} className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <DropdownMenuItem
                  key={tab.value}
                  onClick={() => onValueChange(tab.value)}
                  className={cn('gap-2', tab.value === value && 'bg-accent text-accent-foreground')}
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
  const [activeTab, setActiveTab] = useState<TabValue>('agents');

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load config');
      setConfig((await response.json()) as ConfigResponse);
    } catch {
      setError('Failed to load configuration.');
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
            <h1 className="text-sm font-semibold tracking-wide text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground">Agents &amp; app controls</p>
          </div>
          <div />
        </div>
      </header>

      <main className="px-4 py-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !config && <p className="text-sm text-muted-foreground">Loading…</p>}

        {config && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="w-full">
            <ResponsiveTabsHeader value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} />

            <TabsContent value="agents">
              <AgentsTab
                agents={config.agents}
                onAgentsChange={(agents) => setConfig({ ...config, agents })}
              />
            </TabsContent>

            {/* Models tab — commented out while feature is disabled
            <TabsContent value="models">
              <ModelsTab
                models={config.models}
                onModelsChange={(models) => setConfig({ ...config, models })}
              />
            </TabsContent>
            */}

            <TabsContent value="app">
              <AppSettingsTab config={config} />
            </TabsContent>

            <TabsContent value="raw">
              <RawConfigTab config={config} onConfigSaved={() => loadConfig()} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
