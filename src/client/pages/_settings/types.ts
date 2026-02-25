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
    instanceSecret?: string;
    readEndpointsRequireInstanceSecret?: boolean;
  };
};
