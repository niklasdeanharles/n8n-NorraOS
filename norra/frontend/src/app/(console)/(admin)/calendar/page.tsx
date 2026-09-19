import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'Kalender · Norra' };

export default function Page() {
  return (
    <Planned
      title="Kalender"
      description="Termine, die der Assistent vereinbart hat — an einem Ort, statt in jedem Kalender einzeln."
      scope={[
          'Alle gebuchten Termine der Organisation in einer Woche- und Monatsansicht',
          'Verschieben und Absagen aus der Konsole, mit Benachrichtigung an den Kunden',
          'Verfügbarkeiten je Person und je Leistung, aus denen `book_appointment` wählt',
      ]}
      insteadHref="/empfang"
      insteadLabel="Zum Empfang"
    />
  );
}
