// @vitest-environment jsdom

/**
 * KAI-220: Fix iOS keyboard covers input + suppress accessory bar
 *
 * Regression from KAI-219 (commit b88a79c): keyboardOffset was removed from
 * ChatComposer entirely. The footer is position:fixed;bottom:0, which on iOS
 * PWA is relative to the layout viewport — it sits BEHIND the keyboard.
 *
 * The correct fix is to apply keyboardOffset to the footer's `bottom` style
 * (moving the entire footer up), NOT to paddingBottom.
 *
 * These tests verify:
 * 1. ChatComposer accepts keyboardOffset as a prop
 * 2. The footer uses bottom positioning (not paddingBottom) for keyboard offset
 * 3. Hidden file inputs don't contribute to iOS form navigation
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const composerSource = readFileSync(
  'app/chats/[chatId]/_components/chat-composer.tsx',
  'utf-8',
);

const sectionsSource = readFileSync(
  'app/chats/[chatId]/_components/chat-page-sections.tsx',
  'utf-8',
);

describe('KAI-220: ChatComposer keyboard offset positioning', () => {
  it('ChatComposer should accept keyboardOffset as a prop', () => {
    // The prop type definition should include keyboardOffset
    const hasKeyboardOffsetProp =
      composerSource.includes('keyboardOffset: number') ||
      composerSource.includes('keyboardOffset:number');

    expect(
      hasKeyboardOffsetProp,
      'ChatComposer type should include keyboardOffset: number prop',
    ).toBe(true);
  });

  it('ChatComposer footer should use bottom positioning for keyboard offset, not paddingBottom', () => {
    // The footer should set bottom: keyboardOffset to move above the keyboard.
    // Using paddingBottom for keyboard offset is wrong — it expands the footer
    // instead of moving it.
    const usesBottomForOffset =
      composerSource.includes('bottom:') &&
      (composerSource.includes('keyboardOffset') || composerSource.includes('keyboard'));

    // paddingBottom should NOT contain keyboardOffset
    // Find the paddingBottom style value
    const paddingBottomMatch = composerSource.match(/paddingBottom:\s*`[^`]*`/);
    const paddingBottomHasKeyboardOffset = paddingBottomMatch
      ? paddingBottomMatch[0].includes('keyboardOffset')
      : false;

    expect(
      paddingBottomHasKeyboardOffset,
      'paddingBottom should NOT include keyboardOffset (it should only be in bottom positioning)',
    ).toBe(false);

    expect(
      usesBottomForOffset,
      'Footer should use bottom (or transform) with keyboardOffset to move above the keyboard',
    ).toBe(true);
  });

  it('ChatComposerSection should pass keyboardOffset to ChatComposer', () => {
    // Extract the ChatComposerSection function body from the source
    const composerSectionMatch = sectionsSource.match(
      /function ChatComposerSection\(\)[\s\S]*?^}/m,
    );
    const composerSectionBody = composerSectionMatch?.[0] ?? '';

    const passesKeyboardOffset = composerSectionBody.includes(
      'keyboardOffset={chat.keyboardOffset}',
    );

    expect(
      passesKeyboardOffset,
      'ChatComposerSection should pass keyboardOffset prop to ChatComposer',
    ).toBe(true);
  });
});

describe('KAI-220: hidden file inputs should not affect iOS form navigation', () => {
  it('hidden file inputs should be outside the footer or have display:none', () => {
    // The hidden file inputs (camera, photos, files) should either:
    // 1. Be rendered outside the <footer> element entirely, OR
    // 2. Have display:none (className="hidden") which removes them from form navigation
    //
    // Currently they ARE inside the <footer> with className="hidden".
    // display:none SHOULD be sufficient, but if iOS still shows the accessory bar,
    // they need to be moved outside.

    const hasHiddenInputs = composerSource.includes('className="hidden"');
    expect(hasHiddenInputs, 'File inputs should have display:none via className="hidden"').toBe(
      true,
    );
  });
});
