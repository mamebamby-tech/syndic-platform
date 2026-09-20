import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { lireEnvSupabase } from "@/lib/supabase/env";

export function creerClientNavigateur() {
  const { url, cleAnonyme } = lireEnvSupabase();
  return createBrowserClient<Database>(url, cleAnonyme);
}
