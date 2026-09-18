import { trouverPeriodeCourante } from "@/lib/data/periodes";
import { chargerBudget } from "@/lib/data/budget";
import { SelecteurCle } from "@/components/budget/selecteur-cle";
import { formaterDate, formaterNombre } from "@/lib/format";
import { enregistrerBudget, genererAppels } from "./actions";

const LIBELLES_CATEGORIE: Record<string, string> = {
  general: "Charges générales",
  ascenseur: "Ascenseurs",
};

export default async function PageBudget({
  params,
}: {
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;
  const periode = await trouverPeriodeCourante(immeubleId);

  if (!periode) {
    return (
      <div>
        <h1 className="text-2xl text-encre">Budget</h1>
        <p className="mt-4 text-sm text-encre-2">
          Aucun exercice ni période n&apos;existe encore pour cet immeuble.
        </p>
      </div>
    );
  }

  const budget = await chargerBudget(immeubleId, periode.id);
  const aUnPosteAscenseur = budget.lignes.some((ligne) => ligne.categorie === "ascenseur");
  const posteIds = budget.lignes.map((ligne) => ligne.posteId).join(",");

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl text-encre">Budget — {periode.libelle}</h1>
          <p className="mt-1 text-sm text-encre-2">
            {periode.exerciceLibelle} · échéance du{" "}
            {formaterDate(periode.dateEcheance)}
            {budget.nombrePostesAZero > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-alerte">
                  {budget.nombrePostesAZero} poste
                  {budget.nombrePostesAZero > 1 ? "s" : ""} encore à zéro
                </span>
              </>
            )}
          </p>
        </div>

        <form action={genererAppels}>
          <input type="hidden" name="immeubleId" value={immeubleId} />
          <input type="hidden" name="periodeId" value={periode.id} />
          <button
            type="submit"
            className="h-11 rounded-control bg-action px-4 text-sm text-white"
          >
            Générer les appels de cette période
          </button>
        </form>
      </header>

      {aUnPosteAscenseur && (
        <div className="mb-6 rounded-card border border-alerte-doux bg-alerte-doux px-4 py-3 text-sm text-alerte">
          La clé de répartition des charges d&apos;ascenseur reste au règlement
          (tantièmes) : le rapport de gestion propose une pondération par
          étage, mais seule une assemblée à la majorité absolue peut trancher.
        </div>
      )}

      <form id="budget-form" action={enregistrerBudget} className="hidden">
        <input type="hidden" name="immeubleId" value={immeubleId} />
        <input type="hidden" name="periodeId" value={periode.id} />
        <input type="hidden" name="posteIds" value={posteIds} />
      </form>

      <div className="overflow-x-auto rounded-card border border-filet bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="px-4 py-3 font-medium">Poste</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Fournisseur</th>
              <th className="px-4 py-3 font-medium">Clé de répartition</th>
              <th className="px-4 py-3 text-right font-medium">Montant (XOF)</th>
            </tr>
          </thead>
          <tbody>
            {budget.lignes.map((ligne) => (
              <tr key={ligne.posteId} className="border-b border-filet last:border-0">
                <td className="px-4 py-3 text-encre">
                  {ligne.libelle}
                  {ligne.aZero && (
                    <span className="ml-2 rounded-control bg-alerte-doux px-1.5 py-0.5 text-xs text-alerte">
                      à zéro
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-encre-2">
                  {LIBELLES_CATEGORIE[ligne.categorie] ?? ligne.categorie}
                </td>
                <td className="px-4 py-3">
                  <input
                    form="budget-form"
                    type="text"
                    name={`fournisseur:${ligne.posteId}`}
                    defaultValue={ligne.fournisseur}
                    placeholder="—"
                    className="h-9 w-full rounded-control border border-filet bg-surface px-2 text-encre outline-none focus:border-action"
                  />
                </td>
                <td className="px-4 py-3">
                  <SelecteurCle
                    immeubleId={immeubleId}
                    posteId={ligne.posteId}
                    cleActuelleId={ligne.cleRepartitionId}
                    options={budget.cles}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <input
                    form="budget-form"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    name={`montant:${ligne.posteId}`}
                    defaultValue={ligne.montant}
                    className="h-9 w-32 rounded-control border border-filet bg-surface px-2 text-right tabular-nums text-encre outline-none focus:border-action"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {budget.totauxParCategorie.map(({ categorie, total }) => (
              <tr key={categorie} className="border-t border-filet text-encre-2">
                <td className="px-4 py-2" colSpan={4}>
                  Total {(LIBELLES_CATEGORIE[categorie] ?? categorie).toLowerCase()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formaterNombre(total)}</td>
              </tr>
            ))}
            <tr className="border-t border-filet font-medium text-encre">
              <td className="px-4 py-3" colSpan={4}>
                Total général
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formaterNombre(budget.totalGeneral)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4">
        <button
          type="submit"
          form="budget-form"
          className="h-11 rounded-control bg-action px-4 text-sm text-white"
        >
          Enregistrer le budget
        </button>
      </div>
    </div>
  );
}
