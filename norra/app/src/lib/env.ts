import { z } from 'zod';

/**
 * Environment access, validated once at module load.
 *
 * Client and server variables are split deliberately: `serverEnv()` throws if it
 * is ever reached from browser code, so the service role key cannot leak into a
 * bundle by accident.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  N8N_WEBHOOK_URL: z.string().url(),
  N8N_WEBHOOK_SECRET: z.string().min(16),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}. See norra/app/.env.example.`);
  }
  return result.data;
}

// Next.js inlines NEXT_PUBLIC_* at build time only for literal property access,
// so these cannot be read from a dynamic object.
export const clientEnv: ClientEnv = parse(clientSchema, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

let cachedServerEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser. Server-only secrets must never reach the client.');
  }
  cachedServerEnv ??= parse(serverSchema, {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
    N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET,
  });
  return cachedServerEnv;
}
