import type { Metadata } from 'next';
import '@/styles/base.css';
import '@/styles/widget.css';

/**
 * Eigenes Root-Layout, bewusst getrennt von der Konsole: diese Seite lädt im
 * iframe auf der Website eines Kunden, bei einem Besucher, der Norra nicht
 * kennt und nicht eingeloggt ist. Sie bekommt nichts von der Admin-Shell —
 * keine Navigation, kein Auth-Redirect, nichts, das einen eingeloggten
 * Operator voraussetzt, und nicht deren Stylesheet.
 */
export const metadata: Metadata = { title: 'Chat' };

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
