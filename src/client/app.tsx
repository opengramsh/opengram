import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';
import { Toaster } from '@/src/components/ui/sonner';

import InboxLayout from '@/src/client/pages/inbox-layout';

const ChatPage = lazy(() => import('@/src/client/pages/chat'));
const NewChatPage = lazy(() => import('@/src/client/pages/new-chat'));
const ArchivedLayout = lazy(() => import('@/src/client/pages/archived-layout'));
const SettingsPage = lazy(() => import('@/src/client/pages/settings'));

function RouteLoadingFallback() {
  return <div className="flex h-full w-full items-center justify-center bg-background" />;
}

export function App() {
  return (
    <BrowserRouter>
      <PushBootstrap />
      <Routes>
        <Route element={<InboxLayout />}>
          <Route path="/" element={null} />
          <Route path="/chats/:chatId" element={<Suspense fallback={<RouteLoadingFallback />}><ChatPage /></Suspense>} />
          <Route path="/chats/new" element={<Suspense fallback={<RouteLoadingFallback />}><NewChatPage /></Suspense>} />
        </Route>
        <Route element={<Suspense fallback={<RouteLoadingFallback />}><ArchivedLayout /></Suspense>}>
          <Route path="/archived" element={null} />
          <Route path="/archived/chats/:chatId" element={<Suspense fallback={<RouteLoadingFallback />}><ChatPage /></Suspense>} />
          <Route path="/archived/chats/new" element={<Suspense fallback={<RouteLoadingFallback />}><NewChatPage /></Suspense>} />
        </Route>
        <Route path="/manage" element={<Navigate to="/settings" replace />} />
        <Route path="/settings" element={<Suspense fallback={<RouteLoadingFallback />}><SettingsPage /></Suspense>} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
