'use client';

import { useCallback } from 'react';

import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { ChatHeader } from '@/app/chats/[chatId]/_components/chat-header';
import { ChatMediaGallery } from '@/app/chats/[chatId]/_components/chat-media-gallery';
import { ChatMenu } from '@/app/chats/[chatId]/_components/chat-menu';
import { ChatMessages } from '@/app/chats/[chatId]/_components/chat-messages';
import { ChatRequestWidget } from '@/app/chats/[chatId]/_components/chat-request-widget';
import { CameraCapture } from '@/app/chats/[chatId]/_components/camera-capture';
import { FilePreviewSection } from '@/app/chats/[chatId]/_components/file-preview-section';
import { DropZoneOverlay } from '@/app/chats/[chatId]/_components/drop-zone-overlay';
import { useChatPageContext } from '@/app/chats/[chatId]/_components/chat-page-provider';
import { useFileDrop } from '@/app/chats/[chatId]/_hooks/use-file-drop';

export function ChatPageSections() {
  const chat = useChatPageContext();

  const handleFileDrop = useCallback(
    (files: FileList) => void chat.uploadComposerFiles(files),
    [chat.uploadComposerFiles],
  );

  const { dropRef, isDragging } = useFileDrop({ onDrop: handleFileDrop });

  return (
    <div ref={dropRef} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <DropZoneOverlay visible={isDragging} />
      <ChatHeaderSection />
      <ChatMessagesSection />
      <ChatRequestWidgetSection />
      <ChatComposerSection />
      <ChatMediaGallerySection />
      <ChatMenuSection />
      <CameraCaptureSection />
      <FilePreviewSectionWrapper />
    </div>
  );
}

function ChatHeaderSection() {
  const chat = useChatPageContext();
  const isStreaming = chat.messages.some((m) => m.stream_state === 'streaming') || chat.pendingReply;

  return (
    <ChatHeader
      chat={chat.chat}
      primaryAgent={chat.primaryAgent}
      isStreaming={isStreaming}
      typingTitle={chat.typingTitle}
      goBack={chat.goBack}
      onTitleClick={() => {
        chat.setTitleInput(chat.chat?.title ?? '');
        chat.setIsChatMenuOpen(true);
      }}
    />
  );
}

function ChatMessagesSection() {
  const chat = useChatPageContext();

  return (
    <ChatMessages
      feedRef={chat.feedRef}
      loading={chat.loading && !chat.chat}
      messagesLoading={chat.messagesLoading}
      error={chat.error}
      messages={chat.messages}
      inlineMessageMedia={chat.inlineMessageMedia}
      pendingReply={chat.pendingReply}
      setViewerMediaId={(id) => chat.setViewerMediaId(id)}
      setPreviewFileId={chat.setPreviewFileId}
      scrollToMessageId={chat.scrollToMessageIdRef.current}
    />
  );
}

function ChatRequestWidgetSection() {
  const chat = useChatPageContext();

  return (
    <ChatRequestWidget
      chatLoaded={Boolean(chat.chat)}
      keyboardOffset={chat.keyboardOffset}
      pendingRequests={chat.pendingRequests}
      isRequestWidgetOpen={chat.isRequestWidgetOpen}
      requestDrafts={chat.requestDrafts}
      requestErrors={chat.requestErrors}
      resolvingRequestIds={chat.resolvingRequestIds}
      setIsRequestWidgetOpen={chat.setIsRequestWidgetOpen}
      updateRequestDraft={chat.updateRequestDraft}
      resolvePendingRequest={chat.resolvePendingRequest}
    />
  );
}

function ChatComposerSection() {
  const chat = useChatPageContext();

  return (
    <ChatComposer
      composerText={chat.composerText}
      isSending={chat.isSending}
      isRecording={chat.isRecording}
      recordingSeconds={chat.recordingSeconds}
      isUploadingVoiceNote={chat.isUploadingVoiceNote}
      showMicSettingsPrompt={chat.showMicSettingsPrompt}
      stopRecording={chat.stopRecording}
      cancelRecording={chat.cancelRecording}
      audioLevels={chat.audioLevels}
      isComposerMenuOpen={chat.isComposerMenuOpen}
      allAttachmentsReady={chat.allAttachmentsReady}
      selectedModelId={''}
      models={[]}
      cameraInputRef={chat.cameraInputRef}
      photosInputRef={chat.photosInputRef}
      filesInputRef={chat.filesInputRef}
      setComposerText={chat.setComposerText}
      setIsComposerMenuOpen={chat.setIsComposerMenuOpen}
      sendMessage={chat.sendMessage}
      handleMicAction={chat.handleMicAction}
      uploadComposerFiles={chat.uploadComposerFiles}
      pendingAttachments={chat.pendingAttachments}
      removePendingAttachment={chat.removePendingAttachment}
      retryUpload={chat.retryUpload}
      onModelChange={async () => {}}
      keyboardOffset={chat.keyboardOffset}
    />
  );
}

function ChatMediaGallerySection() {
  const chat = useChatPageContext();

  return (
    <ChatMediaGallery
      isMediaGalleryOpen={chat.isMediaGalleryOpen}
      setIsMediaGalleryOpen={chat.setIsMediaGalleryOpen}
      mediaFilter={chat.mediaFilter}
      setMediaFilter={chat.setMediaFilter}
      filteredGalleryMedia={chat.filteredGalleryMedia}
      galleryImageMedia={chat.galleryImageMedia}
      galleryListMedia={chat.galleryListMedia}
      viewerMedia={chat.viewerMedia}
      setViewerMediaId={chat.setViewerMediaId}
      setPreviewFileId={chat.setPreviewFileId}
    />
  );
}

function ChatMenuSection() {
  const chat = useChatPageContext();

  return (
    <ChatMenu
      isOpen={chat.isChatMenuOpen}
      setIsOpen={chat.setIsChatMenuOpen}
      chat={chat.chat}
      isUpdatingChatSettings={chat.isUpdatingChatSettings}
      titleInput={chat.titleInput}
      titleInputRef={chat.titleInputRef}
      setTitleInput={chat.setTitleInput}
      saveTitle={chat.saveTitle}
      patchChatSettings={chat.patchChatSettings}
      archiveCurrentChat={chat.archiveCurrentChat}
      unarchiveCurrentChat={chat.unarchiveCurrentChat}
      setIsMediaGalleryOpen={chat.setIsMediaGalleryOpen}
    />
  );
}

function CameraCaptureSection() {
  const chat = useChatPageContext();

  return (
    <CameraCapture
      isOpen={chat.isCameraOpen}
      onClose={() => chat.setIsCameraOpen(false)}
      onCapture={async (file) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        await chat.uploadComposerFiles(dataTransfer.files, 'image');
      }}
    />
  );
}

function FilePreviewSectionWrapper() {
  const chat = useChatPageContext();

  return (
    <FilePreviewSection
      previewFile={chat.previewFile}
      setPreviewFileId={chat.setPreviewFileId}
    />
  );
}
