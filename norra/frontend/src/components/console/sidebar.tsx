'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NorraLogo } from '@/components/norra-logo';
import { NAVIGATION } from './navigation';
import { cn } from '@/lib/cn';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pendingApprovals, onNavigate }: { pendingApprovals: number; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      {NAVIGATION.map((group) => (
        <div key={group.label} className="mb-5 last:mb-0">
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-faint">
            {group.label}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium',
                      'transition-colors duration-200 ease-norra',
                      active
                        ? 'bg-brand-subtle text-brand'
                        : 'text-muted hover:bg-surface-muted hover:text-text',
                    )}
                  >
                    <Icon
                      className={cn('size-4 shrink-0 transition-colors', active ? 'text-brand' : 'text-faint group-hover:text-muted')}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                    {item.planned ? (
                      <span className="ml-auto rounded-full bg-surface-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-faint">
                        bald
                      </span>
                    ) : null}
                    {item.href === '/governance' && pendingApprovals > 0 ? (
                      <span
                        className="ml-auto rounded-full bg-warning/15 px-1.5 py-px text-[11px] font-semibold text-warning"
                        aria-label={`${pendingApprovals} offene Freigaben`}
                      >
                        {pendingApprovals}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({
  pendingApprovals,
  footer,
}: {
  pendingApprovals: number;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Auf dem Telefon bleibt das Menue sonst ueber dem neuen Screen stehen.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* Telefon: Kopfzeile mit Menueknopf. Ab lg traegt die Spalte links. */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border-hair bg-bg/85 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Menü schließen' : 'Menü öffnen'}
          className="inline-flex size-9 items-center justify-center rounded-md border border-border-hair bg-surface p-0 text-muted"
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        <NorraLogo />
      </div>

      {open ? (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-[#091a31]/35 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border-hair bg-surface',
          'transition-transform duration-300 ease-norra lg:translate-x-0',
          open ? 'translate-x-0 shadow-lift' : '-translate-x-full lg:shadow-none',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="/dashboard" className="rounded-sm">
            <NorraLogo />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Menü schließen"
            className="inline-flex size-8 items-center justify-center rounded-md bg-transparent p-0 text-faint hover:bg-surface-muted lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <NavList pendingApprovals={pendingApprovals} onNavigate={() => setOpen(false)} />

        <div className="shrink-0 border-t border-border-hair p-4">{footer}</div>
      </aside>
    </>
  );
}
