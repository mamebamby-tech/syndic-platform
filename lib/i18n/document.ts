import { createFormatter, createTranslator } from "next-intl";
import { formats, FUSEAU } from "@/i18n/formats";
import { LANGUE_OPPOSABLE, localeDe, type Langue } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { valeursDe } from "@/lib/i18n/valeurs";

// Documents juridiques — appel de cotisation, convocation, procès-verbal.
//
// Seule la version française est opposable. Elle est rendue en français
// QUELLE QUE SOIT la langue de la personne qui la consulte : un syndic qui
// travaille en anglais voit l'interface en anglais, mais le document qu'il
// prévisualise est celui qui sera envoyé, en français.
//
// Une version de courtoisie traduite est prévue mais NON générée. Son statut
// se DÉRIVE de la langue, il ne se règle pas : toute version qui n'est pas
// dans LANGUE_OPPOSABLE est non opposable, et le document affiche alors la
// mention `Documents.mentions.courtoisie`.
//
// Ce module est sûr côté navigateur (les composants de document s'y
// appuient) : il ne lit aucun fichier de messages. Le chargement des textes
// vit dans lib/i18n/document-serveur.ts.
export interface VersionDocument {
  langue: Langue;
  opposable: boolean;
}

export function versionDocument(langue: Langue): VersionDocument {
  return { langue, opposable: langue === LANGUE_OPPOSABLE };
}

export const VERSION_OPPOSABLE = versionDocument(LANGUE_OPPOSABLE);

// Ce que reçoit un composant de document : sa version et ses seuls textes.
// Le composant ne lit jamais la langue de la personne connectée.
export interface DocumentLocalise {
  version: VersionDocument;
  messages: Messages["Documents"];
}

// Traducteur et formateur d'un document, dans SA langue, indépendants du
// fournisseur de la personne connectée.
export function outilsDocument({ version, messages }: DocumentLocalise) {
  const t = createTranslator({
    locale: localeDe(version.langue),
    // Seul l'espace `Documents` est transmis au navigateur.
    messages: { Documents: messages } as unknown as Messages,
    formats,
    timeZone: FUSEAU,
    namespace: "Documents",
  });
  const locale = localeDe(version.langue);
  const format = createFormatter({ locale, formats, timeZone: FUSEAU });
  // Montants (FCFA) et dates (« 1er octobre 2026 ») dans la langue du DOCUMENT.
  return { t, format, valeurs: valeursDe(format, locale), version };
}
