import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';
import { Toaster } from '@/src/components/ui/sonner';

import InboxLayout from '@/src/client/pages/inbox-layout';
import InboxV2Layout from '@/src/client/pages/inbox-v2-layout';
import ArchivedPage from '@/src/client/pages/archived';
import ChatPage from '@/src/client/pages/chat';
import ChatV2Page from '@/src/client/pages/chat-v2';
import NewChatPage from '@/src/client/pages/new-chat';
import SettingsPage from '@/src/client/pages/settings';
import AboutPage from '@/src/client/pages/about';

export function App() {
  return (
    <BrowserRouter>
      <PushBootstrap />
      <Routes>
        <Route element={<InboxLayout />}>
          <Route path="/" element={null} />
          <Route path="/chats/:chatId" element={<ChatPage />} />
          <Route path="/chats/new" element={<NewChatPage />} />
        </Route>
        <Route element={<InboxV2Layout />}>
          <Route path="/v2" element={null} />
          <Route path="/v2/chats/:chatId" element={<ChatV2Page />} />
        </Route>
        <Route path="/archived" element={<ArchivedPage />} />
        <Route path="/manage" element={<Navigate to="/settings" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
