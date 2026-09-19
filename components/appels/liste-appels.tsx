"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { AppelDetail, ContexteDocument } from "@/lib/data/appels";
import { DocumentAppel } from "@/components/documents/document-appel";
import type { DocumentLocalise } from "@/lib/i18n/document";

export function ListeAppels({
  immeubleId,
  appels,
  contexte,
  document,
}: {
  immeubleId: string;
  appels: AppelDetail[];
  contexte: ContexteDocument;
  document: DocumentLocalise;
}) {
  const t = useTranslations("Appels");
  const tStatut = useTranslations("StatutAppel");
  const tAnomalie = useTranslations("AnomalieContact");
  const format = useFormatter();
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
      <p className="text-sm text-encre-2">{t("aucunAppel")}</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <input
          type="search"
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder={t("filtrer")}
          className="mb-3 h-11 w-full rounded-control border border-filet bg-surface px-3 text-sm text-encre outline-none focus:border-action"
        />

        <div className="overflow-hidden rounded-card border border-filet bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                <th className="px-4 py-3 font-medium">{t("colonnes.proprietaire")}</th>
                <th className="px-4 py-3 font-medium">{t("colonnes.statut")}</th>
                <th className="px-4 py-3 font-medium">{t("colonnes.envoi")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colonnes.montant")}</th>
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
                  <td className="px-4 py-3 text-encre-2">{tStatut(appel.statut)}</td>
                  <td className="px-4 py-3">
                    {appel.anomalies.length > 0 ? (
                      <span className="rounded-control bg-impaye-doux px-1.5 py-0.5 text-xs text-impaye">
                        {t("envoiBloque")}
                      </span>
                    ) : (
                      <span className="text-encre-3">{t("envoiPret")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-encre">
                    {format.number(appel.montantTotal, "xof")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        {appelSelectionne && appelSelectionne.anomalies.length > 0 && (
          // Avertissement de l'application, pas du document : il suit la
          // langue de la personne, alors que le document reste opposable.
          <p className="mb-4 rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
            {t("envoiBloqueDetail", {
              anomalies: format.list(
                appelSelectionne.anomalies.map((anomalie) => tAnomalie(anomalie)),
                { type: "unit", style: "long" },
              ),
            })}
          </p>
        )}
        {appelSelectionne && (
          <DocumentAppel document={document} contexte={contexte} appel={appelSelectionne} />
        )}
      </div>
    </div>
  );
}
