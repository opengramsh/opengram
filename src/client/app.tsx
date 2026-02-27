import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';
import { Toaster } from '@/src/components/ui/sonner';

import InboxLayout from '@/src/client/pages/inbox-layout';

const ChatPage = lazy(() => import('@/src/client/pages/chat'));
const NewChatPage = lazy(() => import('@/src/client/pages/new-chat'));
const ArchivedPage = lazy(() => import('@/src/client/pages/archived'));
const SettingsPage = lazy(() => import('@/src/client/pages/settings'));
const AboutPage = lazy(() => import('@/src/client/pages/about'));

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
        <Route path="/archived" element={<Suspense fallback={<RouteLoadingFallback />}><ArchivedPage /></Suspense>} />
        <Route path="/manage" element={<Navigate to="/settings" replace />} />
        <Route path="/settings" element={<Suspense fallback={<RouteLoadingFallback />}><SettingsPage /></Suspense>} />
        <Route path="/about" element={<Suspense fallback={<RouteLoadingFallback />}><AboutPage /></Suspense>} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
