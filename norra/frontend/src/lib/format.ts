import type { ConversationStatus, TicketPriority } from '@/types/database';

/** Maps a status or priority onto one of the badge styles in globals.css. */
export function statusTone(status: string): string {
  switch (status) {
    case 'resolved':
    case 'solved':
    case 'ready':
    case 'live':
    case 'success':
      return 'badge badge-ok';
    case 'escalated':
    case 'failed':
    case 'error':
    case 'urgent':
      return 'badge badge-danger';
    case 'pending':
    case 'processing':
    case 'high':
      return 'badge badge-warn';
    case 'open':
      return 'badge badge-accent';
    default:
      return 'badge';
  }
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: 'Offen',
  pending: 'Wartet',
  escalated: 'Eskaliert',
  resolved: 'Gelöst',
  closed: 'Geschlossen',
};

export function conversationStatusLabel(status: ConversationStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend',
};

export function priorityLabel(priority: TicketPriority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Compact relative time; the inbox needs "vor 4 Min." far more than a timestamp. */
export function relativeTime(value: string | null): string {
  if (!value) return '—';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} T.`;
  return formatDateTime(value);
}

export function percent(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)} %`;
}
