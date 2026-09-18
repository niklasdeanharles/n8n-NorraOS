/**
 * Welche Workflows das Backend-Repository mitbringt.
 *
 * Eine Liste, die abschreiben muss, was woanders steht — die schlechteste Sorte
 * Konstante, wenn sie niemand nachprüft. Deshalb prüft sie jemand:
 * `norra-backend/scripts/check-wiring.mjs` vergleicht diese Datei mit dem
 * Verzeichnis `n8n-workflows/` und schlägt bei jedem Unterschied fehl. Eine neue
 * Workflow-Datei ohne Eintrag hier ist damit ein roter Lauf, kein stiller Punkt,
 * der auf dem Betriebs-Screen fehlt.
 *
 * Warum überhaupt abgeschrieben: die Next.js-App läuft auf Vercel und hat das
 * Backend-Repository dort nicht. Sie kann die Instanz fragen, was da ist — aber
 * nicht, was da sein sollte.
 */
export type ExpectedWorkflow = {
  /** Pfad im Backend-Repo, relativ zu `n8n-workflows/`. */
  readonly file: string;
  /** Der Name auf der Instanz. Danach wird zugeordnet, wenn keine ID im Repo steht. */
  readonly name: string;
  /** Womit er startet — bestimmt, ob „inaktiv" ein Blocker ist. */
  readonly trigger: 'webhook' | 'schedule' | 'sub';
};

export const EXPECTED_WORKFLOWS: readonly ExpectedWorkflow[] = [
  { file: 'scheduled/outbound-call.json', name: 'Norra – Outbound Call', trigger: 'schedule' },
  { file: 'sub-workflows/book-appointment.json', name: 'Norra – Tool: book_appointment', trigger: 'sub' },
  { file: 'sub-workflows/escalate-to-human.json', name: 'Norra – Tool: escalate_to_human', trigger: 'sub' },
  { file: 'sub-workflows/identify-caller.json', name: 'Norra – Tool: identify_caller', trigger: 'sub' },
  { file: 'sub-workflows/lookup-order.json', name: 'Norra – Tool: lookup_order', trigger: 'sub' },
  { file: 'sub-workflows/lookup-record.json', name: 'Norra – Tool: lookup_record', trigger: 'sub' },
  { file: 'sub-workflows/notify-escalation.json', name: 'Norra – Notify Escalation', trigger: 'sub' },
  { file: 'sub-workflows/request-action.json', name: 'Norra – Tool: request_action', trigger: 'sub' },
  { file: 'sub-workflows/schedule-callback.json', name: 'Norra – Tool: schedule_callback', trigger: 'sub' },
  { file: 'sub-workflows/send-sms.json', name: 'Norra – Tool: send_sms', trigger: 'sub' },
  { file: 'sub-workflows/take-message.json', name: 'Norra – Tool: take_message', trigger: 'sub' },
  { file: 'sub-workflows/transfer-to-department.json', name: 'Norra – Tool: transfer_to_department', trigger: 'sub' },
  { file: 'sub-workflows/transfer-to-person.json', name: 'Norra – Tool: transfer_to_person', trigger: 'sub' },
  { file: 'webhooks/agent-turn.json', name: 'Norra – Agent Turn', trigger: 'webhook' },
  { file: 'webhooks/call-wrapup.json', name: 'Norra – Call Wrapup', trigger: 'webhook' },
  { file: 'webhooks/kb-crawl.json', name: 'Norra – KB Crawl', trigger: 'webhook' },
  { file: 'webhooks/kb-ingest.json', name: 'Norra – KB Ingest', trigger: 'webhook' },
  { file: 'webhooks/voice-turn.json', name: 'Norra – Voice Turn', trigger: 'webhook' },
  { file: 'webhooks/voicemail-transcribe.json', name: 'Norra – Voicemail Transcribe', trigger: 'webhook' },
] as const;

/**
 * Ein inaktiver Webhook antwortet mit 404. Beim Telefon heißt das: der Anruf
 * bricht mitten im Satz ab. Bei einem Sub-Workflow heißt „inaktiv" gar nichts —
 * er wird aufgerufen, nicht ausgelöst.
 */
export function inactiveIsBlocking(trigger: ExpectedWorkflow['trigger']): boolean {
  return trigger === 'webhook' || trigger === 'schedule';
}
