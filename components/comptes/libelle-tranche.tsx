import { useTranslations } from "next-intl";
import { useLibelleTranche } from "@/components/tableau-de-bord/pilotage";
import type { TrancheAnciennete } from "@/lib/recouvrement/calcul";

// « 61 à 90 jours », ou « Reste dû : 61 à 90 jours » pour nommer un filtre.
export function LibelleTranche({ tranche, prefixe = false }: { tranche: TrancheAnciennete; prefixe?: boolean }) {
  const t = useTranslations("Comptes");
  const libelle = useLibelleTranche()(tranche);
  return <>{prefixe ? t("filtre.anciennete", { tranche: libelle }) : libelle}</>;
}
