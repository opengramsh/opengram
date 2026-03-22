// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatPageEffects } from '@/app/chats/[chatId]/_hooks/use-chat-page-effects';
import type { ChatPageData } from '@/app/chats/[chatId]/_hooks/use-chat-page-data';

const { subscribeToKeyboardLayoutMock } = vi.hoisted(() => ({
  subscribeToKeyboardLayoutMock: vi.fn(),
}));

vi.mock('@/app/chats/[chatId]/_lib/active-chat-idb', () => ({
  setActiveChatId: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/src/lib/api-fetch', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
}));

vi.mock('@/src/lib/keyboard-layout', () => ({
  subscribeToKeyboardLayout: subscribeToKeyboardLayoutMock,
}));

vi.mock('@/src/lib/chat', () => ({
  applyStreamingChunk: vi.fn((messages) => messages),
  applyStreamingComplete: vi.fn((messages) => messages),
  resolveEdgeSwipeBack: vi.fn(() => false),
  shouldStartEdgeSwipeBack: vi.fn(() => false),
  upsertFeedMessage: vi.fn((messages) => messages),
}));

vi.mock('@/src/lib/events-stream', () => ({
  subscribeToEventsStream: vi.fn(() => () => {}),
}));

function createChatPageData(overrides: Partial<ChatPageData> = {}): ChatPageData {
  return {
    chatId: undefined,
    chat: null,
    models: [],
    loading: false,
    messagesLoading: false,
    error: null,
    primaryAgent: undefined,
    messages: [],
    media: [],
    inlineMessageMedia: new Map(),
    feedRef: { current: null },
    keyboardOffset: 0,
    pendingRequests: [],
    isRequestWidgetOpen: false,
    requestDrafts: {},
    requestErrors: {},
    resolvingRequestIds: new Set(),
    composerText: '',
    setComposerText: vi.fn(),
    isSending: false,
    pendingReply: false,
    setPendingReply: vi.fn(),
    isComposerMenuOpen: false,
    allAttachmentsReady: true,
    pendingAttachments: [],
    removePendingAttachment: vi.fn(),
    retryUpload: vi.fn(),
    isMediaGalleryOpen: false,
    mediaFilter: 'all',
    filteredGalleryMedia: [],
    galleryImageMedia: [],
    galleryListMedia: [],
    viewerMedia: undefined,
    previewFile: undefined,
    isChatMenuOpen: false,
    isCameraOpen: false,
    isEditingTitle: false,
    titleInput: '',
    titleError: null,
    titleInputRef: { current: null },
    cameraInputRef: { current: null },
    photosInputRef: { current: null },
    filesInputRef: { current: null },
    isUpdatingChatSettings: false,
    knownMessageIdsRef: { current: new Set() },
    swipeRef: {
      current: {
        active: false,
        startX: 0,
        startY: 0,
        startAt: 0,
        triggered: false,
        moved: false,
      },
    },
    loadData: vi.fn(() => Promise.resolve()),
    typingTitle: null,
    setTypingTitle: vi.fn(),
    setKeyboardOffset: vi.fn(),
    setIsEditingTitle: vi.fn(),
    setTitleInput: vi.fn(),
    setTitleError: vi.fn(),
    setMessages: vi.fn(),
    setPendingRequests: vi.fn(),
    setMedia: vi.fn(),
    setChat: vi.fn(),
    setError: vi.fn(),
    setIsComposerMenuOpen: vi.fn(),
    setIsMediaGalleryOpen: vi.fn(),
    setMediaFilter: vi.fn(),
    setViewerMediaId: vi.fn(),
    setPreviewFileId: vi.fn(),
    setIsChatMenuOpen: vi.fn(),
    setIsCameraOpen: vi.fn(),
    setIsRequestWidgetOpen: vi.fn(),
    refreshMessages: vi.fn(() => Promise.resolve()),
    refreshPendingRequests: vi.fn(() => Promise.resolve()),
    refreshMedia: vi.fn(() => Promise.resolve()),
    updateRequestDraft: vi.fn(),
    resolvePendingRequest: vi.fn(() => Promise.resolve()),
    scrollToMessageIdRef: { current: null },
    clearScrollToMessageId: vi.fn(),
    scrollToBottom: vi.fn(),
    saveTitle: vi.fn(() => Promise.resolve()),
    goBack: vi.fn(),
    sendMessage: vi.fn(() => Promise.resolve()),
    uploadComposerFiles: vi.fn(() => Promise.resolve()),
    patchChatSettings: vi.fn(() => Promise.resolve()),
    archiveCurrentChat: vi.fn(() => Promise.resolve()),
    unarchiveCurrentChat: vi.fn(() => Promise.resolve()),
    isRecording: false,
    recordingSeconds: 0,
    audioLevels: [],
    isUploadingVoiceNote: false,
    showMicSettingsPrompt: false,
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
    resetRecordingState: vi.fn(),
    handleMicAction: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as ChatPageData;
}

function TestHarness({ data }: { data: ChatPageData }) {
  useChatPageEffects(data);
  return null;
}

describe('chat keyboard scroll behavior', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--keyboard-offset');
    vi.clearAllMocks();
  });

  it('updates keyboard offset without snapping the feed to the bottom', () => {
    let onKeyboardLayout: ((layout: { keyboardOffset: number }) => void) | null = null;

    subscribeToKeyboardLayoutMock.mockImplementation((_window, _document, callback) => {
      onKeyboardLayout = callback;
      return () => {};
    });

    const setKeyboardOffset = vi.fn();
    const scrollToBottom = vi.fn();

    render(
      <TestHarness
        data={createChatPageData({
          setKeyboardOffset,
          scrollToBottom,
        })}
      />,
    );

    act(() => {
      onKeyboardLayout?.({ keyboardOffset: 248 });
    });

    expect(setKeyboardOffset).toHaveBeenCalledWith(248);
    expect(document.documentElement.style.getPropertyValue('--keyboard-offset')).toBe('248px');
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
