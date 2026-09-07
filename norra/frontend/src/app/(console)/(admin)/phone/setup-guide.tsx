import { CopyField } from '@/components/copy-field';

/**
 * The whole setup, on one card.
 *
 * Three URLs go into the provider's console and nothing else does. Showing them
 * filled in — rather than describing them — is the difference between a
 * five-minute setup and a support ticket.
 */
export function SetupGuide({ numbers }: { numbers: Array<{ id: string; e164: string; status: string }> }) {
  const base = process.env.NORRA_PUBLIC_URL?.replace(/\/$/, '');
  const ready = numbers.some((n) => n.status === 'active');

  return (
    <div className="card">
      <div className="card-head spread">
        <div>
          <h2>Einrichtung beim Anbieter</h2>
          <div className="small muted" style={{ marginTop: 3 }}>
            Drei Felder in der Twilio-Konsole. Danach nimmt der Agent ab.
          </div>
        </div>
        {ready ? <span className="badge badge-ok">Nummer live</span> : <span className="badge">noch keine live</span>}
      </div>
      <div className="card-body stack" style={{ gap: 16 }}>
        {base ? (
          <>
            <ol className="stack small" style={{ gap: 14, margin: 0, paddingLeft: 18 }}>
              <li>
                Twilio-Konsole → <strong>Phone Numbers</strong> → die Nummer auswählen.
              </li>
              <li>
                Unter <strong>Voice Configuration</strong> bei „A call comes in“ auf <code>Webhook</code> stellen und
                eintragen:
                <CopyField value={`${base}/api/voice/incoming`} />
              </li>
              <li>
                Bei <strong>Call status changes</strong> eintragen — ohne das bleibt jeder abgebrochene Anruf im
                Dashboard als „läuft noch“ stehen:
                <CopyField value={`${base}/api/voice/status`} />
              </li>
              <li>
                Beide Methoden auf <code>HTTP POST</code>. Speichern.
              </li>
              <li>
                Oben eine Nummer öffnen, Agent zuweisen, Status auf <strong>Live</strong>. Fertig.
              </li>
            </ol>
            <p className="tiny muted" style={{ margin: 0 }}>
              Norra prüft bei jedem Anruf die Twilio-Signatur. Ein Request ohne gültige Signatur wird abgewiesen —
              die URLs dürfen deshalb öffentlich sein, aber der Auth-Token darf es nie.
            </p>
          </>
        ) : (
          <p className="notice">
            <code>NORRA_PUBLIC_URL</code> ist nicht gesetzt, deshalb kann hier keine fertige URL stehen. Die
            Variable muss exakt die öffentliche Basis-URL dieser App enthalten — die Signaturprüfung rechnet über
            die vollständige URL, ein abweichender Host lässt jeden Anruf scheitern.
          </p>
        )}
      </div>
    </div>
  );
}
