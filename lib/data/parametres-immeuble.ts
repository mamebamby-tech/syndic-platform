import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import type { MoyenPaiement, Periodicite, RoleMembre } from "@/lib/types/database";
import { compterHabilites } from "@/lib/parametres/double-validation";
import {
  ACTIONS_PARAMETRES,
  decrireModification,
  type ModificationDecrite,
} from "@/lib/parametres/journal";

export interface ParametresImmeuble {
  immeubleId: string;
  organisationId: string;
  titulaire: string;
  banque: string;
  numero: string;
  bic: string;
  moyens: MoyenPaiement[];
  marchands: Record<string, string>;
  codeReference: string;
  formatReference: string;
  // Dernière modification des coordonnées de paiement ; null si jamais renseignées.
  compteModifieLe: string | null;
  // Périodicité du règlement en vigueur : sert à montrer un exemple de référence.
  periodicite: Periodicite | null;
}

export interface VersionEnAttente {
  id: string;
  titulaire: string;
  banque: string;
  numero: string;
  bic: string;
  moyens: MoyenPaiement[];
  marchands: Record<string, string>;
  proposePar: string | null;
  proposeParLibelle: string | null;
  proposeLe: string;
}

// La modification qui attend confirmation (au plus une par immeuble). Lisible par
// tout le personnel du cabinet ; l'écran ne la montre EN CLAIR qu'aux habilités.
export async function chargerVersionEnAttente(immeubleId: string): Promise<VersionEnAttente | null> {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase
    .from("coordonnees_paiement_versions")
    .select(
      "id, compte_titulaire, compte_banque, compte_numero, compte_bic, moyens_paiement_acceptes, numeros_marchands, propose_par, propose_par_libelle, propose_le",
    )
    .eq("immeuble_id", immeubleId)
    .eq("statut", "en_attente")
    .maybeSingle();
  if (error) throw new Error(`Lecture de la modification en attente impossible : ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    titulaire: data.compte_titulaire ?? "",
    banque: data.compte_banque ?? "",
    numero: data.compte_numero ?? "",
    bic: data.compte_bic ?? "",
    moyens: data.moyens_paiement_acceptes,
    marchands: data.numeros_marchands,
    proposePar: data.propose_par,
    proposeParLibelle: data.propose_par_libelle,
    proposeLe: data.propose_le,
  };
}

// Nombre de membres habilités (gestionnaire, proprietaire_org) du cabinet : la
// confirmation exige un AUTRE membre que l'auteur, donc au moins deux.
export async function compterMembresHabilites(organisationId: string): Promise<number> {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase.from("membres").select("role").eq("organisation_id", organisationId);
  if (error) throw new Error(`Lecture des membres impossible : ${error.message}`);
  return compterHabilites((data ?? []).map((membre) => membre.role));
}

export async function utilisateurCourantId(): Promise<string | null> {
  const supabase = await creerClientServeur();
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims.sub ?? null;
}

export async function chargerParametres(immeubleId: string): Promise<ParametresImmeuble | null> {
  const supabase = await creerClientServeur();

  const [{ data: immeuble, error }, { data: reglement }] = await Promise.all([
    supabase
      .from("immeubles")
      .select(
        "id, organisation_id, compte_titulaire, compte_banque, compte_numero, compte_bic, moyens_paiement_acceptes, numeros_marchands, code_reference, format_reference_appel, compte_modifie_le",
      )
      .eq("id", immeubleId)
      .maybeSingle(),
    supabase
      .from("reglements")
      .select("periodicite_appel")
      .eq("immeuble_id", immeubleId)
      .eq("en_vigueur", true)
      .maybeSingle(),
  ]);

  if (error) throw new Error(`Lecture des paramètres de l'immeuble impossible : ${error.message}`);
  if (!immeuble) return null;

  return {
    immeubleId: immeuble.id,
    organisationId: immeuble.organisation_id,
    titulaire: immeuble.compte_titulaire ?? "",
    banque: immeuble.compte_banque ?? "",
    numero: immeuble.compte_numero ?? "",
    bic: immeuble.compte_bic ?? "",
    moyens: immeuble.moyens_paiement_acceptes,
    marchands: immeuble.numeros_marchands,
    codeReference: immeuble.code_reference ?? "",
    formatReference: immeuble.format_reference_appel,
    compteModifieLe: immeuble.compte_modifie_le,
    periodicite: reglement?.periodicite_appel ?? null,
  };
}

// Rôle de la personne connectée dans le cabinet de l'immeuble. La sécurité par
// ligne reste l'autorité (un lecteur ne peut de toute façon rien modifier) ;
// ceci sert à ne montrer que ce qui est permis.
export async function roleSurOrganisation(organisationId: string): Promise<RoleMembre | null> {
  const supabase = await creerClientServeur();
  const { data: claims } = await supabase.auth.getClaims();
  const utilisateurId = claims?.claims.sub;
  if (!utilisateurId) return null;

  const { data, error } = await supabase
    .from("membres")
    .select("role")
    .eq("user_id", utilisateurId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error) throw new Error(`Lecture du rôle impossible : ${error.message}`);
  return data?.role ?? null;
}

// Même définition que app.est_gestionnaire : gestionnaire et proprietaire_org.
export function peutParametrer(role: RoleMembre | null): boolean {
  return role === "proprietaire_org" || role === "gestionnaire";
}

// Dernières modifications des paramètres de paiement et de référence, les plus
// récentes d'abord. Lisibles par tout le personnel du cabinet (journal_lecture).
export async function listerModificationsParametres(
  immeubleId: string,
  limite = 5,
): Promise<ModificationDecrite[]> {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase
    .from("journal")
    .select("id, cree_le, acteur_libelle, action, avant, apres")
    .eq("entite", "immeubles")
    .eq("entite_id", immeubleId)
    .in("action", [...ACTIONS_PARAMETRES])
    .order("cree_le", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Lecture du journal impossible : ${error.message}`);
  return (data ?? [])
    .map((ligne) => decrireModification(ligne))
    .filter((modification): modification is ModificationDecrite => modification !== null);
}
