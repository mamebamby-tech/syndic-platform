"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { CleRepartitionOption } from "@/lib/data/budget";
import { changerCleRepartition } from "@/app/immeubles/[immeubleId]/budget/actions";

export function SelecteurCle({
  immeubleId,
  posteId,
  cleActuelleId,
  options,
}: {
  immeubleId: string;
  posteId: string;
  cleActuelleId: string;
  options: CleRepartitionOption[];
}) {
  const t = useTranslations("Budget.colonnes");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={changerCleRepartition}>
      <input type="hidden" name="immeubleId" value={immeubleId} />
      <input type="hidden" name="posteId" value={posteId} />
      <label className="sr-only" htmlFor={`cle-${posteId}`}>
        {t("cleRepartition")}
      </label>
      <select
        id={`cle-${posteId}`}
        name="cleRepartitionId"
        defaultValue={cleActuelleId}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-9 rounded-control border border-filet bg-surface px-2 text-sm text-encre outline-none focus:border-action"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.libelle}
          </option>
        ))}
      </select>
    </form>
  );
}
