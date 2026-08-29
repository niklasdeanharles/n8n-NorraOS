import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Customer satisfaction rating from the chat widget.
 *
 * The end user is not a Supabase auth user, so this runs with the service role
 * and does its own scoping: the rating only lands if the conversation id and
 * organization id match the same row. Without that pairing, knowing a
 * conversation id would be enough to rate somebody else's conversation.
 *
 * Ratings are one-shot. A conversation that already carries a score is left
 * alone, so a reload or a double click cannot overwrite the first answer.
 */
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  conversationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
});

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'rating must be a whole number from 1 to 5' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, csat')
    .eq('id', parsed.data.conversationId)
    .eq('organization_id', parsed.data.organizationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
  }
  if (conversation.csat !== null) {
    return NextResponse.json({ error: 'already rated' }, { status: 409 });
  }

  const { error } = await supabase
    .from('conversations')
    .update({ csat: parsed.data.rating })
    .eq('id', conversation.id)
    .is('csat', null);

  if (error) return NextResponse.json({ error: 'could not save rating' }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
