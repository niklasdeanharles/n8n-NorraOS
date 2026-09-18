import type { Metadata } from 'next';
import '@/styles/base.css';
import '@/styles/console.css';

/**
 * Root-Layout der Konsole: Dashboard, Inbox, Agenten, Einstellungen, Login.
 *
 * Das Widget unter `/widget/[agentId]` hat ein eigenes Root-Layout — es läuft
 * im iframe auf einer fremden Website und lädt deshalb nur `base.css`, nicht
 * das Stylesheet dieser Oberfläche.
 */
export const metadata: Metadata = {
  title: 'Norra',
  description: 'Die Betriebsebene für KI-Agenten im Kundenservice.',
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
