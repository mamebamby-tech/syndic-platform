"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  enregistrerBudget,
  enregistrerEtGenererAppels,
  genererAppels,
} from "@/app/immeubles/[immeubleId]/budget/actions";
import { definirModificationsNonEnregistrees } from "@/lib/garde-sortie";

// Les champs du budget vivent dans la table (rendue côté serveur) et se rattachent
// au formulaire #budget-form par l'attribut `form`. Une modification = un champ dont
// la valeur diffère de sa valeur enregistrée (`defaultValue`).
const CHAMPS = 'input[form="budget-form"]';
const estUnChampDeSaisie = (champ: HTMLInputElement) =>
  champ.name.startsWith("montant:") || champ.name.startsWith("fournisseur:");

// Les trois boutons soumettent LE MÊME formulaire, chacun avec son action : la
// génération et l'enregistrement combiné lisent les mêmes champs.
export function BarreActionsBudget({ verrouille }: { verrouille: boolean }) {
  const t = useTranslations("Budget");
  const [modifie, setModifie] = useState(false);

  useEffect(() => {
    const recalculer = () => {
      const champs = Array.from(document.querySelectorAll<HTMLInputElement>(CHAMPS)).filter(estUnChampDeSaisie);
      setModifie(champs.some((champ) => champ.value !== champ.defaultValue));
    };
    recalculer();
    document.addEventListener("input", recalculer);
    return () => document.removeEventListener("input", recalculer);
  }, []);

  // Prévient l'utilisateur qui quitte la page avec des modifications non enregistrées.
  useEffect(() => {
    definirModificationsNonEnregistrees(modifie);
    if (!modifie) return;

    const avantFermeture = (evenement: BeforeUnloadEvent) => {
      evenement.preventDefault();
      evenement.returnValue = "";
    };
    // Capture : avant le routeur de Next, qui traiterait le clic sur un lien.
    const clicSurUnLien = (evenement: MouseEvent) => {
      const lien = (evenement.target as Element | null)?.closest?.("a[href]");
      if (!lien) return;
      const cible = lien.getAttribute("href") ?? "";
      if (cible.startsWith("#") || lien.getAttribute("target") === "_blank") return;
      if (!window.confirm(t("quitterSansEnregistrer"))) {
        evenement.preventDefault();
        evenement.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", avantFermeture);
    document.addEventListener("click", clicSurUnLien, true);
    return () => {
      definirModificationsNonEnregistrees(false);
      window.removeEventListener("beforeunload", avantFermeture);
      document.removeEventListener("click", clicSurUnLien, true);
    };
  }, [modifie, t]);

  const classeSecondaire =
    "h-11 rounded-control border border-action px-4 text-sm text-action-encre disabled:cursor-not-allowed disabled:opacity-50";
  const classePrincipale =
    "h-11 rounded-control bg-action px-4 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        form="budget-form"
        formAction={enregistrerBudget}
        disabled={verrouille || !modifie}
        className={classeSecondaire}
      >
        {t("enregistrer")}
      </button>

      <button
        type="submit"
        form="budget-form"
        formAction={genererAppels}
        disabled={modifie}
        aria-describedby={modifie ? "raison-generation" : undefined}
        className={classeSecondaire}
      >
        {t("genererAppels")}
      </button>

      <button
        type="submit"
        form="budget-form"
        formAction={enregistrerEtGenererAppels}
        disabled={verrouille}
        className={classePrincipale}
      >
        {t("enregistrerEtGenerer")}
      </button>

      {modifie && (
        <p id="raison-generation" role="status" className="w-full text-sm text-alerte">
          {t("modificationsNonEnregistrees")} {t("enregistrerAvantGenerer")}.
        </p>
      )}
    </div>
  );
}
