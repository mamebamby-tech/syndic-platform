import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  chargerParametres,
  peutParametrer,
  roleSurOrganisation,
} from "@/lib/data/parametres-immeuble";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { codePeriode } from "@/lib/parametres/reference";
import { FormulaireParametres } from "@/components/parametres/formulaire-parametres";

export default async function PageParametres({
  params,
}: {
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;
  const parametres = await chargerParametres(immeubleId);
  if (!parametres) notFound();

  const t = await getTranslations("Parametres");

  // Réservé au gestionnaire et au proprietaire_org. La sécurité par ligne
  // interdit de toute façon l'écriture à un lecteur : ceci évite de lui montrer
  // un formulaire qui ne peut pas aboutir.
  if (!peutParametrer(await roleSurOrganisation(parametres.organisationId))) {
    return (
      <div>
        <h1 className="text-2xl text-encre">{t("accesReserve.titre")}</h1>
        <p className="mt-4 text-sm text-encre-2">{t("accesReserve.message")}</p>
      </div>
    );
  }

  const valeurs = await getValeurs();
  const maintenant = new Date();
  // Sans règlement en vigueur, la périodicité est inconnue : pas d'exemple
  // plutôt qu'une périodicité inventée.
  const periodicite = parametres.periodicite;

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-1 text-sm text-encre-2">{t("introduction")}</p>
      </header>

      <FormulaireParametres
        // Remonté à chaque enregistrement : les champs reprennent les valeurs enregistrées.
        key={`${parametres.compteModifieLe}|${parametres.codeReference}|${parametres.formatReference}`}
        parametres={parametres}
        exemple={
          periodicite
            ? {
                annee: maintenant.getUTCFullYear(),
                periode: codePeriode(periodicite, maintenant.getUTCMonth() + 1),
              }
            : null
        }
        dateDerniereModification={
          parametres.compteModifieLe ? valeurs.dateJuridique(parametres.compteModifieLe) : null
        }
      />
    </div>
  );
}
