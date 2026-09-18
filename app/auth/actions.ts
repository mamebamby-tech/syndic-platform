"use server";

import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/server";

export async function seDeconnecter() {
  const supabase = await creerClientServeur();
  await supabase.auth.signOut();
  redirect("/login");
}
