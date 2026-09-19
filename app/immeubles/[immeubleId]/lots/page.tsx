import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { listerRegistreLots, type DetenteurLot } from "@/lib/data/lots";

function DetenteursCellule({
  detenteurs,
  immeubleId,
}: {
  detenteurs: DetenteurLot[];
  immeubleId: string;
}) {
  const t = useTranslations("Lots");
  const tNature = useTranslations("NatureDetention");

  if (detenteurs.length === 0) {
    return <span className="text-encre-3">{t("aucunDetenteur")}</span>;
  }

  return (
    <ul className="space-y-1">
      {detenteurs.map((detenteur) => (
        <li key={detenteur.proprietaireId}>
          <Link
            href={`/immeubles/${immeubleId}/proprietaires/${detenteur.proprietaireId}`}
            className="text-action underline-offset-2 hover:underline"
          >
            {detenteur.nom}
          </Link>
          {detenteur.groupeNom && (
            <span className="text-encre-3"> · {t("groupe", { nom: detenteur.groupeNom })}</span>
          )}
          {detenteur.nature !== "pleine_propriete" && (
            <span className="ml-1 rounded-control bg-alerte-doux px-1.5 py-0.5 text-xs text-alerte">
              {tNature(detenteur.nature)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function PageRegistreLots({
  params,
}: {
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;
  const { lots, totalTantiemes } = await listerRegistreLots(immeubleId);
  const t = await getTranslations("Lots");
  const format = await getFormatter();
  const nonRenseigne = (await getTranslations("Commun"))("nonRenseigne");

  const formaterSuperficie = (valeur: number | null) =>
    valeur === null ? nonRenseigne : t("superficie", { valeur: format.number(valeur) });
  const formaterQuotePart = (tantiemes: number) =>
    totalTantiemes === 0
      ? nonRenseigne
      : format.number(tantiemes / totalTantiemes, "pourcentage");

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-1 text-sm text-encre-2">
          {t("resume", { nombreLots: lots.length, tantiemes: totalTantiemes })}
        </p>
      </header>

      <div className="overflow-x-auto rounded-card border border-filet bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="px-4 py-3 font-medium">{t("colonnes.lot")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.designation")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.niveau")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("colonnes.superficie")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("colonnes.tantiemes")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("colonnes.quotePart")}</th>
              <th className="px-4 py-3 font-medium">{t("colonnes.detenteurs")}</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id} className="border-b border-filet last:border-0">
                <td className="px-4 py-3 tabular-nums text-encre">{lot.numero}</td>
                <td className="px-4 py-3 text-encre">{lot.designation}</td>
                <td className="px-4 py-3 text-encre-2">{lot.niveau ?? nonRenseigne}</td>
                <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                  {formaterSuperficie(lot.superficieM2)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-encre">
                  {format.number(lot.tantiemes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                  {formaterQuotePart(lot.tantiemes)}
                </td>
                <td className="px-4 py-3">
                  <DetenteursCellule detenteurs={lot.detenteurs} immeubleId={immeubleId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
