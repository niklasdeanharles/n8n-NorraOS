import { createClient } from '@/lib/supabase/server';
import { relativeTime } from '@/lib/format';
import { DAY_LABELS, WEEK } from '@/lib/voice/hours';
import { AddTargetsForm, CampaignStatusForm, NewCampaignForm } from './campaign-forms';
import type { DayKey } from '@/lib/voice/hours';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  running: 'badge badge-ok',
  paused: 'badge badge-warn',
  draft: 'badge',
  done: 'badge',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'Läuft',
  paused: 'Angehalten',
  draft: 'Entwurf',
  done: 'Abgeschlossen',
};

const OUTCOME_LABEL: Record<string, string> = {
  pending: 'offen',
  reached: 'erreicht',
  no_answer: 'nicht abgenommen',
  busy: 'besetzt',
  voicemail: 'Anrufbeantworter',
  failed: 'gescheitert',
  opted_out: 'abgemeldet',
};

/** „Mo–Fr 09:00–17:00" statt eines jsonb-Blocks. */
function describeWindow(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return 'kein Anruftag';
  const window = raw as Record<string, unknown>;
  const days = WEEK.filter((day) => Array.isArray(window[day]));
  if (days.length === 0) return 'kein Anruftag';
  return days
    .map((day) => {
      const span = window[day] as [string, string];
      return `${DAY_LABELS[day as DayKey].slice(0, 2)} ${span[0]}–${span[1]}`;
    })
    .join(' · ');
}

export default async function CampaignsPage() {
  const supabase = await createClient();

  const [campaignsResult, targetsResult, agentsResult, numbersResult] = await Promise.all([
    supabase
      .from('call_campaigns')
      .select('id, name, goal, status, calling_window, timezone, max_attempts, started_at, agent_id, phone_number_id')
      .order('created_at', { ascending: false }),
    supabase
      .from('campaign_targets')
      .select('id, campaign_id, outcome, attempts')
      .limit(5000),
    supabase.from('agents').select('id, name').order('name'),
    supabase.from('phone_numbers').select('id, e164, label').eq('status', 'active').order('e164'),
  ]);

  const campaigns = campaignsResult.data ?? [];
  const targets = targetsResult.data ?? [];
  const agents = agentsResult.data ?? [];
  const numbers = numbersResult.data ?? [];

  const byCampaign = new Map<string, { total: number; open: number; outcomes: Map<string, number> }>();
  for (const target of targets) {
    const entry = byCampaign.get(target.campaign_id) ?? { total: 0, open: 0, outcomes: new Map() };
    entry.total += 1;
    if (target.outcome === 'pending') entry.open += 1;
    entry.outcomes.set(target.outcome, (entry.outcomes.get(target.outcome) ?? 0) + 1);
    byCampaign.set(target.campaign_id, entry);
  }

  return (
    <div className="stack">
      <header className="topbar">
        <h1>Kampagnen</h1>
        <p className="muted small">
          Ausgehende Anrufe. Der Zeitplan in n8n holt alle fünf Minuten die laufenden Kampagnen,
          prüft das Anrufzeitfenster und wählt, was fällig ist.
        </p>
      </header>

      <NewCampaignForm agents={agents} numbers={numbers} />

      {campaigns.length === 0 ? (
        <div className="card">
          <div className="card-body stack">
            <p className="muted">Noch keine Kampagne.</p>
          </div>
        </div>
      ) : (
        campaigns.map((campaign) => {
          const stats = byCampaign.get(campaign.id) ?? { total: 0, open: 0, outcomes: new Map() };
          const done = stats.total - stats.open;
          return (
            <div key={campaign.id} className="card">
              <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h3>
                    {campaign.name}{' '}
                    <span className={STATUS_TONE[campaign.status] ?? 'badge'}>
                      {STATUS_LABEL[campaign.status] ?? campaign.status}
                    </span>
                  </h3>
                  <div className="small muted" style={{ marginTop: 3 }}>{campaign.goal}</div>
                  <div className="small muted" style={{ marginTop: 3 }}>
                    {describeWindow(campaign.calling_window)} · {campaign.timezone} ·{' '}
                    bis zu {campaign.max_attempts} Versuche
                    {campaign.started_at ? ` · gestartet ${relativeTime(campaign.started_at)}` : ''}
                  </div>
                </div>
                <CampaignStatusForm campaignId={campaign.id} status={campaign.status} />
              </div>
              <div className="card-body stack">
                <p className="small">
                  <strong>{stats.total}</strong> Nummer{stats.total === 1 ? '' : 'n'} ·{' '}
                  <strong>{stats.open}</strong> offen · <strong>{done}</strong> erledigt
                  {stats.outcomes.size > 0 ? (
                    <>
                      {' — '}
                      {[...stats.outcomes.entries()]
                        .filter(([outcome]) => outcome !== 'pending')
                        .map(([outcome, count]) => `${count}× ${OUTCOME_LABEL[outcome] ?? outcome}`)
                        .join(', ') || 'noch kein Ergebnis'}
                    </>
                  ) : null}
                </p>
                <AddTargetsForm campaignId={campaign.id} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
