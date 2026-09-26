import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { chargerRecouvrement } from "@/lib/data/recouvrement";
import { sansMentionGroupe } from "@/lib/data/nom-groupe";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { comptesParProprietaire, tranchesAnciennete } from "@/lib/recouvrement/calcul";
import { LibelleTranche } from "@/components/comptes/libelle-tranche";

// La liste vers laquelle mènent les cartes du tableau de bord : chaque
// propriétaire destinataire d'appels, sa situation sur la période en cours et
// ce qui reste dû, filtrée par l'adresse (?filtre=…, ?anciennete=…).

const FILTRES = ["en-retard", "reste-du", "injoignables"] as const;
type Filtre = (typeof FILTRES)[number];

export default async function PageComptes({
  params,
  searchParams,
}: {
  params: Promise<{ immeubleId: string }>;
  searchParams: Promise<{ filtre?: string; anciennete?: string }>;
}) {
  const { immeubleId } = await params;
  const recherche = await searchParams;
  const [t, valeurs, donnees] = await Promise.all([
    getTranslations("Comptes"),
    getValeurs(),
    chargerRecouvrement(immeubleId),
  ]);

  const { periode, situations, bornes, destinataires } = donnees;
  const comptes = comptesParProprietaire(situations, periode?.id ?? null, bornes);
  const tranche = tranchesAnciennete(bornes).find((tr) => tr.cle === recherche.anciennete) ?? null;
  const filtre: Filtre | null = FILTRES.find((f) => f === recherche.filtre) ?? null;

  const lignes = destinataires
    .map((d) => ({ destinataire: d, compte: comptes.get(d.id) ?? null }))
    .filter(({ destinataire, compte }) => {
      if (tranche) return compte?.clesTranches.includes(tranche.cle) ?? false;
      switch (filtre) {
        case "en-retard":
          return (compte?.resteDuEchu ?? 0) > 0;
        case "reste-du":
          return (compte?.periode?.resteDu ?? 0) > 0;
        case "injoignables":
          return destinataire.injoignable;
        default:
          return true;
      }
    })
    // Les plus gros restes dus d'abord : c'est l'ordre dans lequel on relance.
    .sort(
      (a, b) =>
        (b.compte?.resteDuTotal ?? 0) - (a.compte?.resteDuTotal ?? 0) ||
        a.destinataire.nom.localeCompare(b.destinataire.nom),
    );

  const base = `/immeubles/${immeubleId}/comptes`;
  const pastille = (actif: boolean) =>
    `inline-flex min-h-11 items-center rounded-control border px-3 text-sm ${
      actif ? "border-action bg-action-doux text-action-encre" : "border-filet bg-surface text-encre-2 hover:bg-action-doux/60"
    }`;
  const tonStatut = { solde: "text-action", partiel: "text-alerte", impaye: "text-impaye" } as const;

  return (
    <div className="max-w-5xl">
      <header className="mb-4">
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-1 text-sm text-encre-2">
          {t("resume", { nombre: lignes.length, periode: periode?.libelle ?? t("aucunePeriode") })}
        </p>
      </header>

      <nav aria-label={t("filtresLibelle")} className="mb-4 flex flex-wrap gap-2">
        <Link href={base} className={pastille(!filtre && !tranche)}>
          {t("filtre.tous")}
        </Link>
        {FILTRES.map((f) => (
          <Link key={f} href={`${base}?filtre=${f}`} className={pastille(filtre === f && !tranche)}>
            {t(`filtre.${f}`)}
          </Link>
        ))}
        {tranche && (
          <span className={pastille(true)}>
            <LibelleTranche tranche={tranche} prefixe />
            <Link href={base} className="ml-2 text-action underline underline-offset-2">
              {t("retirerFiltre")}
            </Link>
          </span>
        )}
      </nav>

      {lignes.length === 0 ? (
        <p className="rounded-card border border-filet bg-surface p-4 text-sm text-encre-2">{t("vide")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-filet bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                <th className="px-4 py-3 font-medium">{t("colonnes.proprietaire")}</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">{t("colonnes.appele")}</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">{t("colonnes.paye")}</th>
                <th className="px-4 py-3 font-medium">{t("colonnes.statut")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colonnes.resteDu")}</th>
                <th className="hidden px-4 py-3 text-right font-medium md:table-cell">{t("colonnes.retard")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-filet">
              {lignes.map(({ destinataire, compte }) => (
                <tr key={destinataire.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/immeubles/${immeubleId}/proprietaires/${destinataire.id}`}
                      className="text-action underline-offset-2 hover:underline"
                    >
                      {destinataire.estGroupe ? sansMentionGroupe(destinataire.nom) : destinataire.nom}
                    </Link>
                    {destinataire.estGroupe && <span className="text-encre-3"> · {t("groupe")}</span>}
                    {destinataire.injoignable && (
                      <span className="ml-2 rounded-control bg-alerte-doux px-1.5 py-0.5 text-xs text-alerte">
                        {t("injoignable")}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {compte?.periode ? valeurs.montant(compte.periode.appele) : ""}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {compte?.periode ? valeurs.montant(compte.periode.paye) : ""}
                  </td>
                  <td className="px-4 py-3">
                    {compte?.periode ? (
                      <span className={tonStatut[compte.periode.statut]}>{t(`statut.${compte.periode.statut}`)}</span>
                    ) : (
                      <span className="text-encre-3">{t("horsPeriode")}</span>
                    )}
                  </td>
                  {/* Rouge si une part est échue ; encre si tout est encore à échoir. */}
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      (compte?.resteDuEchu ?? 0) > 0
                        ? "text-impaye"
                        : (compte?.resteDuTotal ?? 0) > 0
                          ? "text-encre"
                          : "text-encre-3"
                    }`}
                  >
                    {valeurs.montant(compte?.resteDuTotal ?? 0)}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {compte?.joursRetardMax != null ? t("joursRetard", { jours: compte.joursRetardMax }) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
