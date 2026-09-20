"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { enregistrerPaiement } from "@/app/immeubles/[immeubleId]/proprietaires/[proprietaireId]/actions";
import { useValeurs } from "@/lib/i18n/utiliser-valeurs";
import { ETAT_PAIEMENT_INITIAL, MOYENS_SAISIE, type CodeErreurPaiement } from "@/lib/paiements/validation";
import type { AppelPayable } from "@/lib/releve/calcul";

const CLASSE_CHAMP =
  "h-11 w-full rounded-control border border-filet bg-surface px-3 text-encre outline-none focus:border-action";

function Erreur({ code }: { code: CodeErreurPaiement | undefined }) {
  const t = useTranslations("Paiements.erreurs");
  if (!code) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-impaye">
      {t(code)}
    </p>
  );
}

export function FormulaireEnregistrementPaiement({
  immeubleId,
  proprietaireId,
  appels,
  aujourdhui,
}: {
  immeubleId: string;
  proprietaireId: string;
  appels: AppelPayable[];
  // AAAA-MM-JJ, calculée sur le serveur : pas de différence serveur / navigateur.
  aujourdhui: string;
}) {
  const t = useTranslations("Paiements");
  const tMoyen = useTranslations("MoyenPaiement");
  const tErreur = useTranslations("Paiements.erreurs");
  const valeurs = useValeurs();
  const [etat, action, enCours] = useActionState(enregistrerPaiement, ETAT_PAIEMENT_INITIAL);

  if (appels.length === 0) {
    return <p className="text-sm text-encre-2">{t("aucunAppelPayable")}</p>;
  }

  return (
    // La clé remet le formulaire à zéro après un enregistrement réussi.
    <form key={etat.statut === "ok" ? "ok" : "saisie"} action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="immeubleId" value={immeubleId} />
      <input type="hidden" name="proprietaireId" value={proprietaireId} />

      <div className="sm:col-span-2">
        <label htmlFor="paiement-appel" className="mb-1 block text-sm text-encre-2">
          {t("appel")}
        </label>
        <select id="paiement-appel" name="appelId" required className={CLASSE_CHAMP} defaultValue={appels[0]?.id}>
          {appels.map((appel) => (
            <option key={appel.id} value={appel.id}>
              {t("optionAppel", { reference: appel.reference, reste: valeurs.montant(appel.resteDu) })}
            </option>
          ))}
        </select>
        <Erreur code={etat.erreurs.appel} />
      </div>

      <div>
        <label htmlFor="paiement-montant" className="mb-1 block text-sm text-encre-2">
          {t("montant")}
        </label>
        <input
          id="paiement-montant"
          name="montant"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          className={`${CLASSE_CHAMP} tabular-nums`}
        />
        <p className="mt-1 text-xs text-encre-3">{t("montantAide")}</p>
        <Erreur code={etat.erreurs.montant} />
      </div>

      <div>
        <label htmlFor="paiement-moyen" className="mb-1 block text-sm text-encre-2">
          {t("moyen")}
        </label>
        <select id="paiement-moyen" name="moyen" required className={CLASSE_CHAMP} defaultValue="virement">
          {MOYENS_SAISIE.map((moyen) => (
            <option key={moyen} value={moyen}>
              {tMoyen(moyen)}
            </option>
          ))}
        </select>
        <Erreur code={etat.erreurs.moyen} />
      </div>

      <div>
        <label htmlFor="paiement-date" className="mb-1 block text-sm text-encre-2">
          {t("date")}
        </label>
        <input
          id="paiement-date"
          name="date"
          type="date"
          required
          max={aujourdhui}
          defaultValue={aujourdhui}
          className={CLASSE_CHAMP}
        />
        <Erreur code={etat.erreurs.date} />
      </div>

      <div>
        <label htmlFor="paiement-reference" className="mb-1 block text-sm text-encre-2">
          {t("reference")}
        </label>
        <input
          id="paiement-reference"
          name="reference"
          type="text"
          autoComplete="off"
          maxLength={120}
          className={CLASSE_CHAMP}
        />
        <p className="mt-1 text-xs text-encre-3">{t("referenceAide")}</p>
        <Erreur code={etat.erreurs.reference} />
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={enCours}
          className="h-11 rounded-control bg-action px-5 text-sm text-white disabled:opacity-60"
        >
          {t("enregistrer")}
        </button>
        {etat.statut === "ok" && (
          <p role="status" className="text-sm text-encre-2">
            {t("enregistre")}
          </p>
        )}
        {etat.erreurs.general && (
          <p role="alert" className="text-sm text-impaye">
            {tErreur(etat.erreurs.general)}
          </p>
        )}
      </div>
    </form>
  );
}
