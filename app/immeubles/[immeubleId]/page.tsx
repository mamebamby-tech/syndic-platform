import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  chargerParametres,
  listerModificationsParametres,
  peutParametrer,
  roleSurOrganisation,
} from "@/lib/data/parametres-immeuble";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import type { ModificationDecrite } from "@/lib/parametres/journal";
import { ChangementParametre } from "@/components/tableau-de-bord/changement-parametre";

export default async function PageTableauDeBord({
  params,
}: {
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;
  const parametres = await chargerParametres(immeubleId);
  if (!parametres) notFound();

  const [t, valeurs, modifications, role] = await Promise.all([
    getTranslations("TableauDeBord"),
    getValeurs(),
    listerModificationsParametres(immeubleId, 5),
    roleSurOrganisation(parametres.organisationId),
  ]);

  const compteRenseigne = [parametres.titulaire, parametres.banque, parametres.numero].every(
    (champ) => champ.trim().length > 0,
  );
  // La dernière modification des coordonnées de paiement est toujours signalée :
  // elle change l'endroit où les copropriétaires paient.
  const derniere = modifications.find((m) => m.action === "coordonnees_paiement_modifiees");

  const titre = (m: ModificationDecrite) =>
    m.action === "format_reference_modifie"
      ? t("modification.format_reference_modifie")
      : m.premiereSaisie
        ? t("modification.premiereSaisie")
        : t("modification.coordonnees_paiement_modifiees");
  const quand = (m: ModificationDecrite) =>
    m.acteur
      ? t("modification.leParAuteur", { date: valeurs.dateHeure(m.date), acteur: m.acteur })
      : t("modification.leAuteurInconnu", { date: valeurs.dateHeure(m.date) });

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
      </header>

      <section aria-labelledby="a-traiter">
        <h2 id="a-traiter" className="mb-3 font-serif text-lg text-marque">
          {t("aTraiter")}
        </h2>

        <div className="space-y-4">
          <div className="rounded-card border border-filet bg-surface p-4">
            <h3 className="text-sm font-medium text-encre">{t("paiement.titre")}</h3>
            <p className={`mt-1 text-sm ${compteRenseigne ? "text-encre-2" : "text-alerte"}`}>
              {compteRenseigne ? t("paiement.renseignees") : t("paiement.nonRenseignees")}
              {parametres.compteModifieLe && (
                <>
                  {" "}
                  {t("paiement.derniereModification", {
                    date: valeurs.dateJuridique(parametres.compteModifieLe),
                  })}
                </>
              )}
            </p>
            {peutParametrer(role) && (
              <Link
                href={`/immeubles/${immeubleId}/parametres`}
                className="mt-2 inline-block text-sm text-action underline-offset-2 hover:underline"
              >
                {t("paiement.ouvrirParametres")}
              </Link>
            )}
          </div>

          {derniere && (
            <div
              role="alert"
              className="rounded-card border border-alerte-doux bg-alerte-doux p-4 text-alerte"
            >
              <p className="text-sm font-medium">{titre(derniere)}</p>
              <p className="mt-0.5 text-sm">{quand(derniere)}</p>
              <ul className="mt-2 space-y-1 text-encre">
                {derniere.changements.map((changement) => (
                  <ChangementParametre key={changement.champ} changement={changement} />
                ))}
              </ul>
              <p className="mt-2 text-xs">{t("paiement.verifier")}</p>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="historique" className="mt-8">
        <h2 id="historique" className="mb-3 font-serif text-lg text-marque">
          {t("paiement.historique")}
        </h2>
        {modifications.length === 0 ? (
          <p className="text-sm text-encre-2">{t("paiement.aucuneModification")}</p>
        ) : (
          <ul className="divide-y divide-filet rounded-card border border-filet bg-surface">
            {modifications.map((m) => (
              <li key={m.id} className="p-4">
                <p className="text-sm font-medium text-encre">{titre(m)}</p>
                <p className="text-xs text-encre-3">{quand(m)}</p>
                <ul className="mt-2 space-y-1">
                  {m.changements.map((changement) => (
                    <ChangementParametre key={changement.champ} changement={changement} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
