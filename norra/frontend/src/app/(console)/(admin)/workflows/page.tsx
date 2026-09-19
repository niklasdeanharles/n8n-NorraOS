import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'Workflows · Norra' };

export default function Page() {
  return (
    <Planned
      title="Workflows"
      description="Was auf der n8n-Instanz liegt, welche Version laeuft und wo der letzte Lauf hängen blieb."
      scope={[
          'Liste der neunzehn Norra-Workflows mit Version, Zustand und letztem Lauf',
          'Fehlgeschlagene Läufe mit dem Node, an dem es abbrach',
          'Ausrollen aus dem Repository auf Knopfdruck, statt über die Kommandozeile',
      ]}
      insteadHref="/betrieb"
      insteadLabel="Zum Systemzustand"
    />
  );
}
