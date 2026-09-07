'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type AuthFormState = { error: string | null };

const credentials = z.object({
  email: z.string().email('Bitte eine gültige E-Mail-Adresse angeben.'),
  password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen haben.'),
});

const signupInput = credentials.extend({
  fullName: z.string().trim().min(1, 'Bitte einen Namen angeben.'),
  organizationName: z.string().trim().min(1, 'Bitte einen Organisationsnamen angeben.'),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Eingabe ungültig.';
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'E-Mail oder Passwort stimmt nicht.' };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signupInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
    organizationName: formData.get('organizationName'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();

  // The organizations row and the admin profile are created by the
  // on_auth_user_created trigger from this metadata -- see migration
  // 20260829090100. Nothing is provisioned here.
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        organization_name: parsed.data.organizationName,
      },
    },
  });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
