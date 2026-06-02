"use server";

import { auth } from "@/lib/auth/neon-auth";
import { db } from "@/lib/db";
import { users as usersT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type AuthActionResult = { ok: true } | { ok: false; error: string; field?: string };

// Staff sign-up. Neon Auth creates the auth user (neon_auth schema); we then
// insert the matching public.users row — there is no DB trigger doing this
// anymore (the old Supabase on_auth_user_created trigger was dropped in the
// Neon migration). The Neon Auth user id IS public.users.id.
export async function signUpAction(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  const { data, error } = await auth.signUp.email({
    email: input.email,
    password: input.password,
    name: input.fullName,
  });

  if (error) {
    const msg = error.message ?? "Sign-up failed.";
    if (/exist|registered|already/i.test(msg)) {
      return { ok: false, error: "This email is already registered.", field: "email" };
    }
    return { ok: false, error: msg, field: "form" };
  }

  const userId = data?.user?.id;
  if (!userId) {
    return { ok: false, error: "Sign-up did not return a user.", field: "form" };
  }

  // Mirror the auth identity into public.users (idempotent — a retried signup
  // or an existing row shouldn't error).
  await db
    .insert(usersT)
    .values({
      id: userId,
      email: input.email,
      fullName: input.fullName.trim(),
    })
    .onConflictDoUpdate({
      target: usersT.id,
      set: { email: input.email, fullName: input.fullName.trim() },
    });

  return { ok: true };
}

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  const { error } = await auth.signIn.email({
    email: input.email,
    password: input.password,
  });
  if (error) {
    return { ok: false, error: "Invalid email or password.", field: "form" };
  }
  // Defensive: ensure a public.users row exists for this session (covers users
  // created out-of-band, e.g. seeded auth users without a mirror row).
  const { data } = await auth.getSession();
  const u = data?.user;
  if (u?.id) {
    await db
      .insert(usersT)
      .values({ id: u.id, email: u.email ?? input.email, fullName: u.name ?? input.email })
      .onConflictDoNothing({ target: usersT.id });
  }
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  await auth.signOut();
}

export async function getPublicUser(userId: string) {
  const [row] = await db.select().from(usersT).where(eq(usersT.id, userId)).limit(1);
  return row ?? null;
}

// Current session's display name (for prefill etc.). Null if not signed in.
export async function getCurrentUserName(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data?.user?.name ?? null;
}
