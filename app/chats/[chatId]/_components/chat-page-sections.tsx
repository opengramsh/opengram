'use client';

import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { ChatHeader } from '@/app/chats/[chatId]/_components/chat-header';
import { ChatMediaGallery } from '@/app/chats/[chatId]/_components/chat-media-gallery';
import { ChatMenu } from '@/app/chats/[chatId]/_components/chat-menu';
import { ChatMessages } from '@/app/chats/[chatId]/_components/chat-messages';
import { ChatRequestWidget } from '@/app/chats/[chatId]/_components/chat-request-widget';
import { ChatSettings } from '@/app/chats/[chatId]/_components/chat-settings';
import { CameraCapture } from '@/app/chats/[chatId]/_components/camera-capture';
import { FilePreviewSection } from '@/app/chats/[chatId]/_components/file-preview-section';
import { useChatPageContext } from '@/app/chats/[chatId]/_components/chat-page-provider';

export function ChatPageSections() {
  return (
    <>
      <ChatHeaderSection />
      <ChatMessagesSection />
      <ChatRequestWidgetSection />
      <ChatComposerSection />
      <ChatMediaGallerySection />
      <ChatSettingsSection />
      <ChatMenuSection />
      <CameraCaptureSection />
      <FilePreviewSectionWrapper />
    </>
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
      loading={chat.loading}
      error={chat.error}
      messages={chat.messages}
      inlineMessageMedia={chat.inlineMessageMedia}
      keyboardOffset={chat.keyboardOffset}
      pendingReply={chat.pendingReply}
      setViewerMediaId={(id) => chat.setViewerMediaId(id)}
      setPreviewFileId={chat.setPreviewFileId}
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
      keyboardOffset={chat.keyboardOffset}
      composerText={chat.composerText}
      isSending={chat.isSending}
      isRecording={chat.isRecording}
      recordingSeconds={chat.recordingSeconds}
      isUploadingVoiceNote={chat.isUploadingVoiceNote}
      showMicSettingsPrompt={chat.showMicSettingsPrompt}
      isComposerMenuOpen={chat.isComposerMenuOpen}
      isUploadingAttachment={chat.isUploadingAttachment}
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
      onModelChange={async () => {}}
      onCameraCapture={() => chat.setIsCameraOpen(true)}
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

function ChatSettingsSection() {
  const chat = useChatPageContext();

  return (
    <ChatSettings
      isChatSettingsOpen={chat.isChatSettingsOpen}
      chat={chat.chat}
      models={[]}
      primaryAgent={chat.primaryAgent}
      isUpdatingChatSettings={chat.isUpdatingChatSettings}
      tagInput={chat.tagInput}
      tagSuggestions={chat.tagSuggestions}
      isLoadingTagSuggestions={chat.isLoadingTagSuggestions}
      setIsChatSettingsOpen={chat.setIsChatSettingsOpen}
      patchChatSettings={chat.patchChatSettings}
      setTagInput={chat.setTagInput}
      addTagToChat={chat.addTagToChat}
      removeTagFromChat={chat.removeTagFromChat}
      archiveCurrentChat={chat.archiveCurrentChat}
      unarchiveCurrentChat={chat.unarchiveCurrentChat}
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
