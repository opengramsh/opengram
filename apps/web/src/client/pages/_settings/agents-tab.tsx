import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { apiFetch } from "@/src/lib/api-fetch";
import type { Agent } from "./types";
import { AgentDialog } from "./agent-dialog";
import { DeleteDialog } from "./delete-dialog";

export function AgentsTab({
  agents,
  onAgentsChange,
}: {
  agents: Agent[];
  onAgentsChange: (a: Agent[]) => void;
}) {
  async function saveAgents(updated: Agent[]) {
    const res = await apiFetch("/api/v1/config/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: updated }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Failed to save agents.");
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
      throw new Error("At least one agent is required.");
    }
    await saveAgents(agents.filter((a) => a.id !== agent.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {agents.length} {agents.length === 1 ? "agent" : "agents"} configured
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
              <p className="text-sm font-medium text-foreground">
                {agent.name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {agent.id}
              </p>
              {agent.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {agent.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <AgentDialog
                mode="edit"
                initial={agent}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  >
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
