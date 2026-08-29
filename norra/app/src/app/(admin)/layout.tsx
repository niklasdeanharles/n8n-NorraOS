import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Nav } from '@/components/nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS restricts this to the caller's own row.
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email, role, organizations(name)')
    .eq('id', user.id)
    .single();

  const displayName = profile?.full_name ?? profile?.email ?? 'Unbekannt';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span className="brand-name">Norra OS</span>
        </div>
        <Nav />
        <div className="sidebar-foot">
          <div className="small" style={{ fontWeight: 550 }}>{displayName}</div>
          <div className="tiny muted">
            {profile?.organizations?.name ?? 'Organisation'} · {profile?.role ?? '—'}
          </div>
          <form action="/auth/signout" method="post" style={{ marginTop: 10 }}>
            <button type="submit" className="btn-secondary btn-sm" style={{ width: '100%' }}>
              Abmelden
            </button>
          </form>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
