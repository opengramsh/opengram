import type {
  ChoiceRequestConfig,
  ChoiceRequestOption,
  ChoiceVariant,
  FormRequestConfig,
  FormRequestField,
  RequestDraftMap,
  RequestItem,
  TextInputRequestConfig,
  TextInputValidationConfig,
} from './types';

export function parseChoiceRequestConfig(config: Record<string, unknown>): ChoiceRequestConfig {
  const options = Array.isArray(config.options)
    ? config.options
      .map((option) => {
        if (!option || typeof option !== 'object') return null;
        const id = typeof (option as { id?: unknown }).id === 'string' ? (option as { id: string }).id.trim() : '';
        const label = typeof (option as { label?: unknown }).label === 'string' ? (option as { label: string }).label.trim() : '';
        if (!id || !label) return null;
        const variantRaw = (option as { variant?: unknown }).variant;
        const variant: ChoiceVariant = variantRaw === 'primary' || variantRaw === 'danger' ? variantRaw : 'secondary';
        return { id, label, variant };
      })
      .filter((option): option is ChoiceRequestOption => option !== null)
    : [];

  const maxSelectionsRaw = config.maxSelections;
  const minSelectionsRaw = config.minSelections;
  const maxSelections = Number.isInteger(maxSelectionsRaw) && (maxSelectionsRaw as number) >= 1
    ? (maxSelectionsRaw as number) : 1;
  const minSelectionsCandidate = Number.isInteger(minSelectionsRaw) && (minSelectionsRaw as number) >= 0
    ? (minSelectionsRaw as number) : 0;
  const minSelections = Math.min(minSelectionsCandidate, maxSelections);

  return { options, maxSelections, minSelections };
}

export function parseTextInputRequestConfig(config: Record<string, unknown>): TextInputRequestConfig {
  const placeholder = typeof config.placeholder === 'string' && config.placeholder.trim()
    ? config.placeholder : 'Type your response';
  const validation: TextInputValidationConfig = {};
  const validationRaw = config.validation;
  if (validationRaw && typeof validationRaw === 'object' && !Array.isArray(validationRaw)) {
    const minLengthRaw = (validationRaw as { minLength?: unknown }).minLength;
    const maxLengthRaw = (validationRaw as { maxLength?: unknown }).maxLength;
    const patternRaw = (validationRaw as { pattern?: unknown }).pattern;
    if (Number.isInteger(minLengthRaw) && (minLengthRaw as number) >= 0) validation.minLength = minLengthRaw as number;
    if (Number.isInteger(maxLengthRaw) && (maxLengthRaw as number) > 0) validation.maxLength = maxLengthRaw as number;
    if (validation.minLength !== undefined && validation.maxLength !== undefined && validation.minLength > validation.maxLength) {
      validation.minLength = validation.maxLength;
    }
    if (typeof patternRaw === 'string') {
      try { new RegExp(patternRaw); validation.pattern = patternRaw; } catch { /* ignore invalid */ }
    }
  }
  return { placeholder, validation };
}

export function parseFormRequestConfig(config: Record<string, unknown>): FormRequestConfig {
  const fields = Array.isArray(config.fields)
    ? config.fields
      .map((field) => {
        if (!field || typeof field !== 'object') return null;
        const name = typeof (field as { name?: unknown }).name === 'string' ? (field as { name: string }).name.trim() : '';
        if (!name) return null;
        const typeRaw = (field as { type?: unknown }).type;
        if (typeRaw !== 'text' && typeRaw !== 'textarea' && typeRaw !== 'select' && typeRaw !== 'multiselect' && typeRaw !== 'checkbox' && typeRaw !== 'date') return null;
        const labelRaw = (field as { label?: unknown }).label;
        const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw : name;
        const required = (field as { required?: unknown }).required === true;
        const optionsRaw = (field as { options?: unknown }).options;
        const options = (typeRaw === 'select' || typeRaw === 'multiselect') && Array.isArray(optionsRaw)
          ? optionsRaw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
        return { name, type: typeRaw, label, required, options };
      })
      .filter((field): field is FormRequestField => field !== null)
    : [];

  const submitLabel = typeof config.submitLabel === 'string' && config.submitLabel.trim() ? config.submitLabel : 'Submit';
  return { fields, submitLabel };
}

export function choiceOptionClass(variant: ChoiceVariant, selected: boolean, disabled: boolean) {
  const byVariant: Record<ChoiceVariant, string> = {
    primary: selected
      ? 'border-sky-200 bg-sky-400/30 text-sky-50'
      : 'border-sky-200/50 text-sky-100 hover:bg-sky-300/10',
    secondary: selected
      ? 'border-amber-100 bg-amber-100/20 text-amber-50'
      : 'border-amber-200/40 text-amber-100 hover:bg-amber-100/10',
    danger: selected
      ? 'border-rose-200 bg-rose-500/30 text-rose-50'
      : 'border-rose-200/50 text-rose-100 hover:bg-rose-300/10',
  };
  const disabledClass = disabled ? 'opacity-50' : '';
  return `rounded-lg border px-2 py-1 text-[11px] ${byVariant[variant]} ${disabledClass}`;
}

export function validateRequestResolutionPayload(request: RequestItem, requestDrafts: RequestDraftMap): {
  payload: Record<string, unknown> | null;
  error: string | null;
} {
  const draft = requestDrafts[request.id] ?? {};

  if (request.type === 'choice') {
    const config = parseChoiceRequestConfig(request.config);
    const selectedIds = Array.isArray(draft.selectedOptionIds)
      ? (draft.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string') : [];
    const allowedIds = new Set(config.options.map((option) => option.id));
    const uniqueSelected = Array.from(new Set(selectedIds.filter((id) => allowedIds.has(id))));
    if (uniqueSelected.length < config.minSelections) {
      return { payload: null, error: config.minSelections === 1 ? 'Select at least 1 option.' : `Select at least ${config.minSelections} options.` };
    }
    if (uniqueSelected.length > config.maxSelections) {
      return { payload: null, error: `Select no more than ${config.maxSelections} options.` };
    }
    return { payload: { selectedOptionIds: uniqueSelected }, error: null };
  }

  if (request.type === 'text_input') {
    const config = parseTextInputRequestConfig(request.config);
    const text = typeof draft.text === 'string' ? draft.text.trim() : '';
    if (!text) return { payload: null, error: 'Response cannot be empty.' };
    if (config.validation.minLength !== undefined && text.length < config.validation.minLength)
      return { payload: null, error: `Response must be at least ${config.validation.minLength} characters.` };
    if (config.validation.maxLength !== undefined && text.length > config.validation.maxLength)
      return { payload: null, error: `Response must be ${config.validation.maxLength} characters or fewer.` };
    if (config.validation.pattern) {
      const regex = new RegExp(config.validation.pattern);
      if (!regex.test(text)) return { payload: null, error: 'Response does not match the required format.' };
    }
    return { payload: { text }, error: null };
  }

  const config = parseFormRequestConfig(request.config);
  const draftValuesRaw = draft.values;
  const draftValues = draftValuesRaw && typeof draftValuesRaw === 'object' && !Array.isArray(draftValuesRaw)
    ? draftValuesRaw as Record<string, unknown> : {};
  const values: Record<string, unknown> = {};

  for (const field of config.fields) {
    const raw = draftValues[field.name];
    if (field.type === 'checkbox') {
      if (typeof raw === 'boolean') values[field.name] = raw;
    } else if (field.type === 'multiselect') {
      const selected = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
      const normalized = selected.filter((item) => field.options.includes(item));
      if (normalized.length > 0) values[field.name] = normalized;
    } else {
      const text = typeof raw === 'string' ? raw : '';
      if (text.length > 0) values[field.name] = text;
    }
  }

  for (const field of config.fields) {
    if (!field.required) continue;
    const value = values[field.name];
    if (value === undefined) return { payload: null, error: `${field.label} is required.` };
    if (typeof value === 'string' && !value.trim()) return { payload: null, error: `${field.label} is required.` };
    if (Array.isArray(value) && value.length === 0) return { payload: null, error: `${field.label} is required.` };
  }

  return { payload: { values }, error: null };
}
