type CachedAgent = {
  id: string;
  name: string;
  description: string;
  defaultModelId?: string;
};

type CachedModel = {
  id: string;
  name: string;
  description: string;
};

export type FrontendConfigCache = {
  appName?: string;
  defaultModelIdForNewChats?: string;
  agents: CachedAgent[];
  models: CachedModel[];
  security?: {
    instanceSecret?: string | null;
  };
};

let cache: FrontendConfigCache | null = null;

export function getFrontendConfigCache(): FrontendConfigCache | null {
  return cache;
}

export function setFrontendConfigCache(value: FrontendConfigCache) {
  cache = value;
}
