import { useFormatter, useTranslations } from "next-intl";
import type { Changement } from "@/lib/parametres/journal";

// Un champ modifié : « Banque : Ancienne → Nouvelle ». Les numéros (compte,
// marchands) arrivent déjà masqués ; on ne les réaffiche jamais en clair.
export function ChangementParametre({ changement }: { changement: Changement }) {
  const t = useTranslations("TableauDeBord");
  const tMoyen = useTranslations("MoyenPaiement");
  const format = useFormatter();

  const vide = t("vide");
  const liste = (moyens: string[]) =>
    moyens.length === 0
      ? t("aucun")
      : format.list(
          moyens.map((moyen) => tMoyen(moyen as "wave")),
          { type: "unit", style: "long" },
        );
  const marchands = (numeros: Record<string, string>) =>
    Object.keys(numeros).length === 0
      ? t("aucun")
      : Object.entries(numeros)
          .map(([moyen, numero]) => `${tMoyen(moyen as "wave")} : ${numero}`)
          .join(", ");

  let avant: string;
  let apres: string;
  switch (changement.nature) {
    case "texte":
    case "secret":
      avant = changement.avant ?? vide;
      apres = changement.apres ?? vide;
      break;
    case "moyens":
      avant = liste(changement.avant);
      apres = liste(changement.apres);
      break;
    case "marchands":
      avant = marchands(changement.avant);
      apres = marchands(changement.apres);
      break;
  }

  return (
    <li className="text-sm text-encre">
      <span className="text-encre-3">{t(`champs.${changement.champ}`)} : </span>
      <span className="tabular-nums">{t("avantApres", { avant, apres })}</span>
    </li>
  );
}
