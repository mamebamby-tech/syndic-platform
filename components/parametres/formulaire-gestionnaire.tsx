"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  enregistrerGestionnaire,
  type EtatGestionnaire,
} from "@/app/immeubles/[immeubleId]/parametres/actions";

// L'interlocuteur des copropriétaires, imprimé sur chaque appel de fonds.
export function FormulaireGestionnaire({
  immeubleId,
  nom,
  email,
}: {
  immeubleId: string;
  nom: string;
  email: string;
}) {
  const t = useTranslations("Parametres.gestionnaire");
  const [etat, enregistrer, enCours] = useActionState<EtatGestionnaire, FormData>(enregistrerGestionnaire, {
    statut: "initial",
  });
  const champ =
    "mt-1 h-11 w-full rounded-control border border-filet bg-surface px-3 text-sm text-encre outline-none focus:border-action";

  return (
    <section aria-labelledby="gestionnaire" className="mt-8 rounded-card border border-filet bg-surface p-4">
      <h2 id="gestionnaire" className="font-serif text-lg text-marque">{t("titre")}</h2>
      <p className="mt-1 text-sm text-encre-2">{t("consigne")}</p>
      <form action={enregistrer} className="mt-3 space-y-3">
        <input type="hidden" name="immeubleId" value={immeubleId} />
        <div>
          <label htmlFor="gestionnaireNom" className="text-sm text-encre">{t("nom")}</label>
          <input id="gestionnaireNom" name="gestionnaireNom" defaultValue={nom} autoComplete="name" className={champ} />
        </div>
        <div>
          <label htmlFor="gestionnaireEmail" className="text-sm text-encre">{t("email")}</label>
          <input id="gestionnaireEmail" name="gestionnaireEmail" type="email" defaultValue={email} autoComplete="email" className={champ} />
        </div>
        <button
          type="submit"
          disabled={enCours}
          className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-surface disabled:opacity-60"
        >
          {t("enregistrer")}
        </button>
        {etat.statut === "enregistre" && <p role="status" className="text-sm text-action">{t("enregistre")}</p>}
        {etat.statut === "erreur" && <p role="alert" className="text-sm text-impaye">{t(`erreurs.${etat.erreur}`)}</p>}
      </form>
    </section>
  );
}
