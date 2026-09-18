import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { clientEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Routes reachable without a session. Everything else requires one.
 *
 * The voice webhooks belong here and it is not a relaxation: a caller is not a
 * Supabase user and a telephony provider carries no cookie. Redirecting them to
 * the login page would answer every incoming call with HTML. They authenticate
 * by signature instead, which every one of those routes checks before it does
 * anything -- see lib/voice/session.ts.
 */
const PUBLIC_PATHS = [
  '/login', '/signup', '/auth', '/api/agent-turn', '/api/feedback', '/api/voice',
  // The embeddable chat widget and its API. A website visitor is not a
  // Supabase user either; the widget authenticates by the signed token from
  // lib/widget/token.ts, checked inside each route, not by session.
  '/widget', '/api/widget',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *
 * The response object has to be the one the Supabase client wrote its cookies
 * onto -- building a fresh NextResponse here would silently drop the refreshed
 * session and log users out at random.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates against the auth server. getSession() only reads the
  // cookie and must not be trusted for an authorization decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
