import "server-only";
import { transportResend, type Transport } from "@/lib/courriel/transport";

// Le service d'envoi (décision 68) : Resend, à l'adresse technique du domaine
// d'envoi de la plateforme. Le NOM affiché n'est pas ici : c'est celui du
// cabinet, composé à chaque envoi (lib/courriel/expediteur.ts).
// Variables serveur : EMAIL_EXPEDITEUR (adresse seule, syndic@messages.coprane.com),
// EMAIL_CLE_API.

export interface ConfigurationCourriel {
  adresse: string;
  transport: Transport;
}

// null si le service n'est pas configuré : l'écran le dit, et rien ne part.
export function configurationCourriel(): ConfigurationCourriel | null {
  const adresse = process.env.EMAIL_EXPEDITEUR?.trim();
  const cle = process.env.EMAIL_CLE_API?.trim();
  if (!adresse || !cle) return null;
  return { adresse, transport: transportResend(cle) };
}
