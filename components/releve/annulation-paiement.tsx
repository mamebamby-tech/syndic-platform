"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { annulerPaiement } from "@/app/immeubles/[immeubleId]/proprietaires/[proprietaireId]/actions";
import { ETAT_PAIEMENT_INITIAL } from "@/lib/paiements/validation";

export function AnnulationPaiement({
  immeubleId,
  proprietaireId,
  paiementId,
}: {
  immeubleId: string;
  proprietaireId: string;
  paiementId: string;
}) {
  const t = useTranslations("Paiements.annulation");
  const tErreur = useTranslations("Paiements.erreurs");
  const [ouvert, setOuvert] = useState(false);
  const [etat, action, enCours] = useActionState(annulerPaiement, ETAT_PAIEMENT_INITIAL);

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} className="text-sm text-action underline">
        {t("ouvrir")}
      </button>
    );
  }

  const codeErreur = etat.erreurs.motif ?? etat.erreurs.paiement ?? etat.erreurs.general;
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="immeubleId" value={immeubleId} />
      <input type="hidden" name="proprietaireId" value={proprietaireId} />
      <input type="hidden" name="paiementId" value={paiementId} />
      <label htmlFor={`motif-${paiementId}`} className="text-sm text-encre-2">
        {t("motif")}
      </label>
      <input
        id={`motif-${paiementId}`}
        name="motif"
        type="text"
        required
        maxLength={500}
        autoComplete="off"
        className="h-11 w-full rounded-control border border-filet bg-surface px-3 text-encre outline-none focus:border-action"
      />
      {codeErreur && (
        <p role="alert" className="text-sm text-impaye">
          {tErreur(codeErreur)}
        </p>
      )}
      <p className="text-xs text-encre-3">{t("explication")}</p>
      <div className="flex gap-3">
        <button type="submit" disabled={enCours} className="h-11 rounded-control bg-impaye px-4 text-sm text-white disabled:opacity-60">
          {t("confirmer")}
        </button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-encre-2 underline">
          {t("renoncer")}
        </button>
      </div>
    </form>
  );
}
