'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS: Array<{ label: string; items: Array<{ href: string; icon: string; text: string }> }> = [
  {
    label: 'Betrieb',
    items: [
      { href: '/dashboard', icon: '◱', text: 'Dashboard' },
      { href: '/conversations', icon: '◐', text: 'Chat' },
      { href: '/analytics', icon: '◔', text: 'Analytics' },
    ],
  },
  {
    label: 'Aufbau',
    items: [
      { href: '/agents', icon: '◇', text: 'Agenten' },
      { href: '/phone', icon: '☏', text: 'Telefon' },
      { href: '/knowledge', icon: '▤', text: 'Wissen' },
    ],
  },
  {
    label: 'Kontrolle',
    items: [
      { href: '/governance', icon: '◈', text: 'Governance' },
      { href: '/team', icon: '◎', text: 'Team' },
      { href: '/settings', icon: '⚙', text: 'Einstellungen' },
    ],
  },
];

/** `pendingApprovals` surfaces the queue in the nav; an approval nobody sees is an approval nobody gives. */
export function Nav({ pendingApprovals = 0 }: { pendingApprovals?: number }) {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.text}
                {item.href === '/governance' && pendingApprovals > 0 ? (
                  <span className="nav-count" aria-label={`${pendingApprovals} offene Freigaben`}>
                    {pendingApprovals}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
