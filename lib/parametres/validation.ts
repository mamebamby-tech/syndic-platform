import type { MoyenPaiement } from "@/lib/types/database";
import { codeReferenceValide, formatReferenceValide } from "@/lib/parametres/reference";

// Validation des paramètres de paiement et de référence d'un immeuble.
// Miroir des contraintes de la base (20260919110000_parametres_immeuble.sql) :
// elle donne un message précis à la personne qui saisit ; la base, elle, refuse
// de toute façon ce qui serait invalide.

// Les cinq moyens offerts. `cheque` existe dans l'énumération (un paiement peut
// être saisi en chèque) mais n'est pas un moyen que le syndicat annonce.
export const MOYENS_OFFERTS = [
  "wave",
  "orange_money",
  "virement",
  "virement_international",
  "especes",
] as const satisfies readonly MoyenPaiement[];

// Moyens mobiles : seuls à porter un numéro marchand, « le cas échéant ».
export const MOYENS_AVEC_NUMERO_MARCHAND = ["wave", "orange_money"] as const;

export type MoyenMarchand = (typeof MOYENS_AVEC_NUMERO_MARCHAND)[number];

export interface SaisieParametres {
  titulaire: string;
  banque: string;
  numero: string;
  bic: string;
  moyens: string[];
  marchands: Record<MoyenMarchand, string>;
  // Lieu et horaires des espèces : facultatifs (défaut : adresse du cabinet).
  especesLieu?: string;
  especesHoraires?: string;
  codeReference: string;
  formatReference: string;
}

export type Champ = "bic" | "moyens" | "compte" | "marchand_wave" | "marchand_orange_money" | "codeReference" | "formatReference";

// Les codes d'erreur sont traduits par l'écran (messages `Parametres.erreurs.*`).
export type CodeErreur =
  | "bic_invalide"
  | "swift_requis"
  | "moyen_inconnu"
  | "numero_marchand_requis"
  | "compte_requis"
  | "code_invalide"
  | "code_deja_utilise"
  | "format_invalide"
  | "acces_refuse"
  | "enregistrement_impossible";

export interface ValeursParametres {
  compte_titulaire: string | null;
  compte_banque: string | null;
  compte_numero: string | null;
  compte_bic: string | null;
  moyens_paiement_acceptes: MoyenPaiement[];
  numeros_marchands: Partial<Record<MoyenMarchand, string>>;
  especes_lieu: string | null;
  especes_horaires: string | null;
  code_reference: string;
  format_reference_appel: string;
}

export type ErreursParametres = Partial<Record<Champ, CodeErreur>>;

const vide = (valeur: string) => {
  const propre = valeur.trim();
  return propre.length > 0 ? propre : null;
};

export function validerParametres(saisie: SaisieParametres): {
  valeurs: ValeursParametres | null;
  erreurs: ErreursParametres;
} {
  const erreurs: ErreursParametres = {};

  // Un SWIFT/BIC se saisit avec des espaces : on les retire, on met en capitales.
  const bic = vide(saisie.bic.replace(/\s+/g, "").toUpperCase());
  if (bic !== null && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    erreurs.bic = "bic_invalide";
  }

  const inconnus = saisie.moyens.filter(
    (moyen) => !(MOYENS_OFFERTS as readonly string[]).includes(moyen),
  );
  if (inconnus.length > 0) erreurs.moyens = "moyen_inconnu";
  const moyens = MOYENS_OFFERTS.filter((moyen) => saisie.moyens.includes(moyen));

  // On n'annonce pas les virements internationaux sans le code qu'ils exigent.
  if (moyens.includes("virement_international") && bic === null && !erreurs.bic) {
    erreurs.bic = "swift_requis";
  }

  // Un numéro marchand n'existe que pour un moyen mobile ACCEPTÉ : décocher
  // Wave efface son numéro plutôt que de laisser une donnée orpheline.
  const marchands: Partial<Record<MoyenMarchand, string>> = {};
  for (const moyen of MOYENS_AVEC_NUMERO_MARCHAND) {
    const numero = vide(saisie.marchands[moyen] ?? "");
    if (moyens.includes(moyen) && numero !== null) marchands[moyen] = numero;
    // Un moyen annoncé sans ses coordonnées n'est pas un moyen (décision 74).
    if (moyens.includes(moyen) && numero === null) erreurs[`marchand_${moyen}`] = "numero_marchand_requis";
  }

  // Virement, virement international : le compte du syndicat, complet.
  const compteComplet = [saisie.titulaire, saisie.banque, saisie.numero].every((champ) => vide(champ) !== null);
  if ((moyens.includes("virement") || moyens.includes("virement_international")) && !compteComplet) {
    erreurs.compte = "compte_requis";
  }

  // Le lieu des espèces n'a de sens que si les espèces sont acceptées.
  const especes = moyens.includes("especes");

  const code = saisie.codeReference.trim().toUpperCase();
  if (!codeReferenceValide(code)) erreurs.codeReference = "code_invalide";

  const format = saisie.formatReference.trim();
  if (!formatReferenceValide(format)) erreurs.formatReference = "format_invalide";

  if (Object.keys(erreurs).length > 0) return { valeurs: null, erreurs };

  return {
    erreurs,
    valeurs: {
      compte_titulaire: vide(saisie.titulaire),
      compte_banque: vide(saisie.banque),
      compte_numero: vide(saisie.numero),
      compte_bic: bic,
      moyens_paiement_acceptes: [...moyens],
      numeros_marchands: marchands,
      especes_lieu: especes ? vide(saisie.especesLieu ?? "") : null,
      especes_horaires: especes ? vide(saisie.especesHoraires ?? "") : null,
      code_reference: code,
      format_reference_appel: format,
    },
  };
}

// Compte du syndicat partiellement rempli : l'émission des appels reste
// bloquée (app.coordonnees_bancaires_completes). Signalement, pas erreur.
export function compteIncomplet(
  valeurs: Pick<ValeursParametres, "compte_titulaire" | "compte_banque" | "compte_numero">,
): boolean {
  const champs = [valeurs.compte_titulaire, valeurs.compte_banque, valeurs.compte_numero];
  const remplis = champs.filter((champ) => champ !== null).length;
  return remplis > 0 && remplis < champs.length;
}
