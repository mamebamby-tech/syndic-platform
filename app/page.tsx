import { redirect } from "next/navigation";
import { listerImmeublesAccessibles } from "@/lib/data/immeubles";

export default async function PageAccueil() {
  const immeubles = await listerImmeublesAccessibles();

  if (immeubles.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fond px-4 text-center">
        <div>
          <h1 className="text-xl text-encre">Aucun immeuble accessible</h1>
          <p className="mt-2 text-sm text-encre-2">
            Ce compte n&apos;est rattaché à aucun cabinet de syndic. Contactez
            votre administrateur.
          </p>
        </div>
      </main>
    );
  }

  const premier = immeubles[0];
  if (!premier) {
    redirect("/login");
  }
  redirect(`/immeubles/${premier.id}/lots`);
}
