import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import type { Agent } from "./types";

type AgentDialogProps = {
  mode: "add" | "edit";
  initial?: Agent;
  trigger: React.ReactNode;
  onSave: (agent: Agent) => Promise<void>;
};

export function AgentDialog({ mode, initial, trigger, onSave }: AgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalId = useRef(initial?.id);
  const idChanged = mode === "edit" && id !== originalId.current;

  function reset() {
    setName(initial?.name ?? "");
    setId(initial?.id ?? "");
    setDescription(initial?.description ?? "");
    setError(null);
    originalId.current = initial?.id;
  }

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!name.trim() || !id.trim()) {
      setError("Name and ID are required.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await onSave({
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add Agent" : "Edit Agent"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Configure a new agent that will be available for chats."
              : "Update the agent details. The ID must match what is configured in the source system."}
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
              className={
                idChanged
                  ? "border-amber-500 focus-visible:ring-amber-500/30"
                  : ""
              }
            />
            {idChanged && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  Changing the ID will break the connection to this agent if the
                  new ID does not match the source system (e.g., OpenClaw).
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
            {saving ? "Saving\u2026" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
