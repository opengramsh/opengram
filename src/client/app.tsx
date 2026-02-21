import { BrowserRouter, Route, Routes } from 'react-router';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';
import { Toaster } from '@/src/components/ui/sonner';

import HomePage from '@/src/client/pages/home';
import ArchivedPage from '@/src/client/pages/archived';
import ChatPage from '@/src/client/pages/chat';
import NewChatPage from '@/src/client/pages/new-chat';
import ManagePage from '@/src/client/pages/manage';
import SettingsPage from '@/src/client/pages/settings';
import AboutPage from '@/src/client/pages/about';

export function App() {
  return (
    <BrowserRouter>
      <PushBootstrap />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/archived" element={<ArchivedPage />} />
        <Route path="/chats/new" element={<NewChatPage />} />
        <Route path="/chats/:chatId" element={<ChatPage />} />
        <Route path="/manage" element={<ManagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
