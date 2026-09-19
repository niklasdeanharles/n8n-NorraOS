import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'API · Norra' };

export default function Page() {
  return (
    <Planned
      title="API"
      description="Programmatischer Zugang zu Norra, für eigene Anbindungen."
      scope={[
          'Schlüssel anlegen, benennen und zurückziehen -- Wert nur einmal sichtbar',
          'OpenAPI-Dokumentation der REST-Endpunkte',
          'Webhooks, die Norra bei Gesprächsende an fremde Systeme schickt',
      ]}
    />
  );
}
