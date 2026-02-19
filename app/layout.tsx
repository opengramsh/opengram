import type { Metadata } from 'next';

import { PushBootstrap } from '@/src/components/push/push-bootstrap';

import './globals.css';

export const metadata: Metadata = {
  title: 'OpenGram',
  description: 'OpenGram local development environment',
  manifest: '/manifest.json',
  themeColor: '#121214',
  appleWebApp: {
    capable: true,
    title: 'OpenGram',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <PushBootstrap />
        {children}
      </body>
    </html>
  );
}
