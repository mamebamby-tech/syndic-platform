import { notFound, redirect } from "next/navigation";
import { chargerReleve } from "@/lib/data/releve";
import { formaterDate, formaterNombre, formaterXof } from "@/lib/format";

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

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{releve.nom}</h1>
        <p className="mt-1 text-sm text-encre-2">
          {releve.email ?? "aucune adresse électronique"} ·{" "}
          {releve.telephone ?? "aucun numéro de téléphone"}
        </p>
      </header>

      {releve.estGroupe && releve.membresGroupe.length > 0 && (
        <div className="mb-6 rounded-card border border-action-doux bg-action-doux px-4 py-3 text-sm text-action-encre">
          Compte consolidé : {releve.membresGroupe.map((membre) => membre.nom).join(", ")}{" "}
          partagent le même ayant droit. Le regroupement est une donnée
          réversible — il peut être défait sans toucher au code.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">Total appelé</p>
          <p className="mt-1 text-xl tabular-nums text-encre">
            {formaterXof(releve.totalAppele)}
          </p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">Total payé</p>
          <p className="mt-1 text-xl tabular-nums text-encre">{formaterXof(releve.totalPaye)}</p>
        </div>
        <div className="rounded-card border border-filet bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-encre-3">Solde dû</p>
          <p
            className={`mt-1 text-xl tabular-nums ${
              releve.solde > 0 ? "text-impaye" : "text-encre"
            }`}
          >
            {formaterXof(releve.solde)}
          </p>
        </div>
      </div>

      <section className="mb-6">
        <h2 className="mb-3 font-serif text-lg text-marque">
          Lots ({releve.lots.length})
        </h2>
        <div className="overflow-x-auto rounded-card border border-filet bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                <th className="px-4 py-3 font-medium">Lot</th>
                <th className="px-4 py-3 font-medium">Désignation</th>
                <th className="px-4 py-3 text-right font-medium">Tantièmes</th>
                <th className="px-4 py-3 text-right font-medium">Quote-part</th>
              </tr>
            </thead>
            <tbody>
              {releve.lots.map((lot) => (
                <tr key={lot.numero} className="border-b border-filet last:border-0">
                  <td className="px-4 py-3 tabular-nums text-encre">{lot.numero}</td>
                  <td className="px-4 py-3 text-encre">{lot.designation}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre">
                    {formaterNombre(lot.tantiemes)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                    {(lot.quotePart * 100).toLocaleString("fr-FR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-serif text-lg text-marque">Mouvements</h2>
        {releve.mouvements.length === 0 ? (
          <p className="text-sm text-encre-2">Aucun mouvement pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-filet bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Mouvement</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody>
                {releve.mouvements.map((mouvement, index) => (
                  <tr key={index} className="border-b border-filet last:border-0">
                    <td className="px-4 py-3 tabular-nums text-encre-2">
                      {formaterDate(mouvement.date)}
                    </td>
                    <td className="px-4 py-3 text-encre">{mouvement.libelle}</td>
                    <td className="px-4 py-3 text-encre-2">{mouvement.statut}</td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        mouvement.sens === "du" ? "text-encre" : "text-action"
                      }`}
                    >
                      {mouvement.sens === "du" ? "+" : "−"}
                      {formaterXof(mouvement.montant)}
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
