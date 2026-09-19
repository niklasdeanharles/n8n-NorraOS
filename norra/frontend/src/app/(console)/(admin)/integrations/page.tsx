import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'Integrationen · Norra' };

export default function Page() {
  return (
    <Planned
      title="Integrationen"
      description="Welche Fremdsysteme angebunden sind — und welche noch nicht."
      scope={[
          'Zustand je Anbindung: Kalender, Mail, Telefonie, Bestellquellen',
          'Ob eine Credential in n8n hängt, nicht nur ob sie angelegt ist',
          'Der Befehl oder Knopf, der eine fehlende Verbindung herstellt',
      ]}
      insteadHref="/settings"
      insteadLabel="Zu den Einstellungen"
    />
  );
}
