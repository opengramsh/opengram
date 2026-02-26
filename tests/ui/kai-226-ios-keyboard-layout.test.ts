// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const effectsSource = readFileSync(
  'app/chats/[chatId]/_hooks/use-chat-page-effects.ts',
  'utf-8',
);

const composerSource = readFileSync(
  'app/chats/[chatId]/_components/chat-composer.tsx',
  'utf-8',
);

const messagesSource = readFileSync(
  'app/chats/[chatId]/_components/chat-messages.tsx',
  'utf-8',
);

const inboxLayoutSource = readFileSync(
  'src/client/pages/inbox-layout.tsx',
  'utf-8',
);

const chatPageSource = readFileSync(
  'src/client/pages/chat.tsx',
  'utf-8',
);

const newChatPageSource = readFileSync(
  'src/client/pages/new-chat.tsx',
  'utf-8',
);

describe('KAI-226: visualViewport keyboard sync', () => {
  it('updates keyboard layout through visualViewport resize/scroll with requestAnimationFrame', () => {
    expect(effectsSource.includes("viewport.addEventListener('resize', scheduleLayoutUpdate)")).toBe(true);
    expect(effectsSource.includes("viewport.addEventListener('scroll', scheduleLayoutUpdate)")).toBe(true);
    expect(effectsSource.includes('window.requestAnimationFrame')).toBe(true);
  });

  it('derives keyboard offset from innerHeight - visualViewport and subtracts safe area', () => {
    expect(effectsSource.includes('window.innerHeight - viewport.height - viewport.offsetTop')).toBe(true);
    expect(effectsSource.includes('safeAreaBottom')).toBe(true);
    expect(effectsSource.includes("setProperty('--keyboard-offset'")).toBe(true);
  });

  it('tracks and applies visual viewport height via CSS variable', () => {
    expect(effectsSource.includes("setProperty('--visual-viewport-height'")).toBe(true);
    expect(inboxLayoutSource.includes("var(--visual-viewport-height, 100dvh)")).toBe(true);
    expect(chatPageSource.includes("var(--visual-viewport-height, 100dvh)")).toBe(true);
    expect(newChatPageSource.includes("var(--visual-viewport-height, 100dvh)")).toBe(true);
  });
});

describe('KAI-226: composer and message layout', () => {
  it('keeps message padding independent from keyboard offset to avoid double counting', () => {
    expect(messagesSource.includes('keyboardOffset')).toBe(false);
    expect(messagesSource.includes('paddingBottom')).toBe(true);
  });

  it('configures composer textarea for iOS without disabling autocorrect', () => {
    expect(composerSource.includes('autoComplete="off"')).toBe(true);
    expect(composerSource.includes('inputMode="text"')).toBe(true);
    expect(composerSource.includes('enterKeyHint="send"')).toBe(true);
    expect(composerSource.includes('autoCorrect="off"')).toBe(false);
    expect(composerSource.includes('spellCheck={false}')).toBe(false);
  });
});
