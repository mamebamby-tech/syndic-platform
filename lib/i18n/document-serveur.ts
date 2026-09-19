import "server-only";
import { chargerMessages } from "@/lib/i18n/messages";
import {
  VERSION_OPPOSABLE,
  type DocumentLocalise,
  type VersionDocument,
} from "@/lib/i18n/document";

// Charge les textes d'un document dans la langue de SA version. Sans
// argument : la version opposable, en français.
export async function chargerDocumentLocalise(
  version: VersionDocument = VERSION_OPPOSABLE,
): Promise<DocumentLocalise> {
  const messages = await chargerMessages(version.langue);
  return { version, messages: messages.Documents };
}
