import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listerImmeublesAccessibles } from "@/lib/data/immeubles";

export default async function PageAccueil() {
  const immeubles = await listerImmeublesAccessibles();
  const t = await getTranslations("Accueil.aucunImmeuble");

  if (immeubles.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fond px-4 text-center">
        <div>
          <h1 className="text-xl text-encre">{t("titre")}</h1>
          <p className="mt-2 text-sm text-encre-2">
            {t("message")}
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
