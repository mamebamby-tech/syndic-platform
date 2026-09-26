// Garde-fou des envois de courriel (décision 70).
//
// Le jeu de démonstration (supabase/seed/seed.sql) n'utilise que des domaines
// RÉSERVÉS (RFC 2606 et RFC 6761) : ces boîtes n'existent pas. Leur écrire
// provoquerait des rejets, et les rejets abîment la réputation du domaine
// d'envoi. Deux verrous, indépendants :
//
//   1. l'AIGUILLAGE (destinationEffective) : en démonstration, tout message part
//      vers l'adresse de redirection saisie par l'utilisateur — jamais vers le
//      destinataire du jeu fictif — et cette adresse ne peut pas être fictive ;
//   2. le DERNIER POINT avant le service d'envoi (lib/courriel/transport.ts) :
//      toute adresse d'un domaine réservé est refusée, QUEL QUE SOIT le mode.
//      Même un aiguillage fautif ne peut donc rien faire partir vers le jeu.
//
// tests/courriel-garde-fou.test.ts échoue si une adresse du seed peut passer.

// example.com, example.org, example.net et leurs sous-domaines ; les domaines
// de premier niveau réservés .example, .test, .invalid, .localhost.
const DOMAINE_RESERVE = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:example|test|invalid|localhost))$/i;
const FORME = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class EnvoiInterdit extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvoiInterdit";
  }
}

export const estAdresseFictive = (adresse: string) => DOMAINE_RESERVE.test(adresse.trim());
export const estAdresseValide = (adresse: string) => FORME.test(adresse.trim());

// Une adresse réelle, pour recevoir les messages redirigés de la démonstration.
export function verifierRedirection(adresse: string | null | undefined): string {
  const propre = (adresse ?? "").trim();
  if (!propre) throw new EnvoiInterdit("En démonstration, une adresse de redirection est obligatoire.");
  if (!estAdresseValide(propre)) throw new EnvoiInterdit("L'adresse de redirection n'est pas une adresse électronique valide.");
  if (estAdresseFictive(propre)) {
    throw new EnvoiInterdit("L'adresse de redirection doit être une adresse réelle, pas une adresse du jeu fictif.");
  }
  return propre;
}

export interface Destination {
  // L'adresse vers laquelle le message part réellement.
  adresse: string;
  // Démonstration : l'adresse du destinataire fictif, affichée dans le message.
  adressePrevue: string | null;
}

export function destinationEffective(options: {
  demonstration: boolean;
  redirection: string | null | undefined;
  adresseDestinataire: string;
}): Destination {
  if (options.demonstration) {
    return { adresse: verifierRedirection(options.redirection), adressePrevue: options.adresseDestinataire };
  }
  if (estAdresseFictive(options.adresseDestinataire)) {
    throw new EnvoiInterdit(`Adresse du jeu fictif refusée : ${options.adresseDestinataire}`);
  }
  return { adresse: options.adresseDestinataire.trim(), adressePrevue: null };
}
