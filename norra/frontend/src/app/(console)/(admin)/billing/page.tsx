import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'Abrechnung · Norra' };

export default function Page() {
  return (
    <Planned
      title="Abrechnung"
      description="Was die Plattform verbraucht und was sie kostet."
      scope={[
          'Verbrauch je Kanal: Gesprächsminuten, Turns, Token',
          'Rechnungen und Zahlungsmittel',
          'Warnung, bevor ein Kontingent aufgebraucht ist — nicht danach',
      ]}
    />
  );
}
