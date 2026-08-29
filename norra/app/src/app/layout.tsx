import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Norra OS',
  description: 'AI-gestützter Customer Support',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
