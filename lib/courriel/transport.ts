import { EnvoiInterdit, estAdresseFictive, estAdresseValide } from "@/lib/courriel/garde-fou";

// Le dernier point avant le service d'envoi. Tout courriel du produit passe par
// `envoyerCourriel`, qui refuse une adresse du jeu fictif AVANT d'appeler le
// transport (lib/courriel/garde-fou.ts, second verrou).

export interface PieceJointe {
  nom: string;
  contenu: Uint8Array;
  type: string;
}

export interface Courriel {
  de: string;
  a: string;
  repondreA: string | null;
  sujet: string;
  html: string;
  texte: string;
  piecesJointes: PieceJointe[];
}

// Ce que rend le service d'envoi, tracé tel quel dans `journal`.
export type ResultatEnvoi =
  | { reussi: true; identifiant: string; service: string }
  | { reussi: false; erreur: string; statut: number | null; service: string };

export interface Transport {
  nom: string;
  envoyer(courriel: Courriel): Promise<ResultatEnvoi>;
}

export async function envoyerCourriel(courriel: Courriel, transport: Transport): Promise<ResultatEnvoi> {
  if (!estAdresseValide(courriel.a)) throw new EnvoiInterdit(`Adresse invalide : ${courriel.a}`);
  if (estAdresseFictive(courriel.a)) {
    throw new EnvoiInterdit(`Adresse du jeu fictif refusée au dernier point d'envoi : ${courriel.a}`);
  }
  // Une réponse vers une boîte inexistante rebondirait de la même façon.
  if (courriel.repondreA && estAdresseFictive(courriel.repondreA)) {
    throw new EnvoiInterdit(`Adresse de réponse du jeu fictif refusée : ${courriel.repondreA}`);
  }
  return transport.envoyer(courriel);
}

// Resend (docs/06-decisions.md, décision 68) : une requête HTTP, sans SDK.
// https://resend.com/docs/api-reference/emails/send-email
export function transportResend(cleApi: string, requete: typeof fetch = fetch): Transport {
  return {
    nom: "resend",
    async envoyer(c) {
      let reponse: Response;
      try {
        reponse = await requete("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${cleApi}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: c.de,
            to: [c.a],
            ...(c.repondreA ? { reply_to: c.repondreA } : {}),
            subject: c.sujet,
            html: c.html,
            text: c.texte,
            attachments: c.piecesJointes.map((p) => ({
              filename: p.nom,
              content: Buffer.from(p.contenu).toString("base64"),
              content_type: p.type,
            })),
          }),
        });
      } catch (erreur) {
        return { reussi: false, erreur: erreur instanceof Error ? erreur.message : String(erreur), statut: null, service: "resend" };
      }
      const corps = (await reponse.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (reponse.ok && corps.id) return { reussi: true, identifiant: corps.id, service: "resend" };
      return {
        reussi: false,
        erreur: corps.message ?? corps.name ?? `HTTP ${reponse.status}`,
        statut: reponse.status,
        service: "resend",
      };
    },
  };
}
