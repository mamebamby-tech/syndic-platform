"use client";

import { useRouter } from "next/navigation";
import type { ImmeubleAvecOrganisation } from "@/lib/data/immeubles";

export function SelecteurImmeuble({
  immeubles,
  immeubleActuelId,
}: {
  immeubles: ImmeubleAvecOrganisation[];
  immeubleActuelId: string;
}) {
  const router = useRouter();

  return (
    <div>
      <label htmlFor="selecteur-immeuble" className="sr-only">
        Immeuble
      </label>
      <select
        id="selecteur-immeuble"
        value={immeubleActuelId}
        onChange={(evenement) => {
          router.push(`/immeubles/${evenement.target.value}/lots`);
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
