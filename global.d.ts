import type { formats } from "@/i18n/formats";
import type { Locale } from "@/lib/i18n/config";
import type fr from "./messages/fr.json";

// Le français est la référence de typage : une clé inconnue, ou un format
// nommé inexistant, fait échouer `npm run typecheck`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof fr;
    Formats: typeof formats;
  }
}
