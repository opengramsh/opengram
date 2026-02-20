'use client';

import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { ChatHeader } from '@/app/chats/[chatId]/_components/chat-header';
import { ChatMediaGallery } from '@/app/chats/[chatId]/_components/chat-media-gallery';
import { ChatMessages } from '@/app/chats/[chatId]/_components/chat-messages';
import { ChatRequestWidget } from '@/app/chats/[chatId]/_components/chat-request-widget';
import { ChatSettings } from '@/app/chats/[chatId]/_components/chat-settings';
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
    </>
  );
}

function ChatHeaderSection() {
  const chat = useChatPageContext();

  return (
    <ChatHeader
      chat={chat.chat}
      primaryAgent={chat.primaryAgent}
      goBack={chat.goBack}
      isEditingTitle={chat.isEditingTitle}
      titleInput={chat.titleInput}
      titleError={chat.titleError}
      titleInputRef={chat.titleInputRef}
      setTitleInput={chat.setTitleInput}
      setIsEditingTitle={chat.setIsEditingTitle}
      setTitleError={chat.setTitleError}
      saveTitle={chat.saveTitle}
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
      setViewerMediaId={(id) => chat.setViewerMediaId(id)}
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
      cameraInputRef={chat.cameraInputRef}
      photosInputRef={chat.photosInputRef}
      filesInputRef={chat.filesInputRef}
      setComposerText={chat.setComposerText}
      setIsComposerMenuOpen={chat.setIsComposerMenuOpen}
      setIsMediaGalleryOpen={chat.setIsMediaGalleryOpen}
      setTagInput={chat.setTagInput}
      setTagSuggestions={chat.setTagSuggestions}
      setIsChatSettingsOpen={chat.setIsChatSettingsOpen}
      sendMessage={chat.sendMessage}
      handleMicAction={chat.handleMicAction}
      uploadComposerFiles={chat.uploadComposerFiles}
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
    />
  );
}

function ChatSettingsSection() {
  const chat = useChatPageContext();

  return (
    <ChatSettings
      isChatSettingsOpen={chat.isChatSettingsOpen}
      chat={chat.chat}
      models={chat.models}
      customStates={chat.customStates}
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
