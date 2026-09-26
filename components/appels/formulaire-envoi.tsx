"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { envoyerLesAppels, type EtatEnvoiAppels } from "@/app/immeubles/[immeubleId]/appels/actions";

// La validation du récapitulatif, puis l'envoi. Le navigateur ne décide de rien :
// le serveur recalcule le récapitulatif et applique le garde-fou.
export function FormulaireEnvoi({
  immeubleId,
  demonstration,
  partiront,
  dejaEnvoyes,
}: {
  immeubleId: string;
  demonstration: boolean;
  partiront: number;
  dejaEnvoyes: number;
}) {
  const t = useTranslations("Envoi");
  const [etat, envoyer, enCours] = useActionState<EtatEnvoiAppels, FormData>(envoyerLesAppels, { etat: "initial" });
  const [renvoyer, setRenvoyer] = useState(false);
  const total = partiront + (renvoyer ? dejaEnvoyes : 0);

  return (
    <form action={envoyer} className="mt-6 space-y-4 rounded-card border border-filet bg-surface p-4">
      <input type="hidden" name="immeubleId" value={immeubleId} />

      {demonstration && (
        <div className="rounded-control bg-alerte-doux p-3 text-alerte">
          <p className="text-sm font-medium">{t("demonstration.titre")}</p>
          <p className="mt-1 text-xs">{t("demonstration.consigne")}</p>
          <label htmlFor="redirection" className="mt-3 block text-sm text-encre">
            {t("demonstration.redirection")}
          </label>
          <input
            id="redirection"
            name="redirection"
            type="email"
            required
            autoComplete="email"
            className="mt-1 h-11 w-full rounded-control border border-filet bg-surface px-3 text-sm text-encre outline-none focus:border-action"
          />
        </div>
      )}

      <label className="flex items-start gap-3 text-sm text-encre">
        <input type="checkbox" name="recapitulatifValide" value="oui" required className="mt-1 h-5 w-5" />
        <span>{t("valider")}</span>
      </label>

      {dejaEnvoyes > 0 && (
        <label className="flex items-start gap-3 text-sm text-alerte">
          <input
            type="checkbox"
            name="renvoyerDejaEnvoyes"
            value="oui"
            checked={renvoyer}
            onChange={(e) => setRenvoyer(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span>{t("renvoyer", { nombre: dejaEnvoyes })}</span>
        </label>
      )}

      <p className="text-sm text-encre-2">{t("partira", { nombre: total })}</p>
      <button
        type="submit"
        disabled={enCours || total === 0}
        className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-surface disabled:opacity-60"
      >
        {t("envoyer")}
      </button>

      {etat.etat === "refuse" && (
        <p role="alert" className="rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
          {t(`refus.${etat.motif}`, { detail: etat.detail ?? "" })}
        </p>
      )}
      {etat.etat === "termine" && (
        <div role="status" className="rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
          <p className="font-medium">{t("bilan.titre")}</p>
          <p>{t("bilan.envoyes", { nombre: etat.bilan.envoyes.length })}</p>
          {etat.demonstration && etat.bilan.envoyes[0] && (
            <p>{t("bilan.redirige", { adresse: etat.bilan.envoyes[0].adresse })}</p>
          )}
          {etat.bilan.echecs.length > 0 && (
            <>
              <p className="mt-1 text-impaye">{t("bilan.echecs", { nombre: etat.bilan.echecs.length })}</p>
              <ul className="list-disc pl-5 text-impaye">
                {etat.bilan.echecs.map((e) => (
                  <li key={e.reference}>{`${e.nom} (${e.reference}) — ${e.erreur}`}</li>
                ))}
              </ul>
            </>
          )}
          {etat.bilan.nonServis.length > 0 && (
            <>
              <p className="mt-1">{t("bilan.nonServis", { nombre: etat.bilan.nonServis.length })}</p>
              <ul className="list-disc pl-5">
                {etat.bilan.nonServis.map((n) => (
                  <li key={n.reference}>{`${n.nom} (${n.reference}) — ${t(`bilan.motif.${n.motif}`)}`}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </form>
  );
}
