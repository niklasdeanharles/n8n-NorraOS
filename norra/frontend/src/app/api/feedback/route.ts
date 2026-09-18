import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { verifyWidgetToken } from '@/lib/widget/token';

/**
 * Customer satisfaction rating from the web widget.
 *
 * Authenticated the same way every other widget route is: by the signed
 * token from /api/widget/session, never by ids named in the request body.
 * An earlier version of this route took `conversationId` and
 * `organizationId` directly and matched them against each other -- workable,
 * but the one widget-adjacent endpoint still trusting client-supplied tenant
 * ids once the rest of the surface had moved to signed tokens. Nothing
 * called it yet, so there was no contract to preserve; this closes the gap
 * instead of leaving a second, weaker pattern standing next to the first.
 *
 * Ratings are one-shot: a conversation that already carries a score is left
 * alone, so a reload or a double click cannot overwrite the first answer.
 */
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  token: z.string().min(1),
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

  const claims = verifyWidgetToken(parsed.data.token);
  if (!claims) {
    return NextResponse.json({ error: 'session expired' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, csat')
    .eq('id', claims.c)
    .eq('organization_id', claims.o)
    .maybeSingle();

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

  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
