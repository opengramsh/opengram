import { ChatV2Header } from './chat-v2-header';
import { ChatV2MessageFeed } from './chat-v2-message-feed';
import { ChatV2RequestWidget } from './chat-v2-request-widget';
import { ChatV2Composer } from './chat-v2-composer';
import { ChatV2SettingsDrawer } from './chat-v2-settings-drawer';
import { ChatV2MediaGalleryDrawer } from './chat-v2-media-gallery-drawer';
import { ChatV2ErrorBoundary } from './chat-v2-error-boundary';

export function ChatV2PageSections() {
  return (
    <ChatV2ErrorBoundary>
      <div className="flex flex-col h-full overflow-hidden">
        <ChatV2Header />
        {/* Message feed grows to fill remaining space */}
        <ChatV2MessageFeed />
        {/* Request widget + composer sit at the bottom in normal flow */}
        <ChatV2RequestWidget />
        <ChatV2Composer />
        {/* Drawers are portalled — they don't affect layout */}
        <ChatV2SettingsDrawer />
        <ChatV2MediaGalleryDrawer />
      </div>
    </ChatV2ErrorBoundary>
  );
}
