import { listerRegistreLots, type DetenteurLot } from "@/lib/data/lots";

function formaterSuperficie(valeur: number | null) {
  if (valeur === null) return "—";
  return `${valeur.toLocaleString("fr-FR")} m²`;
}

function formaterQuotePart(tantiemes: number, total: number) {
  if (total === 0) return "—";
  return `${((tantiemes / total) * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

const LIBELLES_NATURE: Record<DetenteurLot["nature"], string> = {
  pleine_propriete: "pleine propriété",
  nue_propriete: "nue-propriété",
  usufruit: "usufruit",
  indivision: "indivision",
};

function DetenteursCellule({ detenteurs }: { detenteurs: DetenteurLot[] }) {
  if (detenteurs.length === 0) {
    return <span className="text-encre-3">Aucun détenteur actif</span>;
  }

  return (
    <ul className="space-y-1">
      {detenteurs.map((detenteur) => (
        <li key={detenteur.proprietaireId}>
          <span className="text-encre">{detenteur.nom}</span>
          {detenteur.groupeNom && (
            <span className="text-encre-3"> · groupe {detenteur.groupeNom}</span>
          )}
          {detenteur.nature !== "pleine_propriete" && (
            <span className="ml-1 rounded-control bg-alerte-doux px-1.5 py-0.5 text-xs text-alerte">
              {LIBELLES_NATURE[detenteur.nature]}
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

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">Registre des lots</h1>
        <p className="mt-1 text-sm text-encre-2">
          {lots.length} lots · {totalTantiemes.toLocaleString("fr-FR")} tantièmes
        </p>
      </header>

      <div className="overflow-x-auto rounded-card border border-filet bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="px-4 py-3 font-medium">Lot</th>
              <th className="px-4 py-3 font-medium">Désignation</th>
              <th className="px-4 py-3 font-medium">Niveau</th>
              <th className="px-4 py-3 text-right font-medium">Superficie</th>
              <th className="px-4 py-3 text-right font-medium">Tantièmes</th>
              <th className="px-4 py-3 text-right font-medium">Quote-part</th>
              <th className="px-4 py-3 font-medium">Détenteur(s)</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id} className="border-b border-filet last:border-0">
                <td className="px-4 py-3 tabular-nums text-encre">{lot.numero}</td>
                <td className="px-4 py-3 text-encre">{lot.designation}</td>
                <td className="px-4 py-3 text-encre-2">{lot.niveau ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                  {formaterSuperficie(lot.superficieM2)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-encre">
                  {lot.tantiemes.toLocaleString("fr-FR")}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-encre-2">
                  {formaterQuotePart(lot.tantiemes, totalTantiemes)}
                </td>
                <td className="px-4 py-3">
                  <DetenteursCellule detenteurs={lot.detenteurs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
