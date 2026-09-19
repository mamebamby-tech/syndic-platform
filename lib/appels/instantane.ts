import type { AppelDetail, ContexteDocument, LigneAppelDetail } from "@/lib/data/appels";
import type { MoyenPaiement } from "@/lib/types/database";

// Instantané d'un appel émis (appels.instantane, pris par la base au passage de
// brouillon à émis — 20260919120000_instantane_appel.sql). Le document d'un
// appel émis se rend EXCLUSIVEMENT depuis lui : jamais depuis les données
// courantes de l'immeuble, du cabinet ou du copropriétaire.
//
// Lecture STRICTE : un instantané illisible lève une erreur. On ne retombe
// jamais sur les données courantes — ce serait afficher, pour un document déjà
// envoyé, autre chose que ce qui a été envoyé.

export interface InstantaneAppel {
  version: 1;
  emisLe: string;
  reference: string;
  numero: number | null;
  dateEcheance: string;
  dateEmission: string | null;
  reportAnterieur: number;
  montantTotal: number;
  destinataire: { id: string; nom: string };
  periode: { id: string; libelle: string };
  immeuble: { id: string; nom: string };
  organisation: {
    nom: string;
    adresse: string | null;
    email: string | null;
    ninea: string | null;
    rccm: string | null;
  };
  lignes: LigneAppelDetail[];
  reglement: {
    compte: { titulaire: string; banque: string; numero: string; bic: string | null } | null;
    moyens: MoyenPaiement[];
    numerosMarchands: Record<string, string>;
    compteModifieLe: string | null;
  };
}

export class InstantaneIllisible extends Error {
  constructor(detail: string) {
    super(`Instantané d'appel illisible (${detail}) : le document ne peut pas être rendu.`);
    this.name = "InstantaneIllisible";
  }
}

type Objet = Record<string, unknown>;

function objet(valeur: unknown, chemin: string): Objet {
  if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) {
    throw new InstantaneIllisible(`${chemin} absent`);
  }
  return valeur as Objet;
}
const texte = (valeur: unknown, chemin: string): string => {
  if (typeof valeur !== "string") throw new InstantaneIllisible(`${chemin} absent`);
  return valeur;
};
const texteOuNul = (valeur: unknown): string | null => (typeof valeur === "string" ? valeur : null);
const nombre = (valeur: unknown, chemin: string): number => {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) throw new InstantaneIllisible(`${chemin} absent`);
  return valeur;
};

export function lireInstantane(brut: unknown): InstantaneAppel {
  const racine = objet(brut, "instantané");
  if (racine.version !== 1) throw new InstantaneIllisible(`version ${String(racine.version)} inconnue`);

  const organisation = objet(racine.organisation, "organisation");
  const reglement = objet(racine.reglement, "règlement");
  const compte = reglement.compte === null || reglement.compte === undefined ? null : objet(reglement.compte, "compte");
  const lignes = racine.lignes;
  if (!Array.isArray(lignes)) throw new InstantaneIllisible("lignes absentes");

  return {
    version: 1,
    emisLe: texte(racine.emis_le, "emis_le"),
    reference: texte(racine.reference, "référence"),
    numero: typeof racine.numero === "number" ? racine.numero : null,
    dateEcheance: texte(racine.date_echeance, "échéance"),
    dateEmission: texteOuNul(racine.date_emission),
    reportAnterieur: nombre(racine.report_anterieur, "report"),
    montantTotal: nombre(racine.montant_total, "total"),
    destinataire: {
      id: texte(objet(racine.destinataire, "destinataire").id, "destinataire.id"),
      nom: texte(objet(racine.destinataire, "destinataire").nom, "destinataire.nom"),
    },
    periode: {
      id: texte(objet(racine.periode, "période").id, "période.id"),
      libelle: texte(objet(racine.periode, "période").libelle, "période.libelle"),
    },
    immeuble: {
      id: texte(objet(racine.immeuble, "immeuble").id, "immeuble.id"),
      nom: texte(objet(racine.immeuble, "immeuble").nom, "immeuble.nom"),
    },
    organisation: {
      nom: texte(organisation.nom, "organisation.nom"),
      adresse: texteOuNul(organisation.adresse),
      email: texteOuNul(organisation.email),
      ninea: texteOuNul(organisation.ninea),
      rccm: texteOuNul(organisation.rccm),
    },
    lignes: lignes.map((brute, index) => {
      const ligne = objet(brute, `ligne ${index}`);
      return {
        lotNumero: nombre(ligne.lot_numero, `ligne ${index}.lot`),
        posteLibelle: texte(ligne.poste_libelle, `ligne ${index}.poste`),
        baseCalcul: nombre(ligne.base_calcul, `ligne ${index}.base`),
        montant: nombre(ligne.montant, `ligne ${index}.montant`),
      };
    }),
    reglement: {
      compte: compte && {
        titulaire: texte(compte.titulaire, "compte.titulaire"),
        banque: texte(compte.banque, "compte.banque"),
        numero: texte(compte.numero, "compte.numero"),
        bic: texteOuNul(compte.bic),
      },
      moyens: Array.isArray(reglement.moyens) ? (reglement.moyens as MoyenPaiement[]) : [],
      numerosMarchands: Object.fromEntries(
        Object.entries(objet(reglement.numeros_marchands ?? {}, "numéros marchands")).filter(
          (entree): entree is [string, string] => typeof entree[1] === "string",
        ),
      ),
      compteModifieLe: texteOuNul(reglement.compte_modifie_le),
    },
  };
}

// Ce que le document lit, tiré de l'instantané et de lui seul.
export function contexteDepuisInstantane(i: InstantaneAppel): ContexteDocument {
  return {
    organisationNom: i.organisation.nom,
    organisationAdresse: i.organisation.adresse,
    organisationEmail: i.organisation.email,
    organisationNinea: i.organisation.ninea,
    organisationRccm: i.organisation.rccm,
    immeubleNom: i.immeuble.nom,
    periodeLibelle: i.periode.libelle,
    compteSyndicat: i.reglement.compte,
    moyensPaiementAcceptes: i.reglement.moyens,
    numerosMarchands: i.reglement.numerosMarchands,
    compteModifieLe: i.reglement.compteModifieLe,
  };
}

// Remplace TOUS les champs que le document affiche. Ce qui reste de `base`
// (identifiant, statut courant, anomalies de contact) n'est pas du contenu de
// document : il décrit l'état de la relation, pas ce qui a été envoyé.
export function appelDepuisInstantane(i: InstantaneAppel, base: AppelDetail): AppelDetail {
  return {
    ...base,
    reference: i.reference,
    montantTotal: i.montantTotal,
    reportAnterieur: i.reportAnterieur,
    dateEcheance: i.dateEcheance,
    dateEmission: i.dateEmission,
    proprietaireNom: i.destinataire.nom,
    lignes: i.lignes,
    contexteEmis: contexteDepuisInstantane(i),
  };
}
