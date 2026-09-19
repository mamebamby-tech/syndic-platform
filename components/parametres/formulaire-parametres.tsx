"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { enregistrerParametres } from "@/app/immeubles/[immeubleId]/parametres/actions";
import { ETAT_INITIAL } from "@/lib/parametres/etat";
import {
  JETONS_REFERENCE,
  formatReferenceValide,
  codeReferenceValide,
  rendreReference,
} from "@/lib/parametres/reference";
import {
  MOYENS_AVEC_NUMERO_MARCHAND,
  MOYENS_OFFERTS,
  type CodeErreur,
} from "@/lib/parametres/validation";
import type { ParametresImmeuble } from "@/lib/data/parametres-immeuble";

const CLASSE_CHAMP =
  "h-11 w-full rounded-control border border-filet bg-surface px-3 text-encre outline-none focus:border-action";

// Exemple de référence montré en direct : calculé sur le serveur (année et
// code de période du moment) pour ne pas différer entre serveur et navigateur.
export interface ExempleReference {
  annee: number;
  periode: string;
}

function Erreur({ code }: { code: CodeErreur | undefined }) {
  const t = useTranslations("Parametres.erreurs");
  if (!code) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-impaye">
      {t(code)}
    </p>
  );
}

export function FormulaireParametres({
  parametres,
  exemple,
  dateDerniereModification,
  enAttenteExiste,
}: {
  parametres: ParametresImmeuble;
  // null quand aucun règlement en vigueur ne donne la périodicité.
  exemple: ExempleReference | null;
  // Déjà mise en mots par le serveur (« 1er octobre 2026 ») ; null si jamais renseignées.
  dateDerniereModification: string | null;
  // Une modification des coordonnées attend déjà confirmation : en proposer une autre la remplace.
  enAttenteExiste: boolean;
}) {
  const t = useTranslations("Parametres");
  const tMoyen = useTranslations("MoyenPaiement");
  const [etat, action, enCours] = useActionState(enregistrerParametres, ETAT_INITIAL);

  const [moyens, setMoyens] = useState<string[]>(parametres.moyens);
  const [code, setCode] = useState(parametres.codeReference);
  const [format, setFormat] = useState(parametres.formatReference);
  const [titulaire, setTitulaire] = useState(parametres.titulaire);
  const [banque, setBanque] = useState(parametres.banque);
  const [numero, setNumero] = useState(parametres.numero);

  const bascule = (moyen: string) =>
    setMoyens((actuels) =>
      actuels.includes(moyen) ? actuels.filter((m) => m !== moyen) : [...actuels, moyen],
    );

  const remplis = [titulaire, banque, numero].filter((v) => v.trim().length > 0).length;
  const compteIncomplet = remplis > 0 && remplis < 3;

  const exempleValide =
    exemple !== null && codeReferenceValide(code.toUpperCase()) && formatReferenceValide(format);
  const exempleReference = exempleValide && exemple
    ? rendreReference(format, {
        code: code.toUpperCase(),
        annee: exemple.annee,
        periode: exemple.periode,
        seq: 7,
      })
    : null;

  const erreurBic = etat.erreurs.bic;
  const erreurMoyens = etat.erreurs.moyens;
  const erreurCode = etat.erreurs.codeReference;
  const erreurFormat = etat.erreurs.formatReference;

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="immeubleId" value={parametres.immeubleId} />

      <p className="text-sm text-encre-2">
        {dateDerniereModification
          ? t("derniereModification", { date: dateDerniereModification })
          : t("jamaisRenseignees")}
      </p>

      <fieldset className="space-y-4 rounded-card border border-filet bg-surface p-6">
        <legend className="px-1 font-serif text-lg text-marque">{t("compte.titre")}</legend>

        <div>
          <label htmlFor="titulaire" className="mb-1 block text-sm text-encre-2">
            {t("compte.titulaire")}
          </label>
          <input
            id="titulaire"
            name="titulaire"
            value={titulaire}
            onChange={(e) => setTitulaire(e.target.value)}
            autoComplete="off"
            className={CLASSE_CHAMP}
          />
        </div>
        <div>
          <label htmlFor="banque" className="mb-1 block text-sm text-encre-2">
            {t("compte.banque")}
          </label>
          <input
            id="banque"
            name="banque"
            value={banque}
            onChange={(e) => setBanque(e.target.value)}
            autoComplete="off"
            className={CLASSE_CHAMP}
          />
        </div>
        <div>
          <label htmlFor="numero" className="mb-1 block text-sm text-encre-2">
            {t("compte.numero")}
          </label>
          <input
            id="numero"
            name="numero"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${CLASSE_CHAMP} tabular-nums`}
          />
        </div>
        <div>
          <label htmlFor="bic" className="mb-1 block text-sm text-encre-2">
            {t("compte.swift")}
          </label>
          <input
            id="bic"
            name="bic"
            defaultValue={parametres.bic}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="bic-aide"
            className={`${CLASSE_CHAMP} uppercase tabular-nums`}
          />
          <p id="bic-aide" className="mt-1 text-xs text-encre-3">
            {t("compte.swiftAide")}
          </p>
          <Erreur code={erreurBic} />
        </div>

        {compteIncomplet && (
          <p className="rounded-control bg-alerte-doux px-3 py-2 text-sm text-alerte">
            {t("compte.incomplet")}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-card border border-filet bg-surface p-6">
        <legend className="px-1 font-serif text-lg text-marque">{t("moyens.titre")}</legend>
        <p className="text-sm text-encre-2">{t("moyens.aide")}</p>

        {MOYENS_OFFERTS.map((moyen) => {
          const coche = moyens.includes(moyen);
          const marchand = (MOYENS_AVEC_NUMERO_MARCHAND as readonly string[]).includes(moyen);
          return (
            <div key={moyen} className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex min-h-11 items-center gap-2 text-encre">
                <input
                  type="checkbox"
                  name="moyens"
                  value={moyen}
                  checked={coche}
                  onChange={() => bascule(moyen)}
                  className="h-5 w-5 accent-action"
                />
                {tMoyen(moyen)}
              </label>
              {marchand && coche && (
                <div className="flex items-center gap-2">
                  <label htmlFor={`marchand_${moyen}`} className="text-sm text-encre-2">
                    {t("moyens.numeroMarchand")}
                  </label>
                  <input
                    id={`marchand_${moyen}`}
                    name={`marchand_${moyen}`}
                    defaultValue={parametres.marchands[moyen] ?? ""}
                    autoComplete="off"
                    inputMode="tel"
                    className="h-11 w-48 rounded-control border border-filet bg-surface px-3 tabular-nums text-encre outline-none focus:border-action"
                  />
                  <span className="text-xs text-encre-3">{t("moyens.numeroMarchandAide")}</span>
                </div>
              )}
            </div>
          );
        })}
        <Erreur code={erreurMoyens} />
      </fieldset>

      <fieldset className="space-y-4 rounded-card border border-filet bg-surface p-6">
        <legend className="px-1 font-serif text-lg text-marque">{t("reference.titre")}</legend>

        <div>
          <label htmlFor="codeReference" className="mb-1 block text-sm text-encre-2">
            {t("reference.code")}
          </label>
          <input
            id="codeReference"
            name="codeReference"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="code-aide"
            className={`${CLASSE_CHAMP} w-40 uppercase tabular-nums`}
          />
          <p id="code-aide" className="mt-1 text-xs text-encre-3">
            {t("reference.codeAide")}
          </p>
          <Erreur code={erreurCode} />
        </div>

        <div>
          <label htmlFor="formatReference" className="mb-1 block text-sm text-encre-2">
            {t("reference.format")}
          </label>
          <input
            id="formatReference"
            name="formatReference"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="format-aide"
            className={`${CLASSE_CHAMP} tabular-nums`}
          />
          <p id="format-aide" className="mt-1 text-xs text-encre-3">
            {t("reference.formatAide", {
              jetons: JETONS_REFERENCE.map((jeton) => `{${jeton}}`).join(" "),
            })}
          </p>
          <Erreur code={erreurFormat} />
        </div>

        {exempleReference && (
          <p className="text-sm text-encre-2">
            {t("reference.exemple", { exemple: exempleReference })}
          </p>
        )}
        <p className="text-xs text-encre-3">{t("reference.portee")}</p>
      </fieldset>

      {etat.erreurs.general && (
        <p role="alert" className="rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
          <Erreur code={etat.erreurs.general} />
        </p>
      )}
      {enAttenteExiste && etat.statut !== "en_attente" && (
        <p className="text-sm text-alerte">{t("remplaceraLaDemande")}</p>
      )}
      {etat.statut === "en_attente" && (
        <p role="status" className="rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
          {t("enregistreEnAttente")}
        </p>
      )}
      {etat.statut === "ok" && (
        <p role="status" className="rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
          {t("enregistre")}
        </p>
      )}

      <button
        type="submit"
        disabled={enCours}
        className="h-11 rounded-control bg-action px-4 text-sm text-white disabled:opacity-50"
      >
        {enCours ? t("enregistrement") : t("enregistrer")}
      </button>
    </form>
  );
}
