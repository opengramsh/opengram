export type NewChatAgentOption = {
  id: string;
};

export type NewChatModelOption = {
  id: string;
};

export function selectNewChatAgentId(
  agents: NewChatAgentOption[],
  preferredAgentId?: string,
) {
  if (preferredAgentId && agents.some((agent) => agent.id === preferredAgentId)) {
    return preferredAgentId;
  }

  return agents[0]?.id ?? '';
}

export function selectNewChatModelId(
  models: NewChatModelOption[],
  defaultModelIdForNewChats: string,
  preferredModelId?: string,
) {
  if (preferredModelId && models.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  if (models.some((model) => model.id === defaultModelIdForNewChats)) {
    return defaultModelIdForNewChats;
  }

  return models[0]?.id ?? '';
}

export function normalizeFirstMessageForNewChat(firstMessage: string) {
  const normalized = firstMessage.trim();
  return normalized || null;
}
