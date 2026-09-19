"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ImmeubleAvecOrganisation } from "@/lib/data/immeubles";
import { confirmerSortie } from "@/lib/garde-sortie";

export function SelecteurImmeuble({
  immeubles,
  immeubleActuelId,
}: {
  immeubles: ImmeubleAvecOrganisation[];
  immeubleActuelId: string;
}) {
  const t = useTranslations("Navigation");
  const tBudget = useTranslations("Budget");
  const router = useRouter();

  return (
    <div>
      <label htmlFor="selecteur-immeuble" className="sr-only">
        {t("immeuble")}
      </label>
      <select
        id="selecteur-immeuble"
        value={immeubleActuelId}
        onChange={(evenement) => {
          // Le sélecteur fait naviguer par router.push : ni beforeunload ni un clic
          // sur un lien ne le voient. Le select étant contrôlé, refuser laisse
          // l'immeuble affiché inchangé.
          if (!confirmerSortie(tBudget("quitterSansEnregistrer"))) return;
          router.push(`/immeubles/${evenement.target.value}`);
        }}
        className="h-11 w-full rounded-control border border-filet bg-surface px-3 text-sm font-medium text-encre outline-none focus:border-action"
      >
        {immeubles.map((immeuble) => (
          <option key={immeuble.id} value={immeuble.id}>
            {immeuble.nom}
            {immeuble.ville ? ` — ${immeuble.ville}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
