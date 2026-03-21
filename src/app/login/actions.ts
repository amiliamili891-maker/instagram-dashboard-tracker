"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(1, "Enter your password"),
});

function redirectWithError(message: string) {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function signInWithPassword(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return redirectWithError(parsed.error.issues[0]?.message ?? "Invalid sign-in details");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return redirectWithError("Invalid email or password");
  }

  redirect("/dashboard");
}
