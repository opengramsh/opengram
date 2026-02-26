import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { ChatHeader } from '@/app/chats/[chatId]/_components/chat-header';
import { ChatMediaGallery } from '@/app/chats/[chatId]/_components/chat-media-gallery';
import { ChatMenu } from '@/app/chats/[chatId]/_components/chat-menu';
import { ChatMessages } from '@/app/chats/[chatId]/_components/chat-messages';
import { ChatRequestWidget } from '@/app/chats/[chatId]/_components/chat-request-widget';
import { ChatSettings } from '@/app/chats/[chatId]/_components/chat-settings';
import { CameraCapture } from '@/app/chats/[chatId]/_components/camera-capture';
import { FilePreviewSection } from '@/app/chats/[chatId]/_components/file-preview-section';
import { useChatV2PageContext } from '@/app/chats-v2/[chatId]/_components/chat-v2-provider';

export function ChatV2PageSections() {
  return (
    <>
      <ChatV2HeaderSection />
      <ChatV2MessagesSection />
      <ChatV2RequestWidgetSection />
      <ChatV2ComposerSection />
      <ChatV2MediaGallerySection />
      <ChatV2SettingsSection />
      <ChatV2MenuSection />
      <ChatV2CameraCaptureSection />
      <ChatV2FilePreviewSection />
    </>
  );
}

function ChatV2HeaderSection() {
  const chat = useChatV2PageContext();
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

function ChatV2MessagesSection() {
  const chat = useChatV2PageContext();

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
    />
  );
}

function ChatV2RequestWidgetSection() {
  const chat = useChatV2PageContext();

  return (
    <ChatRequestWidget
      chatLoaded={Boolean(chat.chat)}
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

function ChatV2ComposerSection() {
  const chat = useChatV2PageContext();

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
      onModelChange={async () => {}}
      onCameraCapture={() => chat.setIsCameraOpen(true)}
    />
  );
}

function ChatV2MediaGallerySection() {
  const chat = useChatV2PageContext();

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

function ChatV2SettingsSection() {
  const chat = useChatV2PageContext();

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

function ChatV2MenuSection() {
  const chat = useChatV2PageContext();

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

function ChatV2CameraCaptureSection() {
  const chat = useChatV2PageContext();

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

function ChatV2FilePreviewSection() {
  const chat = useChatV2PageContext();

  return (
    <FilePreviewSection
      previewFile={chat.previewFile}
      setPreviewFileId={chat.setPreviewFileId}
    />
  );
}
