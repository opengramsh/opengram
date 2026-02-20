import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { notFoundError, validationError } from '@/src/api/http';
import { createSqliteConnection } from '@/src/db/client';
import { emitEvent } from '@/src/services/events-service';
import { notifyRequestCreated } from '@/src/services/push-service';

type RequestType = 'choice' | 'text_input' | 'form';
type RequestStatus = 'pending' | 'resolved' | 'cancelled';
type ResolvedBy = 'user' | 'backend';
type ChoiceVariant = 'primary' | 'secondary' | 'danger';
type FormFieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'date';

type RequestOption = {
  id: string;
  label: string;
  variant?: ChoiceVariant;
};

type ChoiceRequestConfig = {
  options: RequestOption[];
  maxSelections: number;
  minSelections: number;
};

type TextValidationConfig = {
  minLength?: number;
  maxLength?: number;
  pattern?: string | null;
};

type TextInputRequestConfig = {
  placeholder?: string;
  validation?: TextValidationConfig;
};

type FormFieldConfig = {
  name: string;
  type: FormFieldType;
  label?: string;
  required?: boolean;
  options?: string[];
};

type FormRequestConfig = {
  fields: FormFieldConfig[];
  submitLabel?: string;
};

type RequestRecord = {
  id: string;
  chat_id: string;
  type: RequestType;
  status: RequestStatus;
  title: string;
  body: string | null;
  config: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_payload: string | null;
  trace: string | null;
};

type CreateRequestInput = {
  type: unknown;
  title: unknown;
  body?: unknown;
  config: unknown;
  trace?: unknown;
};

type UpdateRequestInput = {
  title?: unknown;
  body?: unknown;
  config?: unknown;
  trace?: unknown;
};

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function ensureObject(value: unknown, field: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${field} must be a JSON object.`, { field });
  }

  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string.`, { field });
  }

  return value;
}

function nullableString(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string or null.`, { field });
  }

  return value;
}

function requiredTrimmedString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw validationError(`${field} must be a string.`, { field });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${field} cannot be empty.`, { field });
  }

  return trimmed;
}

function normalizeType(value: unknown): RequestType {
  if (value === 'choice' || value === 'text_input' || value === 'form') {
    return value;
  }

  throw validationError('type must be one of choice, text_input, form.', { field: 'type' });
}

function normalizeTrace(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return ensureObject(value, 'trace');
}

function normalizeChoiceConfig(config: unknown): ChoiceRequestConfig {
  const objectConfig = ensureObject(config, 'config');
  const optionsRaw = objectConfig.options;
  if (!Array.isArray(optionsRaw) || optionsRaw.length === 0) {
    throw validationError('choice config requires at least one option.', { field: 'config.options' });
  }

  const options: RequestOption[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < optionsRaw.length; index += 1) {
    const option = optionsRaw[index];
    const optionObject = ensureObject(option, `config.options[${index}]`);
    const id = requiredTrimmedString(optionObject.id, `config.options[${index}].id`);
    const label = requiredTrimmedString(optionObject.label, `config.options[${index}].label`);
    const variantRaw = optionObject.variant;
    let variant: ChoiceVariant | undefined;
    if (variantRaw !== undefined) {
      if (variantRaw !== 'primary' && variantRaw !== 'secondary' && variantRaw !== 'danger') {
        throw validationError('option.variant must be one of primary, secondary, danger.', {
          field: `config.options[${index}].variant`,
        });
      }
      variant = variantRaw;
    }

    if (seenIds.has(id)) {
      throw validationError('choice options must have unique ids.', {
        field: 'config.options',
        optionId: id,
      });
    }
    seenIds.add(id);
    options.push(variant ? { id, label, variant } : { id, label });
  }

  const maxSelectionsRaw = objectConfig.maxSelections;
  const minSelectionsRaw = objectConfig.minSelections;

  const maxSelections = (maxSelectionsRaw == null ? 1 : maxSelectionsRaw) as number;
  if (!Number.isInteger(maxSelections) || maxSelections < 1) {
    throw validationError('config.maxSelections must be an integer >= 1.', { field: 'config.maxSelections' });
  }

  const minSelections = (minSelectionsRaw == null ? 0 : minSelectionsRaw) as number;
  if (!Number.isInteger(minSelections) || minSelections < 0) {
    throw validationError('config.minSelections must be an integer >= 0.', { field: 'config.minSelections' });
  }

  if (minSelections > maxSelections) {
    throw validationError('config.minSelections cannot be greater than config.maxSelections.', {
      field: 'config.minSelections',
    });
  }

  return { options, maxSelections, minSelections };
}

function normalizeTextInputConfig(config: unknown): TextInputRequestConfig {
  const objectConfig = ensureObject(config, 'config');
  const placeholder = optionalString(objectConfig.placeholder, 'config.placeholder');

  const validationRaw = objectConfig.validation;
  let validation: TextValidationConfig | undefined;
  if (validationRaw !== undefined) {
    const validationObject = ensureObject(validationRaw, 'config.validation');
    const minLengthRaw = validationObject.minLength;
    const maxLengthRaw = validationObject.maxLength;
    const patternRaw = validationObject.pattern;

    const normalized: TextValidationConfig = {};
    if (minLengthRaw != null) {
      if (!Number.isInteger(minLengthRaw) || (minLengthRaw as number) < 0) {
        throw validationError('config.validation.minLength must be an integer >= 0.', {
          field: 'config.validation.minLength',
        });
      }
      normalized.minLength = minLengthRaw as number;
    }
    if (maxLengthRaw != null) {
      if (!Number.isInteger(maxLengthRaw) || (maxLengthRaw as number) < 1) {
        throw validationError('config.validation.maxLength must be an integer >= 1.', {
          field: 'config.validation.maxLength',
        });
      }
      normalized.maxLength = maxLengthRaw as number;
    }
    if (normalized.minLength !== undefined && normalized.maxLength !== undefined && normalized.minLength > normalized.maxLength) {
      throw validationError('config.validation.minLength cannot exceed maxLength.', {
        field: 'config.validation.minLength',
      });
    }
    if (patternRaw !== undefined) {
      if (patternRaw !== null && typeof patternRaw !== 'string') {
        throw validationError('config.validation.pattern must be a string or null.', {
          field: 'config.validation.pattern',
        });
      }
      if (typeof patternRaw === 'string') {
        try {
          new RegExp(patternRaw);
        } catch {
          throw validationError('config.validation.pattern must be a valid regular expression.', {
            field: 'config.validation.pattern',
          });
        }
      }
      normalized.pattern = patternRaw;
    }

    validation = normalized;
  }

  return validation ? { ...(placeholder === undefined ? {} : { placeholder }), validation } : { ...(placeholder === undefined ? {} : { placeholder }) };
}

function normalizeFormConfig(config: unknown): FormRequestConfig {
  const objectConfig = ensureObject(config, 'config');
  const fieldsRaw = objectConfig.fields;
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
    throw validationError('form config requires at least one field.', { field: 'config.fields' });
  }

  const fields: FormFieldConfig[] = [];
  const fieldNames = new Set<string>();

  for (let index = 0; index < fieldsRaw.length; index += 1) {
    const field = ensureObject(fieldsRaw[index], `config.fields[${index}]`);
    const name = requiredTrimmedString(field.name, `config.fields[${index}].name`);
    const type = field.type;
    if (
      type !== 'text'
      && type !== 'textarea'
      && type !== 'select'
      && type !== 'multiselect'
      && type !== 'checkbox'
      && type !== 'date'
    ) {
      throw validationError('form field type must be text, textarea, select, multiselect, checkbox, or date.', {
        field: `config.fields[${index}].type`,
      });
    }

    if (fieldNames.has(name)) {
      throw validationError('form fields must have unique names.', {
        field: 'config.fields',
        name,
      });
    }
    fieldNames.add(name);

    const label = optionalString(field.label, `config.fields[${index}].label`);
    const requiredRaw = field.required;
    if (requiredRaw !== undefined && typeof requiredRaw !== 'boolean') {
      throw validationError('form field required must be a boolean.', {
        field: `config.fields[${index}].required`,
      });
    }

    const optionsRaw = field.options;
    let options: string[] | undefined;
    if (type === 'select' || type === 'multiselect') {
      if (!Array.isArray(optionsRaw) || optionsRaw.length === 0 || optionsRaw.some((item) => typeof item !== 'string' || !item.trim())) {
        throw validationError('select and multiselect fields require non-empty string options.', {
          field: `config.fields[${index}].options`,
        });
      }
      options = optionsRaw.map((item) => item.trim());
    } else if (optionsRaw !== undefined) {
      throw validationError('options are only supported for select or multiselect fields.', {
        field: `config.fields[${index}].options`,
      });
    }

    fields.push({
      name,
      type,
      ...(label === undefined ? {} : { label }),
      ...(requiredRaw === undefined ? {} : { required: requiredRaw }),
      ...(options ? { options } : {}),
    });
  }

  const submitLabel = optionalString(objectConfig.submitLabel, 'config.submitLabel');
  return submitLabel === undefined ? { fields } : { fields, submitLabel };
}

function normalizeConfig(type: RequestType, config: unknown) {
  if (type === 'choice') {
    return normalizeChoiceConfig(config);
  }

  if (type === 'text_input') {
    return normalizeTextInputConfig(config);
  }

  return normalizeFormConfig(config);
}

function serializeRequest(record: RequestRecord) {
  return {
    id: record.id,
    chat_id: record.chat_id,
    type: record.type,
    status: record.status,
    title: record.title,
    body: record.body,
    config: parseJsonObject(record.config) ?? {},
    created_at: new Date(record.created_at).toISOString(),
    resolved_at: record.resolved_at ? new Date(record.resolved_at).toISOString() : null,
    resolved_by: record.resolved_by,
    resolution_payload: parseJsonObject(record.resolution_payload),
    trace: parseJsonObject(record.trace),
  };
}

function getRequestRecord(db: Database.Database, requestId: string) {
  const record = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as RequestRecord | undefined;
  if (!record) {
    throw notFoundError('Request not found.', { requestId });
  }

  return record;
}

function incrementChatPendingCount(db: Database.Database, chatId: string) {
  db.prepare(
    [
      'UPDATE chats',
      'SET pending_requests_count = pending_requests_count + 1, updated_at = ?',
      'WHERE id = ?',
    ].join(' '),
  ).run(Date.now(), chatId);
}

function decrementChatPendingCount(db: Database.Database, chatId: string) {
  db.prepare(
    [
      'UPDATE chats',
      'SET pending_requests_count = CASE',
      'WHEN pending_requests_count > 0 THEN pending_requests_count - 1',
      'ELSE 0',
      'END, updated_at = ?',
      'WHERE id = ?',
    ].join(' '),
  ).run(Date.now(), chatId);
}

function ensureChatExists(db: Database.Database, chatId: string) {
  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(chatId) as { id: string } | undefined;
  if (!chat) {
    throw notFoundError('Chat not found.', { chatId });
  }
}

function normalizeCreateRequestInput(input: CreateRequestInput) {
  const type = normalizeType(input.type);
  const title = requiredTrimmedString(input.title, 'title');
  const body = nullableString(input.body, 'body');
  const trace = normalizeTrace(input.trace);
  const config = normalizeConfig(type, input.config);

  return {
    type,
    title,
    body: body === undefined ? null : body,
    config,
    trace: trace === undefined ? null : trace,
  };
}

function applyTextInputResolutionValidation(text: string, config: TextInputRequestConfig) {
  const validation = config.validation;
  if (!validation) {
    return;
  }

  if (validation.minLength !== undefined && text.length < validation.minLength) {
    throw validationError('text is shorter than minimum length.', {
      field: 'text',
      minLength: validation.minLength,
    });
  }

  if (validation.maxLength !== undefined && text.length > validation.maxLength) {
    throw validationError('text is longer than maximum length.', {
      field: 'text',
      maxLength: validation.maxLength,
    });
  }

  if (typeof validation.pattern === 'string') {
    const regex = new RegExp(validation.pattern);
    if (!regex.test(text)) {
      throw validationError('text does not match required pattern.', {
        field: 'text',
      });
    }
  }
}

function normalizeFormResolutionPayload(payloadValues: unknown, config: FormRequestConfig) {
  if (payloadValues === null || typeof payloadValues !== 'object' || Array.isArray(payloadValues)) {
    throw validationError('form resolution requires values object.', { field: 'values' });
  }

  const values = payloadValues as Record<string, unknown>;
  const fieldsByName = new Map(config.fields.map((field) => [field.name, field]));
  const resolvedValues: Record<string, unknown> = {};

  for (const key of Object.keys(values)) {
    const field = fieldsByName.get(key);
    if (!field) {
      throw validationError('values contains unknown field.', {
        field: 'values',
        name: key,
      });
    }

    const value = values[key];
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') {
        throw validationError('checkbox fields require boolean values.', {
          field: `values.${key}`,
        });
      }
      resolvedValues[key] = value;
      continue;
    }

    if (field.type === 'multiselect') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw validationError('multiselect fields require string array values.', {
          field: `values.${key}`,
        });
      }
      if (field.options && value.some((item) => !field.options?.includes(item))) {
        throw validationError('multiselect values contain unknown option.', {
          field: `values.${key}`,
        });
      }
      resolvedValues[key] = value;
      continue;
    }

    if (typeof value !== 'string') {
      throw validationError('field value must be a string.', {
        field: `values.${key}`,
      });
    }

    if (field.type === 'select' && field.options && !field.options.includes(value)) {
      throw validationError('select value must match one of the configured options.', {
        field: `values.${key}`,
      });
    }

    resolvedValues[key] = value;
  }

  for (const field of config.fields) {
    if (!field.required) {
      continue;
    }

    const value = resolvedValues[field.name];
    if (value === undefined) {
      throw validationError('missing required form value.', {
        field: `values.${field.name}`,
      });
    }

    if (typeof value === 'string' && !value.trim()) {
      throw validationError('required form value cannot be empty.', {
        field: `values.${field.name}`,
      });
    }

    if (Array.isArray(value) && value.length === 0) {
      throw validationError('required form value cannot be empty.', {
        field: `values.${field.name}`,
      });
    }
  }

  return { values: resolvedValues };
}

function normalizeResolutionPayload(type: RequestType, payload: unknown, config: Record<string, unknown>) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('resolution payload must be an object.');
  }

  if (type === 'choice') {
    const selectedOptionIds = (payload as { selectedOptionIds?: unknown }).selectedOptionIds;
    if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((item) => typeof item !== 'string')) {
      throw validationError('choice resolution requires selectedOptionIds string array.', {
        field: 'selectedOptionIds',
      });
    }
    if (new Set(selectedOptionIds).size !== selectedOptionIds.length) {
      throw validationError('selectedOptionIds must be unique.', {
        field: 'selectedOptionIds',
      });
    }

    const optionIds = new Set(
      Array.isArray(config.options)
        ? config.options
            .map((option) => (option && typeof option === 'object' ? (option as { id?: unknown }).id : undefined))
            .filter((id): id is string => typeof id === 'string')
        : [],
    );

    for (const optionId of selectedOptionIds) {
      if (optionIds.size > 0 && !optionIds.has(optionId)) {
        throw validationError('selectedOptionIds contains unknown option.', { field: 'selectedOptionIds', optionId });
      }
    }

    const normalizedConfig = normalizeChoiceConfig(config);
    if (selectedOptionIds.length < normalizedConfig.minSelections) {
      throw validationError('selectedOptionIds does not satisfy minimum selections.', {
        field: 'selectedOptionIds',
        minSelections: normalizedConfig.minSelections,
      });
    }
    if (selectedOptionIds.length > normalizedConfig.maxSelections) {
      throw validationError('selectedOptionIds exceeds maximum selections.', {
        field: 'selectedOptionIds',
        maxSelections: normalizedConfig.maxSelections,
      });
    }

    return { selectedOptionIds };
  }

  if (type === 'text_input') {
    const text = (payload as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) {
      throw validationError('text_input resolution requires non-empty text.', { field: 'text' });
    }
    const trimmedText = text.trim();
    applyTextInputResolutionValidation(trimmedText, normalizeTextInputConfig(config));
    return { text: trimmedText };
  }

  const values = (payload as { values?: unknown }).values;
  return normalizeFormResolutionPayload(values, normalizeFormConfig(config));
}

function parseResolvedBy(value: unknown): ResolvedBy | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'user' || value === 'backend') {
    return value;
  }

  throw validationError('resolvedBy must be one of user, backend.', { field: 'resolvedBy' });
}

export function createRequest(chatId: string, input: CreateRequestInput) {
  return withDb((db) => {
    ensureChatExists(db, chatId);
    const normalized = normalizeCreateRequestInput(input);
    const now = Date.now();
    const requestId = nanoid();

    db.prepare(
      [
        'INSERT INTO requests (id, chat_id, type, status, title, body, config, created_at, trace)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      requestId,
      chatId,
      normalized.type,
      'pending',
      normalized.title,
      normalized.body,
      JSON.stringify(normalized.config),
      now,
      normalized.trace === null ? null : JSON.stringify(normalized.trace),
    );

    incrementChatPendingCount(db, chatId);

    emitEvent('request.created', {
      chatId,
      requestId,
      type: normalized.type,
      title: normalized.title,
    });

    void notifyRequestCreated({
      chatId,
      title: normalized.title,
    }).catch((error) => {
      console.error('Failed to send request.created push notification.', error);
    });

    const created = getRequestRecord(db, requestId);
    return serializeRequest(created);
  });
}

export function updateRequest(requestId: string, input: UpdateRequestInput) {
  return withDb((db) => {
    const current = getRequestRecord(db, requestId);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (Object.keys(input).length === 0) {
      throw validationError('At least one updatable field is required.');
    }

    const allowedKeys = new Set(['title', 'body', 'config', 'trace']);
    for (const key of Object.keys(input)) {
      if (!allowedKeys.has(key)) {
        throw validationError('Only title, body, config, and trace can be updated.', {
          field: key,
        });
      }
    }

    if (Object.hasOwn(input, 'title')) {
      const title = requiredTrimmedString(input.title, 'title');
      updates.push('title = ?');
      values.push(title);
    }

    if (Object.hasOwn(input, 'body')) {
      const body = nullableString(input.body, 'body');
      updates.push('body = ?');
      values.push(body ?? null);
    }

    if (Object.hasOwn(input, 'config')) {
      const config = normalizeConfig(current.type, input.config);
      updates.push('config = ?');
      values.push(JSON.stringify(config));
    }

    if (Object.hasOwn(input, 'trace')) {
      const trace = normalizeTrace(input.trace);
      updates.push('trace = ?');
      values.push(trace === null ? null : JSON.stringify(trace));
    }

    if (updates.length === 0) {
      throw validationError('At least one updatable field is required.');
    }

    db.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE id = ?`).run(...values, requestId);
    const updated = getRequestRecord(db, requestId);
    return serializeRequest(updated);
  });
}

export function cancelRequest(requestId: string) {
  return withDb((db) => {
    const current = getRequestRecord(db, requestId);
    if (current.status !== 'pending') {
      throw validationError('Only pending requests can be cancelled.', { requestId, status: current.status });
    }

    db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('cancelled', requestId);
    decrementChatPendingCount(db, current.chat_id);
    const updated = getRequestRecord(db, requestId);
    const serialized = serializeRequest(updated);

    emitEvent('request.cancelled', {
      chatId: serialized.chat_id,
      requestId: serialized.id,
      type: serialized.type,
      status: serialized.status,
      resolution_payload: serialized.resolution_payload,
      trace: serialized.trace,
    });

    return serialized;
  });
}

export function listChatRequests(chatId: string, status: RequestStatus | 'all' = 'pending') {
  return withDb((db) => {
    ensureChatExists(db, chatId);

    const rows = (
      status === 'all'
        ? db
            .prepare('SELECT * FROM requests WHERE chat_id = ? ORDER BY created_at ASC, id ASC')
            .all(chatId)
        : db
            .prepare('SELECT * FROM requests WHERE chat_id = ? AND status = ? ORDER BY created_at ASC, id ASC')
            .all(chatId, status)
    ) as RequestRecord[];

    return rows.map(serializeRequest);
  });
}

export function resolveRequest(requestId: string, payload: unknown) {
  return withDb((db) => {
    const current = getRequestRecord(db, requestId);
    if (current.status !== 'pending') {
      throw validationError('Only pending requests can be resolved.', { requestId, status: current.status });
    }

    const config = parseJsonObject(current.config) ?? {};
    const resolutionPayload = normalizeResolutionPayload(current.type, payload, config);
    const now = Date.now();

    const resolvedBy = parseResolvedBy((payload as { resolvedBy?: unknown }).resolvedBy) ?? 'user';

    db.prepare(
      [
        'UPDATE requests',
        'SET status = ?, resolved_at = ?, resolved_by = ?, resolution_payload = ?',
        'WHERE id = ?',
      ].join(' '),
    ).run('resolved', now, resolvedBy, JSON.stringify(resolutionPayload), requestId);

    decrementChatPendingCount(db, current.chat_id);
    const updated = getRequestRecord(db, requestId);
    const serialized = serializeRequest(updated);

    emitEvent('request.resolved', {
      chatId: serialized.chat_id,
      requestId: serialized.id,
      type: serialized.type,
      status: serialized.status,
      resolution_payload: serialized.resolution_payload,
      trace: serialized.trace,
    });

    return serialized;
  });
}
