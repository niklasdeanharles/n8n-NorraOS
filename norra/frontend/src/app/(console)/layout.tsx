import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeScript } from '@/components/console/theme-toggle';
import '@/styles/console.entry.css';

// Als Variable, nicht als Klasse am <body>: `--font-inter` haengt im
// Design-System an `--font-sans`, und damit greift sie auch in Portalen, die
// ausserhalb des <body>-Baums rendern.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

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
    <html lang="de" className={inter.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
