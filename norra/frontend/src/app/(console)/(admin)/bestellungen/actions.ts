'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentActor, recordAudit } from '@/lib/audit';
import { createClient } from '@/lib/supabase/server';

export type OrderFormState = { error: string | null; ok?: string };

/**
 * Die Spaltenliste ist das Feld, auf das es ankommt.
 *
 * Eine Bestelltabelle trägt fast immer mehr als den Status: Einkaufspreis,
 * Marge, interne Notizen. Gäbe der Workflow die ganze Zeile an das Modell,
 * läse es sie früher oder später vor — nicht aus Bosheit, sondern weil es
 * hilfsbereit ist. Also wird aufgezählt, was hinaus darf.
 */
const sourceSchema = z
  .object({
    label: z.string().trim().min(1, 'Name fehlt.').max(120),
    kind: z.enum(['google_sheet', 'http']),
    sheetId: z.string().trim().max(200),
    sheetRange: z.string().trim().max(120),
    endpointUrl: z.string().trim().max(500),
    matchColumn: z.string().trim().min(1, 'Spalte mit der Bestellnummer fehlt.').max(80),
    returnColumns: z.string().trim().min(1, 'Mindestens eine Spalte angeben, die der Kunde hören darf.'),
  })
  .refine((v) => v.kind !== 'google_sheet' || (v.sheetId && v.sheetRange), {
    message: 'Für ein Google Sheet braucht es Tabellen-ID und Bereich.',
    path: ['sheetId'],
  })
  .refine((v) => v.kind !== 'http' || v.endpointUrl.startsWith('https://'), {
    message: 'Der Endpunkt muss mit https:// beginnen — eine Bestellnummer ist ein Kundendatum.',
    path: ['endpointUrl'],
  });

/** „Status, Lieferdatum" → ['Status', 'Lieferdatum']. Leere Einträge fallen weg. */
function splitColumns(input: string): string[] {
  return [...new Set(input.split(',').map((part) => part.trim()).filter(Boolean))];
}

export async function addOrderSource(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const parsed = sourceSchema.safeParse({
    label: formData.get('label'),
    kind: formData.get('kind'),
    sheetId: formData.get('sheetId') ?? '',
    sheetRange: formData.get('sheetRange') ?? '',
    endpointUrl: formData.get('endpointUrl') ?? '',
    matchColumn: formData.get('matchColumn'),
    returnColumns: formData.get('returnColumns'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Eingabe ungültig.' };

  const columns = splitColumns(parsed.data.returnColumns);
  if (columns.length === 0) return { error: 'Mindestens eine Spalte angeben, die der Kunde hören darf.' };
  if (columns.length > 12) return { error: 'Höchstens zwölf Spalten — mehr liest am Telefon niemand vor.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Bestellquellen anlegen.' };

  const isSheet = parsed.data.kind === 'google_sheet';
  const { error } = await supabase.from('order_sources').insert({
    organization_id: actor.organizationId,
    label: parsed.data.label,
    kind: parsed.data.kind,
    sheet_id: isSheet ? parsed.data.sheetId : null,
    sheet_range: isSheet ? parsed.data.sheetRange : null,
    endpoint_url: isSheet ? null : parsed.data.endpointUrl,
    match_column: parsed.data.matchColumn,
    return_columns: columns,
    created_by: actor.id,
  });
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'create',
    entityType: 'order_source',
    entityId: parsed.data.label,
    entityLabel: `${parsed.data.label} (${columns.join(', ')})`,
  });

  revalidatePath('/bestellungen');
  return { error: null, ok: `„${parsed.data.label}” angelegt. Der Agent kann ab dem nächsten Gespräch nachschlagen.` };
}

export async function toggleOrderSource(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const id = z.string().uuid().safeParse(formData.get('id'));
  const active = formData.get('active') === 'true';
  if (!id.success) return { error: 'Unbekannte Quelle.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Bestellquellen ändern.' };

  const { error } = await supabase.from('order_sources').update({ active }).eq('id', id.data);
  if (error) return { error: error.message };

  revalidatePath('/bestellungen');
  return {
    error: null,
    ok: active ? 'Wieder aktiv.' : 'Pausiert. Der Agent schlägt hier nicht mehr nach.',
  };
}

export async function removeOrderSource(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unbekannte Quelle.' };

  const supabase = await createClient();
  const actor = await currentActor(supabase);
  if (!actor) return { error: 'Nicht angemeldet.' };
  if (actor.role !== 'admin') return { error: 'Nur Admins können Bestellquellen entfernen.' };

  const { data: before } = await supabase.from('order_sources').select('label').eq('id', id.data).maybeSingle();
  const { error } = await supabase.from('order_sources').delete().eq('id', id.data);
  if (error) return { error: error.message };

  await recordAudit(supabase, {
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: 'delete',
    entityType: 'order_source',
    entityId: id.data,
    entityLabel: before?.label ?? id.data,
  });

  revalidatePath('/bestellungen');
  return { error: null, ok: 'Entfernt.' };
}
