import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Menu } from 'lucide-react';

import { Button } from '@/src/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/src/components/ui/sheet';

const MENU_ITEMS = [
  { href: '/archived', label: 'Archived chats' },
  { href: '/manage', label: 'Manage agents/models' },
  { href: '/settings', label: 'Settings' },
  { href: '/about', label: 'About' },
];

export function HamburgerMenu() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activeHref = useMemo(
    () => MENU_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href ?? null,
    [pathname],
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open menu">
          <Menu size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-72 border-r border-border bg-card p-4" aria-describedby={undefined}>
        <div className="mb-4 flex items-center gap-2 px-3">
          <img src="/opengram-logo-sm.webp" alt="" width={28} height={28} className="shrink-0" />
          <SheetTitle className="text-base font-semibold text-foreground">OpenGram</SheetTitle>
        </div>
        <nav className="space-y-1">
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              className={`w-full justify-start px-3 py-2 text-sm font-medium ${
                pathname === '/'
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground'
              }`}
              onClick={() => navigate('/')}
            >
              Inbox
            </Button>
          </SheetTrigger>
          {MENU_ITEMS.map((item) => (
            <SheetTrigger key={item.href} asChild>
              <Button
                variant="ghost"
                className={`w-full justify-start px-3 py-2 text-sm font-medium ${
                  activeHref === item.href
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => navigate(item.href)}
              >
                {item.label}
              </Button>
            </SheetTrigger>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
