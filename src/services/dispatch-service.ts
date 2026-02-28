import { nanoid } from "nanoid";

import { conflictError, notFoundError } from "@/src/api/http";
import { loadOpengramConfig } from "@/src/config/opengram-config";
import { getDb } from "@/src/db/client";
import { emitEvent } from "@/src/services/events-service";

type DispatchInputSourceKind = "user_message" | "request_resolved";
type DispatchInputState = "pending" | "batched";
type DispatchBatchKind = "user_batch" | "request_batch";
type DispatchBatchStatus = "pending" | "leased" | "completed" | "failed";

type DispatchInputRecord = {
  id: string;
  chat_id: string;
  source_kind: DispatchInputSourceKind;
  source_id: string;
  payload: string;
  created_at: number;
  state: DispatchInputState;
};

type DispatchChatStateRecord = {
  chat_id: string;
  first_pending_at: number | null;
  last_input_at: number | null;
  last_user_typing_at: number | null;
  updated_at: number;
};

type DispatchBatchRecord = {
  id: string;
  chat_id: string;
  kind: DispatchBatchKind;
  payload: string;
  status: DispatchBatchStatus;
  attempt_count: number;
  available_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
};

type UserMessageInputPayload = {
  messageId: string;
  senderId: string;
  content: string;
  traceKind?: string;
  mediaIds: string[];
};

type RequestResolvedInputPayload = {
  requestId: string;
  senderId: string;
  type: "choice" | "text_input" | "form";
  title: string;
  resolutionPayload: Record<string, unknown> | null;
};

type CompiledBatchItem = {
  inputId: string;
  sourceKind: DispatchInputSourceKind;
  sourceId: string;
  senderId: string;
  content: string;
  traceKind?: string;
  mediaIds: string[];
  attachmentNames: string[];
};

type CompiledBatchAttachment = {
  mediaId: string;
  fileName: string;
  kind: "image" | "audio" | "file";
  sourceInputId: string;
  sourceIndex: number;
};

type StoredBatchPayload = {
  compiledContent: string;
  items: CompiledBatchItem[];
  attachments: CompiledBatchAttachment[];
};

export type DispatchClaimBatch = {
  batchId: string;
  chatId: string;
  kind: DispatchBatchKind;
  agentIdHint: string | null;
  compiledContent: string;
  items: CompiledBatchItem[];
  attachments: CompiledBatchAttachment[];
};

type ClaimDispatchBatchInput = {
  workerId: string;
  leaseMs: number;
  waitMs: number;
  signal?: AbortSignal;
};

type ClaimDispatchBatchesInput = ClaimDispatchBatchInput & {
  limit: number;
};

type FailDispatchBatchInput = {
  workerId: string;
  reason: string;
  retryable: boolean;
  retryDelayMs?: number;
};

type DispatchMode = "immediate" | "sequential" | "batched_sequential";

type DispatchConfig = {
  mode: DispatchMode;
  batchDebounceMs: number;
  typingGraceMs: number;
  maxBatchWaitMs: number;
  schedulerTickMs: number;
  leaseMs: number;
  heartbeatIntervalMs: number;
  claimWaitMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxAttempts: number;
  execution: {
    autoscaleEnabled: boolean;
    minConcurrency: number;
    maxConcurrency: number;
    scaleCooldownMs: number;
  };
  claim: {
    claimManyLimit: number;
  };
};

type DispatchSchemaState = "unknown" | "present" | "missing";

const DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY = "__opengramDispatchBatchScheduler";
const DISPATCH_LEASE_SWEEPER_GLOBAL_KEY = "__opengramDispatchLeaseSweeper";
const DISPATCH_CLAIM_WAITERS_GLOBAL_KEY = "__opengramDispatchClaimWaiters";
const CLAIM_WAIT_FALLBACK_TICK_MS = 1_000;
const CLAIM_MANY_HARD_LIMIT = 50;
const PREVIEW_MAX_CHARS = 180;

let dispatchSchemaState: DispatchSchemaState = "unknown";
let lastBatchCreatedAtMs = 0;

function getDispatchConfig(): DispatchConfig {
  return loadOpengramConfig().server.dispatch;
}

function nextBatchCreatedAt(now: number) {
  if (now <= lastBatchCreatedAtMs) {
    lastBatchCreatedAtMs += 1;
    return lastBatchCreatedAtMs;
  }

  lastBatchCreatedAtMs = now;
  return lastBatchCreatedAtMs;
}

function isBatchedSequentialMode(cfg: DispatchConfig) {
  return cfg.mode === "batched_sequential";
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  return {};
}

function getDispatchSchemaAvailable() {
  if (dispatchSchemaState === "present") {
    return true;
  }
  if (dispatchSchemaState === "missing") {
    return false;
  }

  const db = getDb();
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dispatch_batches'",
    )
    .get() as { name: string } | undefined;
  dispatchSchemaState =
    row?.name === "dispatch_batches" ? "present" : "missing";
  return dispatchSchemaState === "present";
}

function ensureDispatchSchemaAvailable() {
  if (!getDispatchSchemaAvailable()) {
    throw notFoundError("Dispatch queue tables are not available.");
  }
}

function getDispatchClaimWaiters() {
  const scopedGlobal = globalThis as typeof globalThis & {
    [DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]?: Set<() => void>;
  };
  if (!scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]) {
    scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY] = new Set();
  }
  return scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY];
}

function notifyDispatchWorkAvailable() {
  const waiters = getDispatchClaimWaiters();
  if (waiters.size === 0) {
    return;
  }

  const callbacks = Array.from(waiters);
  waiters.clear();
  for (const callback of callbacks) {
    try {
      callback();
    } catch {
      // no-op
    }
  }
}

function waitForDispatchWorkSignal(waitMs: number, signal?: AbortSignal) {
  if (waitMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const waiters = getDispatchClaimWaiters();
    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      waiters.delete(onWake);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    const onWake = () => {
      cleanup();
    };

    const onAbort = () => {
      cleanup();
    };

    const timeout = setTimeout(cleanup, waitMs);
    waiters.add(onWake);

    if (signal?.aborted) {
      cleanup();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function formatRequestResolution(payload: RequestResolvedInputPayload): string {
  switch (payload.type) {
    case "choice":
      return `[Request resolved: "${payload.title}"] Selected: ${(payload.resolutionPayload?.selectedOptionIds as string[] | undefined)?.join(", ") ?? ""}`;
    case "text_input":
      return `[Request resolved: "${payload.title}"] Response: ${(payload.resolutionPayload?.text as string | undefined) ?? ""}`;
    case "form":
      return `[Request resolved: "${payload.title}"] Form values: ${JSON.stringify(payload.resolutionPayload?.values ?? {})}`;
    default:
      return `[Request resolved: "${payload.title}"] ${JSON.stringify(payload.resolutionPayload ?? {})}`;
  }
}

function buildCompiledContent(items: CompiledBatchItem[]) {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    const item = items[0]!;
    return item.content.trim() ? item.content : "(no text)";
  }

  return items
    .map((item, index) => {
      const body = item.content.trim() ? item.content : "(no text)";
      const attachmentLine =
        item.attachmentNames.length > 0
          ? `\n[attachments: ${JSON.stringify(item.attachmentNames)}]`
          : "";
      return `[Message ${index + 1}]${attachmentLine}\n${body}`;
    })
    .join("\n\n");
}

function getAttachmentRows(chatId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) {
    return [] as Array<{
      id: string;
      filename: string;
      kind: "image" | "audio" | "file";
    }>;
  }

  const db = getDb();
  const placeholders = mediaIds.map(() => "?").join(", ");
  return db
    .prepare(
      [
        "SELECT id, filename, kind",
        "FROM media",
        `WHERE chat_id = ? AND id IN (${placeholders})`,
      ].join(" "),
    )
    .all(chatId, ...mediaIds) as Array<{
    id: string;
    filename: string;
    kind: "image" | "audio" | "file";
  }>;
}

function compileBatchPayload(
  chatId: string,
  inputs: DispatchInputRecord[],
): StoredBatchPayload {
  const rawItems = inputs.map((input) => {
    const payload = parseJsonObject(input.payload);

    if (input.source_kind === "user_message") {
      const mediaIds = normalizeStringArray(payload.mediaIds);
      return {
        inputId: input.id,
        sourceKind: input.source_kind,
        sourceId: input.source_id,
        senderId:
          typeof payload.senderId === "string"
            ? payload.senderId
            : "user:primary",
        content: typeof payload.content === "string" ? payload.content : "",
        traceKind:
          typeof payload.traceKind === "string" ? payload.traceKind : undefined,
        mediaIds,
      } satisfies Omit<CompiledBatchItem, "attachmentNames">;
    }

    const requestPayload: RequestResolvedInputPayload = {
      requestId: input.source_id,
      senderId:
        typeof payload.senderId === "string"
          ? payload.senderId
          : "user:primary",
      type:
        payload.type === "choice" ||
        payload.type === "text_input" ||
        payload.type === "form"
          ? payload.type
          : "choice",
      title: typeof payload.title === "string" ? payload.title : "Request",
      resolutionPayload:
        payload.resolutionPayload &&
        typeof payload.resolutionPayload === "object" &&
        !Array.isArray(payload.resolutionPayload)
          ? (payload.resolutionPayload as Record<string, unknown>)
          : null,
    };

    return {
      inputId: input.id,
      sourceKind: input.source_kind,
      sourceId: input.source_id,
      senderId: requestPayload.senderId,
      content: formatRequestResolution(requestPayload),
      mediaIds: [],
    } satisfies Omit<CompiledBatchItem, "attachmentNames">;
  });

  const orderedMediaIds: string[] = [];
  for (const item of rawItems) {
    for (const mediaId of item.mediaIds) {
      orderedMediaIds.push(mediaId);
    }
  }

  const attachmentRows = getAttachmentRows(
    chatId,
    Array.from(new Set(orderedMediaIds)),
  );
  const attachmentMap = new Map(
    attachmentRows.map((row) => [row.id, row] as const),
  );

  const attachments: CompiledBatchAttachment[] = [];
  const items: CompiledBatchItem[] = rawItems.map((item, sourceIndex) => {
    const attachmentNames: string[] = [];
    for (const mediaId of item.mediaIds) {
      const row = attachmentMap.get(mediaId);
      if (!row) {
        continue;
      }

      attachmentNames.push(row.filename);
      attachments.push({
        mediaId,
        fileName: row.filename,
        kind: row.kind,
        sourceInputId: item.inputId,
        sourceIndex,
      });
    }

    return {
      ...item,
      attachmentNames,
    };
  });

  return {
    compiledContent: buildCompiledContent(items),
    items,
    attachments,
  };
}

function hasElapsed(now: number, since: number | null, windowMs: number) {
  if (since === null) {
    return true;
  }

  return now >= since + windowMs;
}

function isEligibleForBatch(
  now: number,
  state: DispatchChatStateRecord,
  cfg: DispatchConfig,
) {
  if (state.first_pending_at === null || state.last_input_at === null) {
    return false;
  }

  const typingIsRelevant =
    state.last_user_typing_at !== null &&
    state.last_user_typing_at > state.first_pending_at;

  if (hasElapsed(now, state.first_pending_at, cfg.maxBatchWaitMs)) {
    return true;
  }

  return (
    hasElapsed(now, state.last_input_at, cfg.batchDebounceMs) &&
    (!typingIsRelevant ||
      hasElapsed(now, state.last_user_typing_at, cfg.typingGraceMs))
  );
}

function updateChatPendingWindow(chatId: string, now: number) {
  const db = getDb();
  const row = db
    .prepare(
      [
        "SELECT MIN(created_at) AS firstPendingAt, MAX(created_at) AS lastInputAt",
        "FROM dispatch_inputs",
        "WHERE chat_id = ? AND state = ?",
      ].join(" "),
    )
    .get(chatId, "pending") as {
    firstPendingAt: number | null;
    lastInputAt: number | null;
  };

  db.prepare(
    [
      "UPDATE dispatch_chat_state",
      "SET first_pending_at = ?, last_input_at = ?, updated_at = ?",
      "WHERE chat_id = ?",
    ].join(" "),
  ).run(row.firstPendingAt, row.lastInputAt, now, chatId);
}

function createDispatchBatchForInputs(
  db: ReturnType<typeof getDb>,
  chatId: string,
  inputs: DispatchInputRecord[],
  now: number,
) {
  if (inputs.length === 0) {
    return null;
  }

  const kind: DispatchBatchKind = inputs.every(
    (input) => input.source_kind === "request_resolved",
  )
    ? "request_batch"
    : "user_batch";
  const payload = compileBatchPayload(chatId, inputs);
  const batchId = nanoid();
  const batchCreatedAt = nextBatchCreatedAt(now);
  const batchAvailableAt = now;

  db.prepare(
    [
      "INSERT INTO dispatch_batches (",
      "id, chat_id, kind, payload, status, attempt_count, available_at, lease_owner,",
      "lease_expires_at, last_error, created_at, updated_at, started_at, completed_at",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  ).run(
    batchId,
    chatId,
    kind,
    JSON.stringify(payload),
    "pending",
    0,
    batchAvailableAt,
    null,
    null,
    null,
    batchCreatedAt,
    batchCreatedAt,
    null,
    null,
  );

  const ids = inputs.map((input) => input.id);
  const placeholders = ids.map(() => "?").join(", ");
  db.prepare(
    `UPDATE dispatch_inputs SET state = ?, created_at = created_at WHERE id IN (${placeholders})`,
  ).run("batched", ...ids);

  return batchId;
}

function createBatchForEligibleChat(chatId: string, now: number) {
  const cfg = getDispatchConfig();
  if (!isBatchedSequentialMode(cfg)) {
    return null;
  }
  const db = getDb();

  const tx = db.transaction(() => {
    const leased = db
      .prepare(
        [
          "SELECT 1 AS hasLeased FROM dispatch_batches",
          "WHERE chat_id = ? AND status = ?",
          "LIMIT 1",
        ].join(" "),
      )
      .get(chatId, "leased") as { hasLeased: number } | undefined;
    if (leased) {
      // Keep accumulating inputs while another batch for this chat is in-flight.
      return null;
    }

    const state = db
      .prepare("SELECT * FROM dispatch_chat_state WHERE chat_id = ?")
      .get(chatId) as DispatchChatStateRecord | undefined;
    if (!state || !isEligibleForBatch(now, state, cfg)) {
      return null;
    }

    const inputs = db
      .prepare(
        [
          "SELECT * FROM dispatch_inputs",
          "WHERE chat_id = ? AND state = ?",
          "ORDER BY created_at ASC, id ASC",
        ].join(" "),
      )
      .all(chatId, "pending") as DispatchInputRecord[];
    if (inputs.length === 0) {
      updateChatPendingWindow(chatId, now);
      return null;
    }
    const batchId = createDispatchBatchForInputs(db, chatId, inputs, now);
    if (!batchId) {
      updateChatPendingWindow(chatId, now);
      return null;
    }

    updateChatPendingWindow(chatId, now);

    return batchId;
  });

  return tx();
}

function parseAgentIdHint(agentIdsRaw: string | null | undefined) {
  if (!agentIdsRaw) {
    return null;
  }

  try {
    const parsed = JSON.parse(agentIdsRaw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const first = parsed.find(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
}

function claimOnePendingBatch(
  workerId: string,
  leaseMs: number,
  mode: DispatchMode,
): DispatchClaimBatch | null {
  const now = Date.now();
  const db = getDb();

  const tx = db.transaction(() => {
    const row =
      mode === "immediate"
        ? (db
            .prepare(
              [
                "SELECT b.*",
                "FROM dispatch_batches b",
                "WHERE b.status = ?",
                "AND b.available_at <= ?",
                "ORDER BY b.available_at ASC, b.created_at ASC, b.id ASC",
                "LIMIT 1",
              ].join(" "),
            )
            .get("pending", now) as DispatchBatchRecord | undefined)
        : (db
            .prepare(
              [
                "SELECT b.*",
                "FROM dispatch_batches b",
                "WHERE b.status = ?",
                "AND b.available_at <= ?",
                "AND NOT EXISTS (",
                "  SELECT 1 FROM dispatch_batches leased",
                "  WHERE leased.chat_id = b.chat_id AND leased.status = ?",
                ")",
                "AND NOT EXISTS (",
                "  SELECT 1 FROM dispatch_batches earlier",
                "  WHERE earlier.chat_id = b.chat_id",
                "  AND earlier.status IN (?, ?)",
                "  AND (earlier.created_at < b.created_at OR (earlier.created_at = b.created_at AND earlier.id < b.id))",
                ")",
                "ORDER BY b.available_at ASC, b.created_at ASC, b.id ASC",
                "LIMIT 1",
              ].join(" "),
            )
            .get("pending", now, "leased", "pending", "leased") as
            | DispatchBatchRecord
            | undefined);
    if (!row) {
      return null;
    }

    const leaseExpiresAt = now + Math.max(1_000, leaseMs);
    const updateResult =
      mode === "immediate"
        ? db
            .prepare(
              [
                "UPDATE dispatch_batches",
                "SET status = ?,",
                "attempt_count = attempt_count + 1,",
                "lease_owner = ?,",
                "lease_expires_at = ?,",
                "updated_at = ?,",
                "started_at = COALESCE(started_at, ?)",
                "WHERE id = ? AND status = ? AND available_at <= ?",
              ].join(" "),
            )
            .run(
              "leased",
              workerId,
              leaseExpiresAt,
              now,
              now,
              row.id,
              "pending",
              now,
            )
        : db
            .prepare(
              [
                "UPDATE dispatch_batches",
                "SET status = ?,",
                "attempt_count = attempt_count + 1,",
                "lease_owner = ?,",
                "lease_expires_at = ?,",
                "updated_at = ?,",
                "started_at = COALESCE(started_at, ?)",
                "WHERE id = ? AND status = ? AND available_at <= ?",
                "AND NOT EXISTS (",
                "  SELECT 1 FROM dispatch_batches leased",
                "  WHERE leased.chat_id = ? AND leased.status = ? AND leased.id <> ?",
                ")",
                "AND NOT EXISTS (",
                "  SELECT 1 FROM dispatch_batches earlier",
                "  WHERE earlier.chat_id = ?",
                "  AND earlier.status IN (?, ?)",
                "  AND (earlier.created_at < ? OR (earlier.created_at = ? AND earlier.id < ?))",
                ")",
              ].join(" "),
            )
            .run(
              "leased",
              workerId,
              leaseExpiresAt,
              now,
              now,
              row.id,
              "pending",
              now,
              row.chat_id,
              "leased",
              row.id,
              row.chat_id,
              "pending",
              "leased",
              row.created_at,
              row.created_at,
              row.id,
            );
    if (updateResult.changes !== 1) {
      return null;
    }

    const payload = parseJsonObject(row.payload) as StoredBatchPayload;
    const chat = db
      .prepare("SELECT agent_ids FROM chats WHERE id = ?")
      .get(row.chat_id) as { agent_ids: string | null } | undefined;

    return {
      batchId: row.id,
      chatId: row.chat_id,
      kind: row.kind,
      agentIdHint: parseAgentIdHint(chat?.agent_ids),
      compiledContent:
        typeof payload.compiledContent === "string"
          ? payload.compiledContent
          : "",
      items: Array.isArray(payload.items) ? payload.items : [],
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments
        : [],
    } satisfies DispatchClaimBatch;
  });

  return tx();
}

function getBatchForLeaseCheck(batchId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM dispatch_batches WHERE id = ?")
    .get(batchId) as DispatchBatchRecord | undefined;
}

function assertActiveLease(
  batch: DispatchBatchRecord | undefined,
  workerId: string,
  now: number,
): asserts batch is DispatchBatchRecord {
  if (!batch) {
    throw notFoundError("Dispatch batch not found.");
  }

  if (
    batch.status !== "leased" ||
    batch.lease_owner !== workerId ||
    batch.lease_expires_at === null ||
    batch.lease_expires_at <= now
  ) {
    throw conflictError("Dispatch lease is no longer owned by this worker.", {
      batchId: batch.id,
      workerId,
    });
  }
}

function buildFailureMessage(reason: string, attemptCount: number) {
  return `Dispatch failed after ${attemptCount} attempts: ${reason}`;
}

function appendDispatchFailureSystemMessage(chatId: string, text: string) {
  const db = getDb();
  const now = Date.now();
  const messageId = nanoid();
  const preview = text.slice(0, PREVIEW_MAX_CHARS);

  const tx = db.transaction(() => {
    const chat = db
      .prepare("SELECT id, model_id FROM chats WHERE id = ?")
      .get(chatId) as { id: string; model_id: string | null } | undefined;
    if (!chat) {
      return null;
    }

    db.prepare(
      [
        "INSERT INTO messages (",
        "id, chat_id, role, sender_id, created_at, updated_at, content_final, content_partial, stream_state, model_id, trace",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(
      messageId,
      chatId,
      "system",
      "system",
      now,
      now,
      text,
      null,
      "complete",
      chat.model_id,
      JSON.stringify({ dispatchFailure: true }),
    );

    db.prepare(
      [
        "UPDATE chats",
        "SET last_message_preview = ?, last_message_role = ?, last_message_at = ?, unread_count = unread_count + 1, updated_at = ?",
        "WHERE id = ?",
      ].join(" "),
    ).run(preview, "system", now, now, chatId);

    return { messageId };
  });

  const result = tx();
  if (!result) {
    return;
  }

  emitEvent("message.created", {
    chatId,
    messageId,
    role: "system",
    senderId: "system",
    streamState: "complete",
    contentFinal: text,
    createdAt: new Date(now).toISOString(),
    trace: { dispatchFailure: true },
  });
}

function computeRetryDelayMs(attemptCount: number, explicitDelayMs?: number) {
  if (
    typeof explicitDelayMs === "number" &&
    Number.isFinite(explicitDelayMs) &&
    explicitDelayMs >= 0
  ) {
    return explicitDelayMs;
  }

  const cfg = getDispatchConfig();
  const exponential = cfg.retryBaseMs * 2 ** Math.max(0, attemptCount - 1);
  return Math.min(cfg.retryMaxMs, exponential);
}

export function enqueueDispatchInputForUserMessage(input: {
  chatId: string;
  messageId: string;
  senderId: string;
  content: string | null;
  trace: Record<string, unknown> | null;
}) {
  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable()) {
    return;
  }

  const mediaIds = normalizeStringArray(input.trace?.mediaIds).concat(
    typeof input.trace?.mediaId === "string" ? [input.trace.mediaId] : [],
  );
  const traceKind =
    typeof input.trace?.kind === "string" ? input.trace.kind : undefined;
  const now = Date.now();
  const db = getDb();

  const tx = db.transaction(() => {
    const inputId = nanoid();
    db.prepare(
      [
        "INSERT INTO dispatch_inputs (id, chat_id, source_kind, source_id, payload, created_at, state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(
      inputId,
      input.chatId,
      "user_message",
      input.messageId,
      JSON.stringify({
        messageId: input.messageId,
        senderId: input.senderId,
        content: input.content ?? "",
        traceKind,
        mediaIds,
      } satisfies UserMessageInputPayload),
      now,
      "pending",
    );

    if (isBatchedSequentialMode(cfg)) {
      db.prepare(
        [
          "INSERT INTO dispatch_chat_state (chat_id, first_pending_at, last_input_at, last_user_typing_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?)",
          "ON CONFLICT(chat_id) DO UPDATE SET",
          "first_pending_at = COALESCE(dispatch_chat_state.first_pending_at, excluded.first_pending_at),",
          "last_input_at = excluded.last_input_at,",
          "updated_at = excluded.updated_at",
        ].join(" "),
      ).run(input.chatId, now, now, null, now);
      return false;
    }

    createDispatchBatchForInputs(
      db,
      input.chatId,
      [
        {
          id: inputId,
          chat_id: input.chatId,
          source_kind: "user_message",
          source_id: input.messageId,
          payload: JSON.stringify({
            messageId: input.messageId,
            senderId: input.senderId,
            content: input.content ?? "",
            traceKind,
            mediaIds,
          } satisfies UserMessageInputPayload),
          created_at: now,
          state: "pending",
        },
      ],
      now,
    );
    updateChatPendingWindow(input.chatId, now);
    return true;
  });

  const shouldNotify = tx();
  if (shouldNotify) {
    notifyDispatchWorkAvailable();
  }
}

export function enqueueDispatchInputForRequestResolved(input: {
  chatId: string;
  requestId: string;
  senderId: string;
  type: "choice" | "text_input" | "form";
  title: string;
  resolutionPayload: Record<string, unknown> | null;
}) {
  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable()) {
    return;
  }

  const now = Date.now();
  const db = getDb();

  const tx = db.transaction(() => {
    const inputId = nanoid();
    db.prepare(
      [
        "INSERT INTO dispatch_inputs (id, chat_id, source_kind, source_id, payload, created_at, state)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    ).run(
      inputId,
      input.chatId,
      "request_resolved",
      input.requestId,
      JSON.stringify({
        requestId: input.requestId,
        senderId: input.senderId,
        type: input.type,
        title: input.title,
        resolutionPayload: input.resolutionPayload,
      } satisfies RequestResolvedInputPayload),
      now,
      "pending",
    );

    if (isBatchedSequentialMode(cfg)) {
      db.prepare(
        [
          "INSERT INTO dispatch_chat_state (chat_id, first_pending_at, last_input_at, last_user_typing_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?)",
          "ON CONFLICT(chat_id) DO UPDATE SET",
          "first_pending_at = COALESCE(dispatch_chat_state.first_pending_at, excluded.first_pending_at),",
          "last_input_at = excluded.last_input_at,",
          "updated_at = excluded.updated_at",
        ].join(" "),
      ).run(input.chatId, now, now, null, now);
      return false;
    }

    createDispatchBatchForInputs(
      db,
      input.chatId,
      [
        {
          id: inputId,
          chat_id: input.chatId,
          source_kind: "request_resolved",
          source_id: input.requestId,
          payload: JSON.stringify({
            requestId: input.requestId,
            senderId: input.senderId,
            type: input.type,
            title: input.title,
            resolutionPayload: input.resolutionPayload,
          } satisfies RequestResolvedInputPayload),
          created_at: now,
          state: "pending",
        },
      ],
      now,
    );
    updateChatPendingWindow(input.chatId, now);
    return true;
  });

  const shouldNotify = tx();
  if (shouldNotify) {
    notifyDispatchWorkAvailable();
  }
}

export function recordDispatchUserTyping(chatId: string, atMs = Date.now()) {
  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable() || !isBatchedSequentialMode(cfg)) {
    return;
  }

  const db = getDb();
  db.prepare(
    [
      "INSERT INTO dispatch_chat_state (chat_id, first_pending_at, last_input_at, last_user_typing_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?)",
      "ON CONFLICT(chat_id) DO UPDATE SET",
      "last_user_typing_at = excluded.last_user_typing_at,",
      "updated_at = excluded.updated_at",
    ].join(" "),
  ).run(chatId, null, null, atMs, atMs);
}

export function runDispatchBatchSchedulerIteration(now = Date.now()) {
  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable() || !isBatchedSequentialMode(cfg)) {
    return 0;
  }

  const db = getDb();
  const eligibleChats = db
    .prepare(
      [
        "SELECT s.chat_id",
        "FROM dispatch_chat_state s",
        "WHERE s.first_pending_at IS NOT NULL",
        "AND s.last_input_at IS NOT NULL",
        "AND EXISTS (",
        "  SELECT 1 FROM dispatch_inputs i",
        "  WHERE i.chat_id = s.chat_id AND i.state = 'pending'",
        ")",
        "AND NOT EXISTS (",
        "  SELECT 1 FROM dispatch_batches leased",
        "  WHERE leased.chat_id = s.chat_id AND leased.status = 'leased'",
        ")",
        "AND (",
        "  ? >= s.first_pending_at + ?",
        "  OR (",
        "    ? >= s.last_input_at + ?",
        "    AND (s.last_user_typing_at IS NULL OR s.last_user_typing_at < s.first_pending_at OR ? >= s.last_user_typing_at + ?)",
        "  )",
        ")",
        "ORDER BY s.first_pending_at ASC",
      ].join(" "),
    )
    .all(
      now,
      cfg.maxBatchWaitMs,
      now,
      cfg.batchDebounceMs,
      now,
      cfg.typingGraceMs,
    ) as Array<{ chat_id: string }>;

  let createdCount = 0;
  for (const row of eligibleChats) {
    const created = createBatchForEligibleChat(row.chat_id, now);
    if (created) {
      createdCount += 1;
    }
  }

  if (createdCount > 0) {
    notifyDispatchWorkAvailable();
  }

  return createdCount;
}

export function runDispatchLeaseSweeper(now = Date.now()) {
  if (!getDispatchSchemaAvailable()) {
    return 0;
  }

  const db = getDb();
  const result = db
    .prepare(
      [
        "UPDATE dispatch_batches",
        "SET status = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?,",
        "last_error = COALESCE(last_error, 'lease expired')",
        "WHERE status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
      ].join(" "),
    )
    .run("pending", now, now, "leased", now);

  if (result.changes > 0) {
    notifyDispatchWorkAvailable();
  }

  return result.changes;
}

export async function claimDispatchBatches(
  input: ClaimDispatchBatchesInput,
): Promise<DispatchClaimBatch[]> {
  ensureDispatchSchemaAvailable();
  const cfg = getDispatchConfig();

  const leaseMs = Math.max(1_000, input.leaseMs);
  const waitMs = Math.max(0, input.waitMs);
  const configuredLimit = Math.max(
    1,
    Math.min(CLAIM_MANY_HARD_LIMIT, cfg.claim.claimManyLimit),
  );
  const limit = Math.max(1, Math.min(configuredLimit, input.limit));
  const deadline = Date.now() + waitMs;

  for (;;) {
    const claimedBatches: DispatchClaimBatch[] = [];
    for (let idx = 0; idx < limit; idx += 1) {
      const claimed = claimOnePendingBatch(input.workerId, leaseMs, cfg.mode);
      if (!claimed) {
        break;
      }
      claimedBatches.push(claimed);
    }
    if (claimedBatches.length > 0) {
      return claimedBatches;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return [];
    }

    await waitForDispatchWorkSignal(
      Math.min(CLAIM_WAIT_FALLBACK_TICK_MS, remainingMs),
      input.signal,
    );
    if (input.signal?.aborted) {
      return [];
    }
  }
}

export async function claimDispatchBatch(
  input: ClaimDispatchBatchInput,
): Promise<DispatchClaimBatch | null> {
  const claimed = await claimDispatchBatches({
    ...input,
    limit: 1,
  });
  return claimed[0] ?? null;
}

export function heartbeatDispatchBatch(
  batchId: string,
  workerId: string,
  extendMs: number,
) {
  ensureDispatchSchemaAvailable();
  const now = Date.now();
  const batch = getBatchForLeaseCheck(batchId);
  assertActiveLease(batch, workerId, now);

  const db = getDb();
  const leaseExpiresAt = now + Math.max(1_000, extendMs);
  const result = db
    .prepare(
      [
        "UPDATE dispatch_batches",
        "SET lease_expires_at = ?, updated_at = ?",
        "WHERE id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?",
      ].join(" "),
    )
    .run(leaseExpiresAt, now, batchId, "leased", workerId, now);
  if (result.changes !== 1) {
    throw conflictError("Dispatch lease is no longer owned by this worker.", {
      batchId,
      workerId,
    });
  }
}

export function completeDispatchBatch(batchId: string, workerId: string) {
  ensureDispatchSchemaAvailable();
  const now = Date.now();
  const batch = getBatchForLeaseCheck(batchId);
  assertActiveLease(batch, workerId, now);

  const db = getDb();
  const result = db
    .prepare(
      [
        "UPDATE dispatch_batches",
        "SET status = ?, lease_owner = NULL, lease_expires_at = NULL, completed_at = ?, updated_at = ?",
        "WHERE id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?",
      ].join(" "),
    )
    .run("completed", now, now, batchId, "leased", workerId, now);
  if (result.changes !== 1) {
    throw conflictError("Dispatch lease is no longer owned by this worker.", {
      batchId,
      workerId,
    });
  }

  notifyDispatchWorkAvailable();
}

export function failDispatchBatch(
  batchId: string,
  input: FailDispatchBatchInput,
) {
  ensureDispatchSchemaAvailable();
  const now = Date.now();
  const batch = getBatchForLeaseCheck(batchId);
  assertActiveLease(batch, input.workerId, now);

  const cfg = getDispatchConfig();
  const shouldRetry = input.retryable && batch.attempt_count < cfg.maxAttempts;
  const db = getDb();

  if (shouldRetry) {
    const retryDelayMs = computeRetryDelayMs(
      batch.attempt_count,
      input.retryDelayMs,
    );
    const result = db
      .prepare(
        [
          "UPDATE dispatch_batches",
          "SET status = ?, lease_owner = NULL, lease_expires_at = NULL, available_at = ?,",
          "last_error = ?, updated_at = ?",
          "WHERE id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?",
        ].join(" "),
      )
      .run(
        "pending",
        now + retryDelayMs,
        input.reason,
        now,
        batchId,
        "leased",
        input.workerId,
        now,
      );
    if (result.changes !== 1) {
      throw conflictError("Dispatch lease is no longer owned by this worker.", {
        batchId,
        workerId: input.workerId,
      });
    }
    notifyDispatchWorkAvailable();
    return { terminal: false };
  }

  const result = db
    .prepare(
      [
        "UPDATE dispatch_batches",
        "SET status = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = ?,",
        "completed_at = ?, updated_at = ?",
        "WHERE id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?",
      ].join(" "),
    )
    .run(
      "failed",
      input.reason,
      now,
      now,
      batchId,
      "leased",
      input.workerId,
      now,
    );
  if (result.changes !== 1) {
    throw conflictError("Dispatch lease is no longer owned by this worker.", {
      batchId,
      workerId: input.workerId,
    });
  }

  notifyDispatchWorkAvailable();

  appendDispatchFailureSystemMessage(
    batch.chat_id,
    buildFailureMessage(input.reason, batch.attempt_count),
  );
  return { terminal: true };
}

export function startDispatchBatchScheduler() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable() || !isBatchedSequentialMode(cfg)) {
    return false;
  }

  const scopedGlobal = globalThis as typeof globalThis & {
    [DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };
  if (scopedGlobal[DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY]) {
    return false;
  }

  const interval = setInterval(() => {
    try {
      runDispatchBatchSchedulerIteration();
    } catch {
      // Keep scheduler alive even if an iteration fails.
    }
  }, cfg.schedulerTickMs);
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  scopedGlobal[DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY] = interval;
  return true;
}

export function startDispatchLeaseSweeper() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  const cfg = getDispatchConfig();
  if (!getDispatchSchemaAvailable()) {
    return false;
  }

  const scopedGlobal = globalThis as typeof globalThis & {
    [DISPATCH_LEASE_SWEEPER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };
  if (scopedGlobal[DISPATCH_LEASE_SWEEPER_GLOBAL_KEY]) {
    return false;
  }

  const interval = setInterval(() => {
    try {
      runDispatchLeaseSweeper();
    } catch {
      // Keep sweeper alive even if one iteration fails.
    }
  }, cfg.schedulerTickMs);
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  scopedGlobal[DISPATCH_LEASE_SWEEPER_GLOBAL_KEY] = interval;
  return true;
}

export function resetDispatchServiceForTests() {
  dispatchSchemaState = "unknown";
  lastBatchCreatedAtMs = 0;

  const scopedGlobal = globalThis as typeof globalThis & {
    [DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
    [DISPATCH_LEASE_SWEEPER_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
    [DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]?: Set<() => void>;
  };

  if (scopedGlobal[DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY]) {
    clearInterval(scopedGlobal[DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY]);
    delete scopedGlobal[DISPATCH_BATCH_SCHEDULER_GLOBAL_KEY];
  }
  if (scopedGlobal[DISPATCH_LEASE_SWEEPER_GLOBAL_KEY]) {
    clearInterval(scopedGlobal[DISPATCH_LEASE_SWEEPER_GLOBAL_KEY]);
    delete scopedGlobal[DISPATCH_LEASE_SWEEPER_GLOBAL_KEY];
  }
  if (scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]) {
    const waiters = Array.from(scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]);
    scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY]?.clear();
    for (const waiter of waiters) {
      try {
        waiter();
      } catch {
        // no-op
      }
    }
    delete scopedGlobal[DISPATCH_CLAIM_WAITERS_GLOBAL_KEY];
  }
}
