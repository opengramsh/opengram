// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
  });

  it('contains all expected menu items when opened', async () => {
    const user = userEvent.setup();
    render(<HamburgerMenu />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archived chats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About' })).toBeTruthy();
  });

  it('closes when Escape key is pressed', async () => {
    const user = userEvent.setup();
    render(<HamburgerMenu />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('navigates when a menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<HamburgerMenu />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(navigationState.push).toHaveBeenCalledWith('/settings');
  });
});
