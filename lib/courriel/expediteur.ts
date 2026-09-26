import { nom as nomProduit } from "@/lib/marque";

// L'expéditeur affiché (décision 68) : le NOM DU CABINET, pris dans
// `organisations.nom` au moment de l'envoi — Coprane seulement si le nom manque.
// L'adresse technique est celle du domaine d'envoi de la plateforme
// (EMAIL_EXPEDITEUR, syndic@messages.coprane.com) : les messageries affichent
// d'elles-mêmes le domaine d'envoi, ce qui est honnête et attendu.
//
// Le nom vient de la base : il est nettoyé (aucun retour à la ligne, qui
// permettrait d'injecter un en-tête) et mis entre guillemets (RFC 5322 : une
// virgule ou un point dans un nom affiché doit l'être).
export function formaterExpediteur(nomCabinet: string | null | undefined, adresse: string): string {
  const propre = (nomCabinet ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const affiche = (propre || nomProduit).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${affiche}" <${adresse.trim()}>`;
}
