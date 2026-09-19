import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'Protokolle · Norra' };

export default function Page() {
  return (
    <Planned
      title="Protokolle"
      description="Jeder Tool-Aufruf, jede Änderung, jeder gescheiterte Lauf — nachlesbar."
      scope={[
          'Tool-Aufrufe aus `tool_calls_log` mit Eingabe, Ausgabe und Dauer',
          'Änderungen an Agenten und Einstellungen aus `audit_log`',
          'Filter nach Zeitraum, Assistent und Fehlerart, mit Export',
      ]}
      insteadHref="/betrieb"
      insteadLabel="Zum Systemzustand"
    />
  );
}
