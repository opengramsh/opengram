import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Archive, Info, Inbox, Menu, Settings, X } from 'lucide-react';

import logoSm from '/opengram-logo-sm.webp';
import { Button } from '@/src/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/src/components/ui/sheet';

const MENU_ITEMS = [
  { href: '/', label: 'Inbox', icon: Inbox },
  { href: '/archived', label: 'Archived', icon: Archive },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/about', label: 'About', icon: Info },
];

export function HamburgerMenu() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activeHref = useMemo(() => {
    if (pathname === '/') return '/';
    return MENU_ITEMS.find((item) => item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))?.href ?? null;
  }, [pathname]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu size={18} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 flex flex-col gap-0 border-r border-border bg-card p-0" aria-describedby={undefined}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <img src={logoSm} alt="" width={28} height={28} className="shrink-0 rounded-md" />
            <SheetTitle className="text-sm font-semibold tracking-wide text-foreground">OpenGram</SheetTitle>
          </div>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </Button>
          </SheetTrigger>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5 p-3 flex-1">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/' ? pathname === '/' : activeHref === item.href;
            return (
              <SheetTrigger key={item.href} asChild>
                <Button
                  variant="ghost"
                  className={`w-full justify-start gap-3 px-3 py-2 h-9 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                  onClick={() => navigate(item.href)}
                >
                  <Icon size={16} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                  {item.label}
                </Button>
              </SheetTrigger>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
