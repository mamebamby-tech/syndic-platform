import { createTranslator } from "next-intl";
import { formats, FUSEAU } from "@/i18n/formats";
import { couleurs } from "@/tailwind.config";
import type { InstantaneAppel } from "@/lib/appels/instantane";
import { localeDe, normaliserLangue } from "@/lib/i18n/config";
import { chargerMessages } from "@/lib/i18n/messages";
import { rendreNotification } from "@/lib/notifications/gabarits";
import { EnvoiInterdit, type Destination } from "@/lib/courriel/garde-fou";
import type { Courriel } from "@/lib/courriel/transport";

// Le courriel qui accompagne le PDF d'un appel émis (décision 70) : version
// HTML ET version texte, pied de page qui identifie le cabinet, PDF en pièce
// jointe. Le contenu vient de l'INSTANTANÉ (référence, montant, échéance,
// cabinet), jamais des données courantes. Le texte est celui du gabarit
// `appel_emis` (lib/notifications/gabarits.ts), dans la langue du destinataire.

const echapper = (texte: string) =>
  texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface OptionsMessageAppel {
  instantane: InstantaneAppel;
  destinataireNom: string;
  langue: string | null;
  destination: Destination;
  demonstration: boolean;
  expediteur: string;
  // Adresse de réponse : celle du cabinet ; en démonstration, la redirection.
  repondreA: string | null;
  pdf: Uint8Array;
}

export async function composerCourrielAppel(o: OptionsMessageAppel): Promise<Courriel> {
  const i = o.instantane;
  const rendu = await rendreNotification({
    gabarit: "appel_emis",
    canal: "email",
    langue: o.langue,
    chargeUtile: {
      cabinet: i.organisation.nom,
      reference: i.reference,
      periode: i.periode.libelle,
      montant: i.montantTotal,
      echeance: i.dateEcheance,
    },
  });
  // Un gabarit que le cabinet n'a pas validé ne part pas vers un vrai
  // copropriétaire. En démonstration, le message part vers l'utilisateur.
  if (rendu.brouillon && !o.demonstration) {
    throw new EnvoiInterdit("Le texte du courriel d'appel n'a pas été validé par le cabinet : envoi réel refusé.");
  }

  const langue = normaliserLangue(o.langue);
  const t = createTranslator({
    locale: localeDe(langue),
    messages: await chargerMessages(langue),
    formats,
    timeZone: FUSEAU,
    namespace: "Notifications.courriel",
  });

  const bandeau =
    o.destination.adressePrevue !== null
      ? t("demonstration", { nom: o.destinataireNom, adresse: o.destination.adressePrevue })
      : null;
  const pied = [
    t("pied", { cabinet: i.organisation.nom }),
    [
      i.organisation.nom,
      i.organisation.adresse,
      i.organisation.email,
      i.organisation.ninea && `NINEA ${i.organisation.ninea}`,
      i.organisation.rccm && `RCCM ${i.organisation.rccm}`,
    ]
      .filter(Boolean)
      .join(" | "),
  ];
  const corps = [rendu.corps, t("pieceJointe")].join("\n\n");
  const sujet = bandeau ? t("demonstrationSujet", { sujet: rendu.sujet ?? "" }) : (rendu.sujet ?? "");

  const texte = [bandeau, corps, "—", ...pied].filter((x): x is string => Boolean(x)).join("\n\n");

  const paragraphes = corps
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${echapper(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html lang="${langue}"><body style="margin:0;background:${couleurs.fond};font-family:Helvetica,Arial,sans-serif;color:${couleurs.encre}">
<div style="max-width:560px;margin:0 auto;padding:24px">
${bandeau ? `<p style="margin:0 0 16px;padding:10px 12px;background:${couleurs["alerte-doux"]};color:${couleurs.alerte};border-radius:8px;font-size:13px">${echapper(bandeau)}</p>` : ""}
<div style="background:${couleurs.surface};border:1px solid ${couleurs.filet};border-radius:11px;padding:24px">
<p style="margin:0 0 16px;font-family:Georgia,serif;font-size:18px;color:${couleurs.marque}">${echapper(i.organisation.nom)}</p>
${paragraphes}
</div>
<p style="margin:16px 0 0;font-size:12px;color:${couleurs["encre-3"]}">${pied.map(echapper).join("<br>")}</p>
</div></body></html>`;

  return {
    de: o.expediteur,
    a: o.destination.adresse,
    repondreA: o.repondreA,
    sujet,
    html,
    texte,
    piecesJointes: [{ nom: `Appel-${i.reference}.pdf`, contenu: o.pdf, type: "application/pdf" }],
  };
}
