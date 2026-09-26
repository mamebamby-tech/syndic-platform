import { useTranslations } from "next-intl";
import { seDeconnecter } from "@/app/auth/actions";
import type { ImmeubleAvecOrganisation } from "@/lib/data/immeubles";
import { SelecteurImmeuble } from "./selecteur-immeuble";
import { LienNav } from "./lien-nav";

export function BarreLaterale({
  organisationNom,
  immeubles,
  immeubleActuelId,
  peutParametrer,
}: {
  organisationNom: string;
  immeubles: ImmeubleAvecOrganisation[];
  immeubleActuelId: string;
  // Gestionnaire ou proprietaire_org : le lecteur ne voit pas l'entrée.
  peutParametrer: boolean;
}) {
  const t = useTranslations("Navigation");

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-filet bg-surface md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="border-b border-filet p-4">
        <p className="font-serif text-lg text-marque">{organisationNom}</p>
        <div className="mt-3">
          <SelecteurImmeuble immeubles={immeubles} immeubleActuelId={immeubleActuelId} />
        </div>
      </div>

      {/* Téléphone : une rangée qui défile ; poste de travail : une colonne. */}
      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap p-3 md:flex-1 md:flex-col md:overflow-visible md:whitespace-normal">
        <LienNav href={`/immeubles/${immeubleActuelId}`} exact>
          {t("tableauDeBord")}
        </LienNav>
        <LienNav href={`/immeubles/${immeubleActuelId}/lots`}>{t("registreLots")}</LienNav>
        <LienNav href={`/immeubles/${immeubleActuelId}/budget`}>{t("budget")}</LienNav>
        <LienNav href={`/immeubles/${immeubleActuelId}/appels`}>{t("appels")}</LienNav>
        <LienNav href={`/immeubles/${immeubleActuelId}/comptes`}>{t("comptes")}</LienNav>
        {peutParametrer && (
          <LienNav href={`/immeubles/${immeubleActuelId}/parametres`}>{t("parametres")}</LienNav>
        )}
      </nav>

      <form action={seDeconnecter} className="border-t border-filet p-3">
        <button
          type="submit"
          className="w-full rounded-control px-3 py-2 text-left text-sm text-encre-2 hover:bg-action-doux/60"
        >
          {t("deconnexion")}
        </button>
      </form>
    </aside>
  );
}
