import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';
import { Toaster } from '@/src/components/ui/sonner';

import InboxLayout from '@/src/client/pages/inbox-layout';
import ArchivedPage from '@/src/client/pages/archived';
import ChatPage from '@/src/client/pages/chat';
import NewChatPage from '@/src/client/pages/new-chat';
import SettingsPage from '@/src/client/pages/settings';
import AboutPage from '@/src/client/pages/about';

export function App() {
  return (
    <BrowserRouter basename="/opengram-dev/">
      <PushBootstrap />
      <Routes>
        <Route element={<InboxLayout />}>
          <Route path="/" element={null} />
          <Route path="/chats/:chatId" element={<ChatPage />} />
          <Route path="/chats/new" element={<NewChatPage />} />
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
