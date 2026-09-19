import { getFormatter, getLocale } from "next-intl/server";
import { valeursDe } from "@/lib/i18n/valeurs";

// Pages et composants serveur asynchrones.
export async function getValeurs() {
  return valeursDe(await getFormatter(), await getLocale());
}
