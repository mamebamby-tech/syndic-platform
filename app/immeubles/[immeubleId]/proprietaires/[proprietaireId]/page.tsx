import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { chargerReleve } from "@/lib/data/releve";

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
            {format.number(releve.totalAppele, "xof")}
          </p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">{t("totalPaye")}</p>
          <p className="mt-1 text-xl tabular-nums text-encre">{format.number(releve.totalPaye, "xof")}</p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">{t("soldeDu")}</p>
          <p
            className={`mt-1 text-xl tabular-nums ${
              releve.solde > 0 ? "text-impaye" : "text-encre"
            }`}
          >
            {format.number(releve.solde, "xof")}
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
                      {format.dateTime(new Date(mouvement.date), "dateJuridique")}
                    </td>
                    <td className="px-4 py-3 text-encre">
                      {mouvement.type === "appel"
                        ? mouvement.periodeLibelle
                          ? t("mouvementAppelPeriode", {
                              reference: mouvement.reference,
                              periode: mouvement.periodeLibelle,
                            })
                          : t("mouvementAppel", { reference: mouvement.reference })
                        : t("mouvementPaiement", { moyen: tMoyen(mouvement.moyen) })}
                    </td>
                    <td className="px-4 py-3 text-encre-2">
                      {mouvement.type === "appel"
                        ? tStatutAppel(mouvement.statut)
                        : tStatutPaiement(mouvement.statut)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        mouvement.sens === "du" ? "text-encre" : "text-action"
                      }`}
                    >
                      {mouvement.sens === "du" ? "+" : "−"}
                      {format.number(mouvement.montant, "xof")}
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
