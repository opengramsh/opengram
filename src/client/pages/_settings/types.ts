export type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  defaultModelId?: string;
};

export type Model = {
  id: string;
  name: string;
  description: string;
};

export type AutoRenameProviderInfo = {
  id: string;
  name: string;
  envVar: string;
  hasEnvKey: boolean;
  cheapModels: { id: string; label: string }[];
};

export type ConfigResponse = {
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
  autoRename?: {
    enabled: boolean;
    provider: string;
    modelId: string;
    hasApiKey: boolean;
  } | null;
  autoRenameProviders?: AutoRenameProviderInfo[];
};
