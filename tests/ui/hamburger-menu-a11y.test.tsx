// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

const navigationState = vi.hoisted(() => ({
  pathname: '/',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationState.push }),
  usePathname: () => navigationState.pathname,
}));

describe('hamburger menu accessibility', () => {
  beforeEach(() => {
    navigationState.pathname = '/';
    navigationState.push.mockReset();
  });

  it('renders drawer with modal dialog semantics when opened', async () => {
    const user = userEvent.setup();
    render(<HamburgerMenu />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('traps focus inside drawer when tabbing at boundaries', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside button</button>
        <HamburgerMenu />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const first = screen.getByRole('button', { name: 'Inbox' });
    const last = screen.getByRole('button', { name: 'About' });

    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to trigger button after close', async () => {
    const user = userEvent.setup();
    render(<HamburgerMenu />);

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
