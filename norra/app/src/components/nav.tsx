'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS: Array<{ label: string; items: Array<{ href: string; icon: string; text: string }> }> = [
  {
    label: 'Betrieb',
    items: [
      { href: '/dashboard', icon: '◱', text: 'Übersicht' },
      { href: '/conversations', icon: '◐', text: 'Posteingang' },
      { href: '/analytics', icon: '◔', text: 'Analytics' },
    ],
  },
  {
    label: 'Konfiguration',
    items: [
      { href: '/agents', icon: '◇', text: 'Agenten' },
      { href: '/knowledge', icon: '▤', text: 'Wissensbasis' },
    ],
  },
];

export function Nav() {
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
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
