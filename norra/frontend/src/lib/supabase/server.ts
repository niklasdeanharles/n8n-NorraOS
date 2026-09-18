import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { clientEnv, serverEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Server client for Server Components, Route Handlers and Server Actions.
 * Runs as the signed-in user, so RLS applies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes the
            // session on every request, so this is safe to swallow.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. BYPASSES RLS -- every query must scope itself by
 * organization_id by hand. Use only where a request genuinely has to act
 * outside a user session, and never in code reachable from the browser.
 */
export function createServiceRoleClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
