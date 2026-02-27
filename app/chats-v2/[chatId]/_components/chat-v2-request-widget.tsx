import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { Checkbox } from '@/src/components/ui/checkbox';
import { cn } from '@/src/lib/utils';
import { parseChoiceRequestConfig, parseTextInputRequestConfig, parseFormRequestConfig, choiceOptionClass } from '../_lib/request-utils';
import type { RequestItem } from '../_lib/types';
import { useChatV2Context } from './chat-v2-provider';

export function ChatV2RequestWidget() {
  const { data, requests } = useChatV2Context();

  if (!data.chat || requests.pendingRequests.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-30 px-3"
      style={{ bottom: 'calc(var(--composer-height, 60px) + 4px)' }}
    >
      <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 backdrop-blur-md">
        {/* Header */}
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-amber-50"
          onClick={() => requests.setIsWidgetOpen((v: boolean) => !v)}
        >
          <span>
            {requests.pendingRequests.length} pending request{requests.pendingRequests.length > 1 ? 's' : ''}
          </span>
          {requests.isWidgetOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {/* Request cards */}
        {requests.isWidgetOpen && (
          <div className="space-y-2 px-3 pb-3">
            {requests.pendingRequests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                draft={requests.drafts[request.id] ?? {}}
                error={requests.errors[request.id] ?? null}
                isResolving={requests.resolving[request.id] ?? false}
                onUpdateDraft={(updater) => requests.updateDraft(request.id, updater)}
                onResolve={() => void requests.resolve(request)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type RequestCardProps = {
  request: RequestItem;
  draft: Record<string, unknown>;
  error: string | null;
  isResolving: boolean;
  onUpdateDraft: (updater: (draft: Record<string, unknown>) => Record<string, unknown>) => void;
  onResolve: () => void;
};

function RequestCard({ request, draft, error, isResolving, onUpdateDraft, onResolve }: RequestCardProps) {
  return (
    <div className="rounded-xl border border-amber-300/20 bg-amber-950/30 p-3 text-sm">
      {request.title && (
        <h4 className="mb-1.5 font-medium text-amber-50">{request.title}</h4>
      )}
      {request.body && (
        <p className="mb-2 text-xs text-amber-100/80">{request.body}</p>
      )}

      {request.type === 'choice' && (
        <ChoiceRequest request={request} draft={draft} isResolving={isResolving} onUpdateDraft={onUpdateDraft} />
      )}
      {request.type === 'text_input' && (
        <TextInputRequest request={request} draft={draft} isResolving={isResolving} onUpdateDraft={onUpdateDraft} />
      )}
      {request.type === 'form' && (
        <FormRequest request={request} draft={draft} isResolving={isResolving} onUpdateDraft={onUpdateDraft} />
      )}

      <div className="mt-2 flex items-center justify-between">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button
          size="sm"
          className="ml-auto"
          disabled={isResolving}
          onClick={onResolve}
        >
          {isResolving ? 'Submitting...' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}

function ChoiceRequest({ request, draft, isResolving, onUpdateDraft }: Omit<RequestCardProps, 'error' | 'onResolve'>) {
  const config = parseChoiceRequestConfig(request.config);
  const selectedIds = Array.isArray(draft.selectedOptionIds) ? (draft.selectedOptionIds as string[]) : [];

  const toggle = (optionId: string) => {
    if (isResolving) return;
    onUpdateDraft((d) => {
      const current = Array.isArray(d.selectedOptionIds) ? (d.selectedOptionIds as string[]) : [];
      if (config.maxSelections === 1) {
        return { ...d, selectedOptionIds: current.includes(optionId) ? [] : [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...d, selectedOptionIds: current.filter((id) => id !== optionId) };
      }
      if (current.length >= config.maxSelections) return d;
      return { ...d, selectedOptionIds: [...current, optionId] };
    });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {config.options.map((option) => {
        const selected = selectedIds.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={isResolving}
            className={choiceOptionClass(option.variant, selected, isResolving)}
            onClick={() => toggle(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TextInputRequest({ request, draft, isResolving, onUpdateDraft }: Omit<RequestCardProps, 'error' | 'onResolve'>) {
  const config = parseTextInputRequestConfig(request.config);
  const text = typeof draft.text === 'string' ? draft.text : '';

  return (
    <Input
      value={text}
      onChange={(e) => onUpdateDraft((d) => ({ ...d, text: e.target.value }))}
      placeholder={config.placeholder}
      disabled={isResolving}
      maxLength={config.validation.maxLength}
      className="bg-amber-950/20 border-amber-300/20 text-amber-50 placeholder:text-amber-200/40"
    />
  );
}

function FormRequest({ request, draft, isResolving, onUpdateDraft }: Omit<RequestCardProps, 'error' | 'onResolve'>) {
  const config = parseFormRequestConfig(request.config);
  const values = (draft.values && typeof draft.values === 'object' && !Array.isArray(draft.values))
    ? draft.values as Record<string, unknown> : {};

  const updateField = (name: string, value: unknown) => {
    onUpdateDraft((d) => {
      const prev = (d.values && typeof d.values === 'object' && !Array.isArray(d.values)) ? d.values as Record<string, unknown> : {};
      return { ...d, values: { ...prev, [name]: value } };
    });
  };

  return (
    <div className="space-y-2">
      {config.fields.map((field) => (
        <div key={field.name}>
          <label className="mb-0.5 block text-xs font-medium text-amber-100">
            {field.label}
            {field.required && <span className="text-rose-400 ml-0.5">*</span>}
          </label>

          {field.type === 'checkbox' ? (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={values[field.name] === true}
                onCheckedChange={(checked) => updateField(field.name, !!checked)}
                disabled={isResolving}
              />
            </div>
          ) : field.type === 'textarea' ? (
            <Textarea
              value={typeof values[field.name] === 'string' ? values[field.name] as string : ''}
              onChange={(e) => updateField(field.name, e.target.value)}
              disabled={isResolving}
              rows={3}
              className="bg-amber-950/20 border-amber-300/20 text-amber-50"
            />
          ) : field.type === 'select' ? (
            <select
              value={typeof values[field.name] === 'string' ? values[field.name] as string : ''}
              onChange={(e) => updateField(field.name, e.target.value)}
              disabled={isResolving}
              className="w-full rounded-md border border-amber-300/20 bg-amber-950/20 px-2 py-1.5 text-sm text-amber-50"
            >
              <option value="">Select...</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : field.type === 'date' ? (
            <Input
              type="date"
              value={typeof values[field.name] === 'string' ? values[field.name] as string : ''}
              onChange={(e) => updateField(field.name, e.target.value)}
              disabled={isResolving}
              className="bg-amber-950/20 border-amber-300/20 text-amber-50"
            />
          ) : (
            <Input
              value={typeof values[field.name] === 'string' ? values[field.name] as string : ''}
              onChange={(e) => updateField(field.name, e.target.value)}
              disabled={isResolving}
              className="bg-amber-950/20 border-amber-300/20 text-amber-50"
            />
          )}
        </div>
      ))}
    </div>
  );
}
