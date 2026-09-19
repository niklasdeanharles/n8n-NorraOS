import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/console/sidebar';
import { ThemeToggle } from '@/components/console/theme-toggle';
import { createClient } from '@/lib/supabase/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profileResult, approvalsResult] = await Promise.all([
    supabase.from('users').select('full_name, email, role, organizations(name)').eq('id', user.id).single(),
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  const profile = profileResult.data;
  const displayName = profile?.full_name ?? profile?.email ?? 'Unbekannt';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="min-h-dvh bg-bg">
      <Sidebar
        pendingApprovals={approvalsResult.count ?? 0}
        footer={
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-[12px] font-semibold text-brand"
              >
                {initials || 'N'}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text">{displayName}</div>
                <div className="truncate text-[11.5px] text-faint">
                  {profile?.organizations?.name ?? 'Organisation'} · {profile?.role ?? '—'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <ThemeToggle />
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  aria-label="Abmelden"
                  title="Abmelden"
                  className="inline-flex size-8 items-center justify-center rounded-full border border-border-hair bg-transparent p-0 text-faint transition-colors duration-200 ease-norra hover:bg-surface-muted hover:text-text"
                >
                  <LogOut className="size-3.5" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        }
      />

      {/* Der linke Rand ab lg ist die Breite der Spalte; darunter liegt sie darueber. */}
      <main className="lg:pl-[260px]">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
