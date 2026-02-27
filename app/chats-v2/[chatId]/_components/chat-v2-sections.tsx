import { ChatV2Header } from './chat-v2-header';
import { ChatV2MessageFeed } from './chat-v2-message-feed';
import { ChatV2RequestWidget } from './chat-v2-request-widget';
import { ChatV2Composer } from './chat-v2-composer';
import { ChatV2SettingsDrawer } from './chat-v2-settings-drawer';
import { ChatV2MediaGalleryDrawer } from './chat-v2-media-gallery-drawer';

export function ChatV2PageSections() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ChatV2Header />
      <ChatV2MessageFeed />
      <ChatV2RequestWidget />
      <ChatV2Composer />
      <ChatV2SettingsDrawer />
      <ChatV2MediaGalleryDrawer />
    </div>
  );
}
