"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AppelDetail, ContexteDocument } from "@/lib/data/appels";
import { formaterXof } from "@/lib/format";
import { DocumentAppel } from "@/components/documents/document-appel";

const LIBELLES_STATUT: Record<AppelDetail["statut"], string> = {
  brouillon: "Brouillon",
  emis: "Émis",
  partiel: "Partiel",
  solde: "Soldé",
  annule: "Annulé",
};

export function ListeAppels({
  immeubleId,
  appels,
  contexte,
}: {
  immeubleId: string;
  appels: AppelDetail[];
  contexte: ContexteDocument;
}) {
  const [recherche, setRecherche] = useState("");
  const [appelSelectionneId, setAppelSelectionneId] = useState(appels[0]?.id ?? null);

  const appelsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return appels;
    return appels.filter((appel) => appel.proprietaireNom.toLowerCase().includes(terme));
  }, [appels, recherche]);

  const appelSelectionne =
    appels.find((appel) => appel.id === appelSelectionneId) ?? appelsFiltres[0] ?? null;

  if (appels.length === 0) {
    return (
      <p className="text-sm text-encre-2">
        Aucun appel généré pour cette période. Chiffre le budget puis lance la
        génération depuis l&apos;écran Budget.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <input
          type="search"
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder="Filtrer par nom de propriétaire…"
          className="mb-3 h-11 w-full rounded-control border border-filet bg-surface px-3 text-sm text-encre outline-none focus:border-action"
        />

        <div className="overflow-hidden rounded-card border border-filet bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                <th className="px-4 py-3 font-medium">Propriétaire</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Envoi</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              {appelsFiltres.map((appel) => (
                <tr
                  key={appel.id}
                  onClick={() => setAppelSelectionneId(appel.id)}
                  aria-current={appel.id === appelSelectionne?.id}
                  className={`cursor-pointer border-b border-filet transition-colors last:border-0 ${
                    appel.id === appelSelectionne?.id ? "bg-action-doux" : "hover:bg-fond"
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/immeubles/${immeubleId}/proprietaires/${appel.proprietaireId}`}
                      onClick={(evenement) => evenement.stopPropagation()}
                      className="text-action underline-offset-2 hover:underline"
                    >
                      {appel.proprietaireNom}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-encre-2">{LIBELLES_STATUT[appel.statut]}</td>
                  <td className="px-4 py-3">
                    {appel.anomalies.length > 0 ? (
                      <span className="rounded-control bg-impaye-doux px-1.5 py-0.5 text-xs text-impaye">
                        bloqué
                      </span>
                    ) : (
                      <span className="text-encre-3">prêt</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre">
                    {formaterXof(appel.montantTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>{appelSelectionne && <DocumentAppel contexte={contexte} appel={appelSelectionne} />}</div>
    </div>
  );
}
