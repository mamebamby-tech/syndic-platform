import { getFormatter, getTranslations } from "next-intl/server";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { trouverPeriodeCourante } from "@/lib/data/periodes";
import { chargerBudget } from "@/lib/data/budget";
import { SelecteurCle } from "@/components/budget/selecteur-cle";
import type { Messages } from "@/lib/i18n/messages";
import { enregistrerBudget, genererAppels } from "./actions";

// Une catégorie sans libellé dans messages/*.json s'affiche sous son code :
// les catégories viennent de la base, pas d'une liste figée dans le code.
type CategorieConnue = keyof Messages["Budget"]["categories"];

export default async function PageBudget({
  params,
}: {
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;
  const periode = await trouverPeriodeCourante(immeubleId);
  const t = await getTranslations("Budget");
  const tCommun = await getTranslations("Commun");
  const format = await getFormatter();
  const valeurs = await getValeurs();
  const categorieConnue = (categorie: string): categorie is CategorieConnue =>
    t.has(`categories.${categorie}` as "categories.general");

  if (!periode) {
    return (
      <div>
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-4 text-sm text-encre-2">{t("aucunePeriode")}</p>
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
          <h1 className="text-2xl text-encre">{t("titrePeriode", { periode: periode.libelle })}</h1>
          <p className="mt-1 text-sm text-encre-2">
            {t("exerciceEcheance", {
              exercice: periode.exerciceLibelle,
              echeance: valeurs.dateJuridique(periode.dateEcheance),
            })}
            {budget.nombrePostesAZero > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-alerte">
                  {t("postesAZero", { nombre: budget.nombrePostesAZero })}
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
            {t("genererAppels")}
          </button>
        </form>
      </header>

      {aUnPosteAscenseur && (
        <div className="mb-6 rounded-card border border-alerte-doux bg-alerte-doux px-4 py-3 text-sm text-alerte">
          {t("avertissementAscenseur")}
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
              <th className="px-4 py-3 font-medium">{t("colonnes.poste")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.categorie")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.fournisseur")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.cleRepartition")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("colonnes.montant", { devise: valeurs.devise })}</th>
            </tr>
          </thead>
          <tbody>
            {budget.lignes.map((ligne) => (
              <tr key={ligne.posteId} className="border-b border-filet last:border-0">
                <td className="px-4 py-3 text-encre">
                  {ligne.libelle}
                  {ligne.aZero && (
                    <span className="ml-2 rounded-control bg-alerte-doux px-1.5 py-0.5 text-xs text-alerte">
                      {t("aZero")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-encre-2">
                  {categorieConnue(ligne.categorie) ? t(`categories.${ligne.categorie}`) : ligne.categorie}
                </td>
                <td className="px-4 py-3">
                  <input
                    form="budget-form"
                    type="text"
                    name={`fournisseur:${ligne.posteId}`}
                    defaultValue={ligne.fournisseur}
                    placeholder={tCommun("nonRenseigne")}
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
            {/* Le total est celui des charges communes (art. 15 du règlement) ;
                « général » et « ascenseur » sont des catégories de suivi qui
                le décomposent, pas des charges d'un autre rang. */}
            <tr className="border-t border-filet font-medium text-encre">
              <td className="px-4 py-3" colSpan={4}>
                {t("totalChargesCommunes")}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {format.number(budget.totalChargesCommunes)}
              </td>
            </tr>
            {budget.totauxParCategorie.map(({ categorie, total }) => (
              <tr key={categorie} className="text-encre-2">
                <td className="py-2 pl-8 pr-4" colSpan={4}>
                  {categorieConnue(categorie)
                    ? t(`dontCategorie.${categorie}`)
                    : t("dontCategorie.autre", { categorie })}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{format.number(total)}</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <div className="mt-4">
        <button
          type="submit"
          form="budget-form"
          className="h-11 rounded-control bg-action px-4 text-sm text-white"
        >
          {t("enregistrer")}
        </button>
      </div>
    </div>
  );
}
