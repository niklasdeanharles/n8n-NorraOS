'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UploadForm({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const agentId = data.get('agentId');

    setPending(true);
    setError(null);
    setOk(null);

    try {
      const response = await fetch('/api/kb-ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: data.get('title'),
          content: data.get('content'),
          agentId: typeof agentId === 'string' && agentId !== '' ? agentId : null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Upload fehlgeschlagen');

      setOk('Dokument übergeben. Die Ingestion läuft in n8n.');
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
      <div className="card-head"><h3>Dokument hinzufügen</h3></div>
      <form onSubmit={submit} className="card-body stack">
        <div className="form-grid">
          <label>
            Titel
            <input name="title" placeholder="Rückgaberichtlinie" required maxLength={500} />
          </label>
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
        </div>
        <label>
          Inhalt
          <textarea name="content" rows={9} required maxLength={500000} placeholder="Text, den der Agent zitieren darf…" />
          <span className="field-hint">Wird in Blöcke à 1000 Zeichen geteilt und vektorisiert.</span>
        </label>
        {error ? <p className="error">{error}</p> : null}
        {ok ? <p className="notice notice-ok">{ok}</p> : null}
        <div><button type="submit" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Übergibt…' : 'Hinzufügen'}
        </button></div>
      </form>
    </div>
  );
}
