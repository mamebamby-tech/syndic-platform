import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/server";
import { FormulaireConnexion } from "./login-form";

export default async function PageConnexion() {
  const supabase = await creerClientServeur();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-fond px-4">
      <FormulaireConnexion />
    </main>
  );
}
