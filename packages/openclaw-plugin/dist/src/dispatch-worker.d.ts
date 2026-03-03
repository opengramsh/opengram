import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenGramClient } from "./api-client.js";
import { type DispatchFn } from "./inbound.js";
type LogLike = {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
};
export type DispatchWorkerParams = {
    client: OpenGramClient;
    cfg: OpenClawConfig;
    abortSignal: AbortSignal;
    log?: LogLike;
    dispatch?: DispatchFn;
    workerId?: string;
    leaseMs?: number;
    heartbeatIntervalMs?: number;
    claimWaitMs?: number;
    autoscaleEnabled?: boolean;
    minConcurrency?: number;
    maxConcurrency?: number;
    scaleCooldownMs?: number;
    claimManyLimit?: number;
};
export declare function startDispatchWorker(params: DispatchWorkerParams): Promise<void>;
export {};
