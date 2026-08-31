import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Norra',
  description: 'Die Betriebsebene für KI-Agenten im Kundenservice.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
