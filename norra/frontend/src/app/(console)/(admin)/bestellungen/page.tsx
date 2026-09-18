import { createClient } from '@/lib/supabase/server';
import { OrderSources } from './order-forms';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const supabase = await createClient();

  const [sourcesResult, meResult] = await Promise.all([
    supabase
      .from('order_sources')
      .select('id, label, kind, sheet_id, sheet_range, endpoint_url, match_column, return_columns, active')
      .order('label'),
    supabase.auth.getUser(),
  ]);

  const userId = meResult.data.user?.id;
  const { data: me } = userId
    ? await supabase.from('users').select('role').eq('id', userId).single()
    : { data: null };

  return (
    <div className="stack">
      <header className="topbar">
        <h1>Bestellungen</h1>
        <p className="muted small">
          „Wo bleibt meine Bestellung?“ ist in fast jeder Branche die häufigste Frage. Hier steht, woher
          der Agent die Antwort nimmt — und welche Spalten er dabei überhaupt zu sehen bekommt.
        </p>
      </header>

      <OrderSources sources={sourcesResult.data ?? []} canEdit={me?.role === 'admin'} />
    </div>
  );
}
