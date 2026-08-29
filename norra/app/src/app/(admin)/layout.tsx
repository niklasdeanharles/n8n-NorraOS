import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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

  return (
    <div className="container">
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <div>
          <strong>Norra OS</strong>{' '}
          <span className="muted">{profile?.organizations?.name ?? 'Organisation'}</span>
        </div>
        <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>
            {profile?.full_name ?? profile?.email} · {profile?.role}
          </span>
          <form action="/auth/signout" method="post">
            <button type="submit" style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--border)' }}>
              Abmelden
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
