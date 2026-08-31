import type { Metadata } from 'next';

/**
 * Deliberately its own layout, outside `(admin)`: this page is loaded in an
 * iframe on a customer's own website, by a visitor who has never heard of
 * Norra and is not signed in. It gets none of the admin shell — no nav, no
 * auth redirect, nothing that assumes a logged-in operator.
 *
 * The root layout still owns `<html>`/`<body>` and `globals.css` — a nested
 * layout must not repeat them — so this only overrides the page title.
 */
export const metadata: Metadata = { title: 'Chat' };

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
