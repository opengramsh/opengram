// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderMenu(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HamburgerMenu />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('hamburger menu accessibility', () => {
  it('renders drawer with modal dialog semantics when opened', async () => {
    const user = userEvent.setup();
    renderMenu('/');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
  });

  it('contains all expected menu items when opened', async () => {
    const user = userEvent.setup();
    renderMenu('/');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archived chats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About' })).toBeTruthy();
  });

  it('closes when Escape key is pressed', async () => {
    const user = userEvent.setup();
    renderMenu('/');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('navigates when a menu item is clicked', async () => {
    const user = userEvent.setup();
    renderMenu('/');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/settings');
    });
  });
});
