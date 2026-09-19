import type { Metadata } from 'next';
import { Planned } from '@/components/console/planned';

export const metadata: Metadata = { title: 'CRM · Norra' };

export default function Page() {
  return (
    <Planned
      title="CRM"
      description="Wer angerufen hat, worum es ging und was daraus wurde."
      scope={[
          'Kontakte aus `contacts`, zusammengeführt ueber die Rufnummer',
          'Gesprächsverlauf je Kontakt ueber alle Kanäle hinweg',
          'Lead-Qualifizierung und die vom Assistenten extrahierten Variablen',
      ]}
      insteadHref="/conversations"
      insteadLabel="Zu den Gesprächen"
    />
  );
}
