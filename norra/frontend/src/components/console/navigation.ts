import type { LucideIcon } from 'lucide-react';
import {
  BadgeEuro,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Contact,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Package,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldCheck,
  Plug,
  Send,
  Users,
  Workflow,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Noch kein Screen dahinter. Steht im Menue, damit der Umfang sichtbar ist, und sagt es auch. */
  planned?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * Die Navigation ist nach Taetigkeit gruppiert, nicht nach Datenmodell.
 *
 * Ein Betreiber sucht morgens „was ist gelaufen", nicht „die Tabelle calls".
 * Screens, hinter denen noch nichts liegt, stehen trotzdem hier und sind als
 * geplant markiert: ein Menuepunkt, der ins Leere fuehrt, kostet mehr
 * Vertrauen als einer, der sagt, dass er noch nicht fertig ist.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Überblick',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/conversations', label: 'Gespräche', icon: MessagesSquare },
      { href: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
    ],
  },
  {
    label: 'Assistenten',
    items: [
      { href: '/agents', label: 'Assistenten', icon: Bot },
      { href: '/knowledge', label: 'Wissen', icon: BookOpen },
      { href: '/phone', label: 'Rufnummern', icon: PhoneCall },
      { href: '/calendar', label: 'Kalender', icon: CalendarDays, planned: true },
      { href: '/workflows', label: 'Workflows', icon: Workflow, planned: true },
    ],
  },
  {
    label: 'Kunden',
    items: [
      { href: '/crm', label: 'CRM', icon: Contact, planned: true },
      { href: '/empfang', label: 'Empfang', icon: Building2 },
      { href: '/bestellungen', label: 'Bestellungen', icon: Package },
      { href: '/campaigns', label: 'Kampagnen', icon: Send },
    ],
  },
  {
    label: 'Betrieb',
    items: [
      { href: '/integrations', label: 'Integrationen', icon: Plug, planned: true },
      { href: '/logs', label: 'Protokolle', icon: ScrollText, planned: true },
      { href: '/governance', label: 'Governance', icon: ShieldCheck },
      { href: '/betrieb', label: 'Systemzustand', icon: Workflow },
    ],
  },
  {
    label: 'Konto',
    items: [
      { href: '/team', label: 'Team', icon: Users },
      { href: '/billing', label: 'Abrechnung', icon: BadgeEuro, planned: true },
      { href: '/api-keys', label: 'API', icon: KeyRound, planned: true },
      { href: '/settings', label: 'Einstellungen', icon: Settings },
    ],
  },
];
