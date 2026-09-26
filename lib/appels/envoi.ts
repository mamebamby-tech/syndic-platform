import { canauxDisponibles, etatEnvoi, type EtatEnvoi } from "@/lib/data/anomalie-contact";
import type { InstantaneAppel } from "@/lib/appels/instantane";
import { destinationEffective, EnvoiInterdit, verifierRedirection, type Destination } from "@/lib/courriel/garde-fou";
import { composerCourrielAppel } from "@/lib/courriel/message-appel";
import { envoyerCourriel, type ResultatEnvoi, type Transport } from "@/lib/courriel/transport";

// L'envoi des appels émis par courriel (décision 70). WhatsApp est hors
// périmètre : un destinataire joignable par WhatsApp seulement est nommé au
// récapitulatif, pas servi.
//
// Deux temps, jamais confondus :
//   1. le RÉCAPITULATIF, obligatoire : chaque destinataire, son état, le décompte
//      par état, les injoignables nommés, les appels déjà envoyés ;
//   2. l'ENVOI, seulement après validation du récapitulatif par le gestionnaire.
// Sans dépendance à la base : les accès (PDF, trace, service d'envoi) sont
// passés en paramètres, pour être testés (tests/envoi-appels.test.ts).

export interface AppelAEnvoyer {
  appelId: string;
  reference: string;
  destinataireId: string;
  destinataireNom: string;
  email: string | null;
  telephone: string | null;
  langue: string | null;
  // Date du dernier envoi réussi (journal), null si jamais envoyé.
  dernierEnvoiLe: string | null;
}

export interface LigneRecapitulatif extends AppelAEnvoyer {
  etat: EtatEnvoi;
  // Le courriel est un canal disponible : l'appel partira par ce message.
  parCourriel: boolean;
}

export interface Recapitulatif {
  lignes: LigneRecapitulatif[];
  decompte: Record<EtatEnvoi, number>;
  // Nommés, pas comptés.
  injoignables: string[];
  whatsappSeulement: string[];
  dejaEnvoyes: number;
}

export function recapituler(appels: AppelAEnvoyer[]): Recapitulatif {
  const lignes = appels
    .map((a) => {
      const contact = { email: a.email, telephone: a.telephone };
      return { ...a, etat: etatEnvoi(contact), parCourriel: canauxDisponibles(contact).courriel };
    })
    .sort((a, b) => a.destinataireNom.localeCompare(b.destinataireNom));
  const decompte: Record<EtatEnvoi, number> = { pret: 0, courriel_seulement: 0, whatsapp_seulement: 0, injoignable: 0 };
  for (const l of lignes) decompte[l.etat] += 1;
  return {
    lignes,
    decompte,
    injoignables: lignes.filter((l) => l.etat === "injoignable").map((l) => l.destinataireNom),
    whatsappSeulement: lignes.filter((l) => l.etat === "whatsapp_seulement").map((l) => l.destinataireNom),
    dejaEnvoyes: lignes.filter((l) => l.dernierEnvoiLe !== null).length,
  };
}

export interface DemandeEnvoi {
  // Le gestionnaire a validé le récapitulatif : sans cela, rien ne part.
  recapitulatifValide: boolean;
  // Confirmation explicite pour renvoyer un appel déjà envoyé.
  renvoyerDejaEnvoyes: boolean;
  demonstration: boolean;
  redirection: string | null;
  expediteur: string;
  adresseCabinet: string | null;
}

export interface Acces {
  instantane(appelId: string): Promise<InstantaneAppel>;
  pdf(appelId: string): Promise<Uint8Array>;
  tracer(trace: {
    appelId: string;
    adresse: string;
    adressePrevue: string | null;
    resultat: ResultatEnvoi;
  }): Promise<void>;
  transport: Transport;
  // Délai entre deux envois (limite de débit du service).
  pause?: () => Promise<void>;
}

export interface BilanEnvoi {
  envoyes: { nom: string; reference: string; adresse: string }[];
  echecs: { nom: string; reference: string; erreur: string }[];
  // Non servis : pas de courriel, ou déjà envoyés sans confirmation de renvoi.
  nonServis: { nom: string; reference: string; motif: "sans_courriel" | "deja_envoye" }[];
}

export async function envoyerAppels(recap: Recapitulatif, demande: DemandeEnvoi, acces: Acces): Promise<BilanEnvoi> {
  if (!demande.recapitulatifValide) {
    throw new EnvoiInterdit("Le récapitulatif doit être validé avant tout envoi.");
  }
  // Vérifiée une fois, avant le premier message : une redirection absente ou
  // fictive arrête tout, rien ne part à moitié.
  if (demande.demonstration) verifierRedirection(demande.redirection);
  const repondreA = demande.demonstration ? demande.redirection : demande.adresseCabinet;

  const bilan: BilanEnvoi = { envoyes: [], echecs: [], nonServis: [] };
  for (const ligne of recap.lignes) {
    if (!ligne.parCourriel || !ligne.email) {
      bilan.nonServis.push({ nom: ligne.destinataireNom, reference: ligne.reference, motif: "sans_courriel" });
      continue;
    }
    if (ligne.dernierEnvoiLe && !demande.renvoyerDejaEnvoyes) {
      bilan.nonServis.push({ nom: ligne.destinataireNom, reference: ligne.reference, motif: "deja_envoye" });
      continue;
    }

    // Si l'aiguillage refuse (adresse du jeu fictif hors démonstration), rien ne
    // part : l'échec est tracé avec l'adresse refusée, et le lot continue.
    let destination: Destination = { adresse: ligne.email, adressePrevue: null };
    let resultat: ResultatEnvoi;
    try {
      destination = destinationEffective({
        demonstration: demande.demonstration,
        redirection: demande.redirection,
        adresseDestinataire: ligne.email,
      });
      const courriel = await composerCourrielAppel({
        instantane: await acces.instantane(ligne.appelId),
        destinataireNom: ligne.destinataireNom,
        langue: ligne.langue,
        destination,
        demonstration: demande.demonstration,
        expediteur: demande.expediteur,
        repondreA: repondreA ?? null,
        pdf: await acces.pdf(ligne.appelId),
      });
      resultat = await envoyerCourriel(courriel, acces.transport);
    } catch (erreur) {
      resultat = {
        reussi: false,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
        statut: null,
        service: acces.transport.nom,
      };
    }
    await acces.tracer({ appelId: ligne.appelId, adresse: destination.adresse, adressePrevue: destination.adressePrevue, resultat });
    if (resultat.reussi) {
      bilan.envoyes.push({ nom: ligne.destinataireNom, reference: ligne.reference, adresse: destination.adresse });
    } else {
      bilan.echecs.push({ nom: ligne.destinataireNom, reference: ligne.reference, erreur: resultat.erreur });
    }
    await acces.pause?.();
  }
  return bilan;
}
