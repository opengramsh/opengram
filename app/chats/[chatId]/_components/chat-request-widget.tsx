'use client';

import { ChevronDown } from 'lucide-react';

import { choiceOptionClass, parseChoiceRequestConfig, parseFormRequestConfig, parseTextInputRequestConfig } from '@/app/chats/[chatId]/_lib/request-utils';
import type { RequestDraftMap, RequestErrorMap, RequestItem } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Textarea } from '@/src/components/ui/textarea';

type ChatRequestWidgetProps = {
  chatLoaded: boolean;
  keyboardOffset: number;
  pendingRequests: RequestItem[];
  isRequestWidgetOpen: boolean;
  requestDrafts: RequestDraftMap;
  requestErrors: RequestErrorMap;
  resolvingRequestIds: Record<string, boolean>;
  setIsRequestWidgetOpen: (updater: (current: boolean) => boolean) => void;
  updateRequestDraft: (requestId: string, updater: (draft: Record<string, unknown>) => Record<string, unknown>) => void;
  resolvePendingRequest: (request: RequestItem) => Promise<void>;
};

export function ChatRequestWidget({
  chatLoaded,
  keyboardOffset,
  pendingRequests,
  isRequestWidgetOpen,
  requestDrafts,
  requestErrors,
  resolvingRequestIds,
  setIsRequestWidgetOpen,
  updateRequestDraft,
  resolvePendingRequest,
}: ChatRequestWidgetProps) {
  if (!chatLoaded || pendingRequests.length === 0) {
    return null;
  }

  return (
    <section
      className="fixed inset-x-0 z-30 w-full px-3"
      style={{ bottom: `calc(76px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
    >
      <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setIsRequestWidgetOpen((current) => !current)}
        >
          <p className="text-xs font-semibold text-amber-100">Pending requests ({pendingRequests.length})</p>
          <ChevronDown size={14} className={isRequestWidgetOpen ? 'text-amber-100' : 'rotate-180 text-amber-100'} />
        </button>
        {isRequestWidgetOpen && (
          <div className="space-y-2 pt-2">
            {pendingRequests.map((request) => {
              const draft = requestDrafts[request.id] ?? {};
              const requestError = requestErrors[request.id];
              const isResolving = Boolean(resolvingRequestIds[request.id]);
              const choiceConfig = request.type === 'choice' ? parseChoiceRequestConfig(request.config) : null;
              const textConfig = request.type === 'text_input' ? parseTextInputRequestConfig(request.config) : null;
              const formConfig = request.type === 'form' ? parseFormRequestConfig(request.config) : null;

              return (
                <div key={request.id} className="rounded-xl border border-amber-200/30 bg-amber-950/30 p-2">
                  <p className="text-xs font-semibold text-amber-50">{request.title}</p>
                  {request.body && <p className="pt-1 text-xs text-amber-100/90">{request.body}</p>}

                  {request.type === 'choice' && choiceConfig && (
                    <div className="pt-2">
                      <div className="flex flex-wrap gap-1">
                        {choiceConfig.options.map((option) => {
                          const selectedIds = Array.isArray(draft.selectedOptionIds)
                            ? (draft.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string')
                            : [];
                          const selected = Array.isArray(draft.selectedOptionIds)
                            ? selectedIds.includes(option.id)
                            : false;
                          const isSingleSelect = choiceConfig.maxSelections === 1;
                          const canAddMore = selectedIds.length < choiceConfig.maxSelections;
                          const disabled = !selected && !isSingleSelect && !canAddMore;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={choiceOptionClass(option.variant, selected, disabled)}
                              disabled={disabled || isResolving}
                              onClick={() => {
                                updateRequestDraft(request.id, (prev) => {
                                  const prevIds = Array.isArray(prev.selectedOptionIds)
                                    ? (prev.selectedOptionIds as unknown[]).filter((item): item is string => typeof item === 'string')
                                    : [];
                                  let nextIds = prevIds;
                                  if (choiceConfig.maxSelections === 1) {
                                    if (prevIds.includes(option.id) && choiceConfig.minSelections === 0) {
                                      nextIds = [];
                                    } else {
                                      nextIds = [option.id];
                                    }
                                  } else if (prevIds.includes(option.id)) {
                                    const tentative = prevIds.filter((id) => id !== option.id);
                                    nextIds = tentative.length < choiceConfig.minSelections ? prevIds : tentative;
                                  } else if (prevIds.length < choiceConfig.maxSelections) {
                                    nextIds = [...prevIds, option.id];
                                  }

                                  return {
                                    ...prev,
                                    selectedOptionIds: nextIds,
                                  };
                                });
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {request.type === 'text_input' && textConfig && (
                    <div className="pt-2">
                      <Input
                        value={typeof draft.text === 'string' ? draft.text : ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          updateRequestDraft(request.id, (prev) => ({ ...prev, text: value }));
                        }}
                        placeholder={textConfig.placeholder}
                        minLength={textConfig.validation.minLength}
                        maxLength={textConfig.validation.maxLength}
                        pattern={textConfig.validation.pattern}
                        className="h-8 rounded-lg border-amber-200/40 bg-amber-950/30 text-xs text-amber-50"
                        disabled={isResolving}
                      />
                    </div>
                  )}

                  {request.type === 'form' && formConfig && (
                    <div className="space-y-1 pt-2">
                      {formConfig.fields.map((field) => {
                        const values = typeof draft.values === 'object' && draft.values && !Array.isArray(draft.values)
                          ? draft.values as Record<string, unknown>
                          : {};
                        const fieldValue = values[field.name];

                        if (field.type === 'checkbox') {
                          return (
                            <div key={field.name} className="flex items-center gap-2">
                              <Checkbox
                                id={`field-${field.name}`}
                                checked={fieldValue === true}
                                onCheckedChange={(checked) => {
                                  updateRequestDraft(request.id, (prev) => {
                                    const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                      ? prev.values as Record<string, unknown>
                                      : {};
                                    return {
                                      ...prev,
                                      values: { ...prevValues, [field.name]: checked === true },
                                    };
                                  });
                                }}
                                disabled={isResolving}
                              />
                              <Label htmlFor={`field-${field.name}`} className="text-xs text-amber-50">
                                {field.label}
                              </Label>
                            </div>
                          );
                        }

                        if (field.type === 'textarea') {
                          return (
                            <div key={field.name}>
                              <Label htmlFor={`field-${request.id}-${field.name}`} className="mb-1 text-[11px] text-amber-100">
                                {field.label}
                                {field.required ? ' *' : ''}
                              </Label>
                              <Textarea
                                id={`field-${request.id}-${field.name}`}
                                value={typeof fieldValue === 'string' ? fieldValue : ''}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  updateRequestDraft(request.id, (prev) => {
                                    const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                      ? prev.values as Record<string, unknown>
                                      : {};
                                    return {
                                      ...prev,
                                      values: { ...prevValues, [field.name]: value },
                                    };
                                  });
                                }}
                                rows={3}
                                className="min-h-0 rounded-lg border-amber-200/40 bg-amber-950/30 text-xs text-amber-50"
                                disabled={isResolving}
                              />
                            </div>
                          );
                        }

                        if (field.type === 'select') {
                          return (
                            <div key={field.name}>
                              <Label htmlFor={`field-${request.id}-${field.name}`} className="mb-1 text-[11px] text-amber-100">
                                {field.label}
                                {field.required ? ' *' : ''}
                              </Label>
                              <select
                                id={`field-${request.id}-${field.name}`}
                                value={typeof fieldValue === 'string' ? fieldValue : ''}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  updateRequestDraft(request.id, (prev) => {
                                    const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                      ? prev.values as Record<string, unknown>
                                      : {};
                                    return {
                                      ...prev,
                                      values: { ...prevValues, [field.name]: value },
                                    };
                                  });
                                }}
                                className="h-8 w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 text-xs text-amber-50 outline-none"
                                disabled={isResolving}
                              >
                                <option value="">Select an option</option>
                                {field.options.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        if (field.type === 'multiselect') {
                          const selected = Array.isArray(fieldValue)
                            ? fieldValue.filter((item): item is string => typeof item === 'string')
                            : [];
                          return (
                            <div key={field.name}>
                              <Label htmlFor={`field-${request.id}-${field.name}`} className="mb-1 text-[11px] text-amber-100">
                                {field.label}
                                {field.required ? ' *' : ''}
                              </Label>
                              <select
                                id={`field-${request.id}-${field.name}`}
                                multiple
                                value={selected}
                                onChange={(event) => {
                                  const next = Array.from(event.currentTarget.selectedOptions).map((item) => item.value);
                                  updateRequestDraft(request.id, (prev) => {
                                    const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                      ? prev.values as Record<string, unknown>
                                      : {};
                                    return {
                                      ...prev,
                                      values: { ...prevValues, [field.name]: next },
                                    };
                                  });
                                }}
                                className="w-full rounded-lg border border-amber-200/40 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-50 outline-none"
                                disabled={isResolving}
                              >
                                {field.options.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        return (
                          <div key={field.name}>
                            <Label htmlFor={`field-${request.id}-${field.name}`} className="mb-1 text-[11px] text-amber-100">
                              {field.label}
                              {field.required ? ' *' : ''}
                            </Label>
                            <Input
                              id={`field-${request.id}-${field.name}`}
                              value={typeof fieldValue === 'string' ? fieldValue : ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                updateRequestDraft(request.id, (prev) => {
                                  const prevValues = typeof prev.values === 'object' && prev.values && !Array.isArray(prev.values)
                                    ? prev.values as Record<string, unknown>
                                    : {};
                                  return {
                                    ...prev,
                                    values: { ...prevValues, [field.name]: value },
                                  };
                                });
                              }}
                              type={field.type === 'date' ? 'date' : 'text'}
                              className="h-8 rounded-lg border-amber-200/40 bg-amber-950/30 text-xs text-amber-50"
                              disabled={isResolving}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {requestError && <p className="pt-2 text-[11px] text-rose-200">{requestError}</p>}
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="xs"
                      className="border-amber-200/50 text-amber-50"
                      onClick={() => void resolvePendingRequest(request)}
                      disabled={isResolving}
                    >
                      {isResolving ? 'Submitting...' : request.type === 'form' && formConfig ? formConfig.submitLabel : 'Submit'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
