'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';

const MENU_ITEMS = [
  { href: '/archived', label: 'Archived chats' },
  { href: '/manage', label: 'Manage agents/models' },
  { href: '/settings', label: 'Settings' },
  { href: '/about', label: 'About' },
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function HamburgerMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const activeHref = useMemo(
    () => MENU_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href ?? null,
    [pathname],
  );

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;

    const focusable = drawerRef.current
      ? Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];

    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      drawerRef.current?.focus();
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
        return;
      }

      if (event.key !== 'Tab' || !drawerRef.current) {
        return;
      }

      const tabStops = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (tabStops.length === 0) {
        event.preventDefault();
        drawerRef.current.focus();
        return;
      }

      const first = tabStops[0];
      const last = tabStops[tabStops.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement || !drawerRef.current.contains(activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && (activeElement === first || activeElement === drawerRef.current)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onEscape);
      if (triggerButtonRef.current) {
        triggerButtonRef.current.focus();
        return;
      }
      previouslyFocusedElementRef.current?.focus();
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerButtonRef}
        type="button"
        className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/45" onClick={close}>
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="liquid-glass absolute left-0 top-0 h-full w-72 border-r border-border p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Navigation</p>
            <div className="space-y-1">
              <button
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                  pathname === '/'
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onClick={() => {
                  close();
                  router.push('/');
                }}
              >
                Inbox
              </button>
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.href}
                  type="button"
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                    activeHref === item.href
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  onClick={() => {
                    close();
                    router.push(item.href);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
