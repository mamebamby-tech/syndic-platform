"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  emettreBrouillons,
  engendrerPdfManquants,
  type ResultatEmission,
} from "@/app/immeubles/[immeubleId]/appels/actions";

// Émettre (définitif : confirmation en deux temps), engendrer les PDF manquants,
// préparer l'envoi. Réservé aux habilités : un lecteur ne reçoit pas ce composant.
export function ActionsAppels({
  immeubleId,
  brouillons,
  sansPdf,
  emis,
}: {
  immeubleId: string;
  // Brouillons émissibles (non obsolètes).
  brouillons: number;
  sansPdf: number;
  emis: number;
}) {
  const t = useTranslations("Appels.actions");
  const [confirmation, setConfirmation] = useState(false);
  const [resultat, setResultat] = useState<ResultatEmission | null>(null);
  const [enCours, demarrer] = useTransition();

  const executer = (action: () => Promise<ResultatEmission>) =>
    demarrer(async () => {
      setResultat(await action());
      setConfirmation(false);
    });

  const bouton =
    "inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium disabled:opacity-60";

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        {brouillons > 0 && !confirmation && (
          <button type="button" className={`${bouton} bg-action text-surface`} onClick={() => setConfirmation(true)}>
            {t("emettre", { nombre: brouillons })}
          </button>
        )}
        {sansPdf > 0 && (
          <button
            type="button"
            disabled={enCours}
            className={`${bouton} border border-filet bg-surface text-encre`}
            onClick={() => executer(() => engendrerPdfManquants(immeubleId))}
          >
            {enCours ? t("enCours") : t("pdfManquants", { nombre: sansPdf })}
          </button>
        )}
        {emis > 0 && (
          <Link href={`/immeubles/${immeubleId}/appels/envoi`} className={`${bouton} border border-action text-action`}>
            {t("preparerEnvoi")}
          </Link>
        )}
      </div>
      {sansPdf > 0 && <p className="text-xs text-encre-3">{t("pdfManquantsConsigne")}</p>}

      {confirmation && (
        <div role="alertdialog" className="rounded-card border border-alerte-doux bg-alerte-doux p-4 text-alerte">
          <p className="text-sm">{t("emettreConsigne")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={enCours}
              className={`${bouton} bg-action text-surface`}
              onClick={() => executer(() => emettreBrouillons(immeubleId))}
            >
              {enCours ? t("enCours") : t("confirmerEmission")}
            </button>
            <button type="button" className={`${bouton} text-encre-2`} onClick={() => setConfirmation(false)}>
              {t("annuler")}
            </button>
          </div>
        </div>
      )}

      {resultat && (
        <div role="status" className="rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
          <p>{t("resultatEmission", { emis: resultat.emis, pdf: resultat.pdf })}</p>
          {resultat.erreurs.length > 0 && (
            <>
              <p className="mt-1 text-impaye">{t("erreurs", { nombre: resultat.erreurs.length })}</p>
              <ul className="list-disc pl-5 text-impaye">
                {resultat.erreurs.map((e, k) => (
                  <li key={k}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
