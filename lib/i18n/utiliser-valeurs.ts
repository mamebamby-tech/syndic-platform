import { useFormatter, useLocale } from "next-intl";
import { valeursDe } from "@/lib/i18n/valeurs";

// Composants (clients, ou serveur non asynchrones).
export function useValeurs() {
  return valeursDe(useFormatter(), useLocale());
}
