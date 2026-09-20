import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { chargerReleve } from "@/lib/data/releve";
import { peutParametrer, roleSurOrganisation } from "@/lib/data/parametres-immeuble";
import { AnnulationPaiement } from "@/components/releve/annulation-paiement";
import { FormulaireEnregistrementPaiement } from "@/components/releve/formulaire-paiement";

export default async function PageReleveProprietaire({
  params,
}: {
  params: Promise<{ immeubleId: string; proprietaireId: string }>;
}) {
  const { immeubleId, proprietaireId } = await params;
  const resultat = await chargerReleve(proprietaireId);

  if (!resultat) {
    notFound();
  }

  if (resultat.type === "redirection") {
    redirect(`/immeubles/${immeubleId}/proprietaires/${resultat.versProprietaireId}`);
  }

  const { releve } = resultat;
  const t = await getTranslations("Releve");
  const tStatutAppel = await getTranslations("StatutAppelReleve");
  const tStatutPaiement = await getTranslations("StatutPaiement");
  const tMoyen = await getTranslations("MoyenPaiement");
  const format = await getFormatter();
  const valeurs = await getValeurs();

  // Enregistrer ou annuler un paiement : gestionnaire et proprietaire_org. La base
  // le refuse de toute façon à un lecteur ; ceci lui évite un formulaire qui ne
  // peut pas aboutir.
  const peutSaisir = peutParametrer(await roleSurOrganisation(releve.organisationId));
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{releve.nom}</h1>
        <p className="mt-1 text-sm text-encre-2">
          {releve.email ?? t("aucunEmail")} · {releve.telephone ?? t("aucunTelephone")}
        </p>
      </header>

      {releve.estGroupe && releve.membresGroupe.length > 0 && (
        <div className="mb-6 rounded-card border border-action-doux bg-action-doux px-4 py-3 text-sm text-action-encre">
          {t("compteConsolide", {
            membres: format.list(
              releve.membresGroupe.map((membre) => membre.nom),
              { type: "unit", style: "long" },
            ),
          })}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">{t("totalAppele")}</p>
          <p className="mt-1 text-xl tabular-nums text-encre">
            {valeurs.montant(releve.totalAppele)}
          </p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">{t("totalPaye")}</p>
          <p className="mt-1 text-xl tabular-nums text-encre">{valeurs.montant(releve.totalPaye)}</p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">{t("soldeDu")}</p>
          <p
            className={`mt-1 text-xl tabular-nums ${
              releve.solde > 0 ? "text-impaye" : "text-encre"
            }`}
          >
            {valeurs.montant(releve.solde)}
          </p>
        </div>
      </div>

      <section className="mb-6">
        <h2 className="mb-3 font-serif text-lg text-marque">
          {t("titreLots", { nombre: releve.lots.length })}
        </h2>
        <div className="overflow-x-auto rounded-card border border-filet bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                <th className="px-4 py-3 font-medium">{t("colonnesLots.lot")}</th>
                <th className="px-4 py-3 font-medium">{t("colonnesLots.designation")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colonnesLots.tantiemes")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colonnesLots.quotePart")}</th>
              </tr>
            </thead>
            <tbody>
              {releve.lots.map((lot) => (
                <tr key={lot.numero} className="border-b border-filet last:border-0">
                  <td className="px-4 py-3 tabular-nums text-encre">{lot.numero}</td>
                  <td className="px-4 py-3 text-encre">{lot.designation}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre">
                    {format.number(lot.tantiemes)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                    {format.number(lot.quotePart, "pourcentage")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {peutSaisir && (
        <section className="mb-6">
          <h2 className="mb-3 font-serif text-lg text-marque">{t("titreEnregistrement")}</h2>
          <div className="rounded-card border border-filet bg-surface p-4">
            <FormulaireEnregistrementPaiement
              immeubleId={immeubleId}
              proprietaireId={releve.proprietaireId}
              appels={releve.appelsPayables}
              aujourdhui={aujourdhui}
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-serif text-lg text-marque">{t("titreMouvements")}</h2>
        {releve.mouvements.length === 0 ? (
          <p className="text-sm text-encre-2">{t("aucunMouvement")}</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-filet bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                  <th className="px-4 py-3 font-medium">{t("colonnesMouvements.date")}</th>
                  <th className="px-4 py-3 font-medium">{t("colonnesMouvements.mouvement")}</th>
                  <th className="px-4 py-3 font-medium">{t("colonnesMouvements.statut")}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("colonnesMouvements.montant")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {releve.mouvements.map((mouvement, index) => (
                  <tr key={index} className="border-b border-filet last:border-0">
                    <td className="px-4 py-3 tabular-nums text-encre-2">
                      {valeurs.dateCourte(mouvement.date)}
                    </td>
                    <td className="px-4 py-3 text-encre">
                      {mouvement.type === "appel" ? (
                        mouvement.periodeLibelle
                          ? t("mouvementAppelPeriode", {
                              reference: mouvement.reference,
                              periode: mouvement.periodeLibelle,
                            })
                          : t("mouvementAppel", { reference: mouvement.reference })
                      ) : (
                        <>
                          {mouvement.appelReference
                            ? t(mouvement.annulation ? "mouvementAnnulation" : "mouvementPaiementAppel", {
                                moyen: tMoyen(mouvement.moyen),
                                reference: mouvement.appelReference,
                              })
                            : t("mouvementPaiement", { moyen: tMoyen(mouvement.moyen) })}
                          {mouvement.referenceExterne && (
                            <span className="block text-xs text-encre-3">
                              {t("referenceExterne", { reference: mouvement.referenceExterne })}
                            </span>
                          )}
                          {mouvement.motif && (
                            <span className="block text-xs text-encre-3">
                              {t("motifAnnulation", { motif: mouvement.motif })}
                            </span>
                          )}
                          {peutSaisir && mouvement.annulable && (
                            <AnnulationPaiement
                              immeubleId={immeubleId}
                              proprietaireId={releve.proprietaireId}
                              paiementId={mouvement.id}
                            />
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-encre-2">
                      {mouvement.type === "appel"
                        ? tStatutAppel(mouvement.statut)
                        : mouvement.annulation
                          ? t("statutAnnulation")
                          : mouvement.dejaAnnule
                            ? t("statutPaiementAnnule")
                            : tStatutPaiement(mouvement.statut)}
                      {mouvement.type === "appel" && !mouvement.compte && (
                        <span className="block text-xs text-encre-3">{t("appelNonCompte")}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        mouvement.type === "appel"
                          ? mouvement.compte
                            ? "text-encre"
                            : "text-encre-3 line-through"
                          : mouvement.montant > 0
                            ? "text-action"
                            : "text-encre"
                      }`}
                    >
                      {mouvement.type === "appel" ? "+" : mouvement.montant > 0 ? "−" : "+"}
                      {valeurs.montant(Math.abs(mouvement.montant))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
