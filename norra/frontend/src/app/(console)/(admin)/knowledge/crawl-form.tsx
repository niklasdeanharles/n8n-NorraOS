'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Seiten einer Website einlesen.
 *
 * Bewusst eine Liste und kein „Domain eintragen, wir finden den Rest": ein
 * Crawler, der Links folgt, liest irgendwann das Impressum, den Blog von 2017
 * und die Seite eines fremden Anbieters im iframe. Wer die Seiten benennt,
 * bekommt die Wissensbasis, die er meint.
 */
export function CrawlForm({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const agentId = data.get('agentId');
    const urls = String(data.get('urls') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    setPending(true);
    setError(null);
    setOk(null);

    try {
      const response = await fetch('/api/kb-crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          urls,
          agentId: typeof agentId === 'string' && agentId !== '' ? agentId : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Crawl fehlgeschlagen');

      // Die Differenz ist die eigentliche Auskunft: Seiten, die nicht
      // antworteten oder zu dünn waren, werden übersprungen statt zu scheitern.
      const indexed = Number(payload.indexed ?? 0);
      const requested = Number(payload.requested ?? urls.length);
      setOk(
        indexed === requested
          ? `${indexed} Seite${indexed === 1 ? '' : 'n'} eingelesen.`
          : `${indexed} von ${requested} Seiten eingelesen — der Rest antwortete nicht oder hatte zu wenig Text.`,
      );
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unerwarteter Fehler');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Website einlesen</h3>
        <div className="small muted" style={{ marginTop: 3 }}>
          Eine Adresse pro Zeile. Norra holt jede Seite, entfernt Navigation, Skripte und Banner
          und legt den Text als Dokument an.
        </div>
      </div>
      <form onSubmit={submit} className="card-body stack">
        <label>
          Agent
          <select name="agentId" defaultValue="">
            <option value="">Für alle Agenten</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <span className="field-hint">Leer = organisationsweit geteilt</span>
        </label>
        <label>
          Seiten
          <textarea
            name="urls"
            rows={5}
            required
            spellCheck={false}
            placeholder={'https://kunde.de/faq\nhttps://kunde.de/versand\nhttps://kunde.de/retouren'}
          />
          <span className="field-hint">
            Höchstens 50 auf einmal. Eine unveränderte Seite ein zweites Mal einzulesen legt nichts
            doppelt an — der Inhalt wird über seinen Hash wiedererkannt.
          </span>
        </label>
        {error ? <p className="error">{error}</p> : null}
        {ok ? <p className="notice notice-ok">{ok}</p> : null}
        <div><button type="submit" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Liest ein…' : 'Seiten einlesen'}
        </button></div>
      </form>
    </div>
  );
}
