// Types écrits à la main à partir de supabase/migrations/20260918090000_schema.sql.
// `npm run types:db` régénère ce fichier depuis le schéma réel, mais exige
// Docker (ou Podman) sur la machine — absent de cette session au moment où
// ce fichier a été écrit. Une fois Docker disponible, lance la commande et
// remplace ce fichier par sa sortie.
// Ne couvre que les tables lues par l'application à ce stade (coquille de
// navigation, registre des lots). Complète-le au fur et à mesure.

export type RoleMembre = "proprietaire_org" | "gestionnaire" | "lecteur";
export type TypePersonne = "physique" | "morale";
export type NatureDetention =
  | "pleine_propriete"
  | "nue_propriete"
  | "usufruit"
  | "indivision";
export type Periodicite = "mensuel" | "trimestriel" | "semestriel" | "annuel";
export type StatutPeriode = "brouillon" | "vote" | "appele" | "clos";
export type StatutAppel = "brouillon" | "emis" | "partiel" | "solde" | "annule";
export type MoyenPaiement =
  | "wave"
  | "orange_money"
  | "virement"
  | "virement_international"
  | "especes"
  | "cheque";
export type StatutPaiement = "en_attente" | "confirme" | "echoue" | "rembourse";

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string;
          nom: string;
          slug: string;
          ninea: string | null;
          rccm: string | null;
          adresse: string | null;
          email: string | null;
          telephone: string | null;
          logo_path: string | null;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["organisations"]["Row"]> & {
          nom: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["organisations"]["Row"]>;
        Relationships: [];
      };
      membres: {
        Row: {
          id: string;
          organisation_id: string;
          user_id: string;
          role: RoleMembre;
          langue: string;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["membres"]["Row"]> & {
          organisation_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["membres"]["Row"]>;
        Relationships: [];
      };
      immeubles: {
        Row: {
          id: string;
          organisation_id: string;
          nom: string;
          adresse: string | null;
          ville: string | null;
          pays: string;
          titre_foncier: string | null;
          devise: string;
          code_reference: string | null;
          format_reference_appel: string;
          compte_titulaire: string | null;
          compte_banque: string | null;
          compte_numero: string | null;
          compte_bic: string | null;
          moyens_paiement_acceptes: MoyenPaiement[];
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["immeubles"]["Row"]> & {
          organisation_id: string;
          nom: string;
        };
        Update: Partial<Database["public"]["Tables"]["immeubles"]["Row"]>;
        Relationships: [];
      };
      reglements: {
        Row: {
          id: string;
          immeuble_id: string;
          libelle: string;
          date_depot: string | null;
          notaire: string | null;
          document_path: string | null;
          en_vigueur: boolean;
          base_tantiemes: number;
          periodicite_appel: Periodicite;
          jour_exigibilite: number;
          delai_paiement_jours: number;
          taux_penalite: number;
          penalite_par: Periodicite;
          penalite_requiert_mise_en_demeure: boolean;
          penalite_automatique: boolean;
          delai_convocation_jours: number;
          delai_convocation_renforce_jours: number;
          quorum_tantiemes_ratio: number | null;
          seconde_convocation_sans_quorum: boolean;
          ecretement_seuil_ratio: number | null;
          demande_convocation_ratio: number | null;
          carence_syndic_jours: number | null;
          conseil_syndical_membres: number | null;
          conseil_syndical_exercices: number | null;
          plafond_pouvoirs_mandataire: number | null;
          plafond_depense_syndic: number | null;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reglements"]["Row"]> & {
          immeuble_id: string;
          libelle: string;
        };
        Update: Partial<Database["public"]["Tables"]["reglements"]["Row"]>;
        Relationships: [];
      };
      proprietaires: {
        Row: {
          id: string;
          immeuble_id: string;
          nom: string;
          type: TypePersonne;
          email: string | null;
          telephone: string | null;
          pays: string | null;
          groupe_id: string | null;
          est_groupe: boolean;
          note: string | null;
          langue: string;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proprietaires"]["Row"]> & {
          immeuble_id: string;
          nom: string;
        };
        Update: Partial<Database["public"]["Tables"]["proprietaires"]["Row"]>;
        Relationships: [];
      };
      lots: {
        Row: {
          id: string;
          immeuble_id: string;
          numero: number;
          designation: string;
          niveau: string | null;
          etage: number | null;
          superficie_m2: number | null;
          tantiemes: number;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["lots"]["Row"]> & {
          immeuble_id: string;
          numero: number;
          designation: string;
          tantiemes: number;
        };
        Update: Partial<Database["public"]["Tables"]["lots"]["Row"]>;
        Relationships: [];
      };
      lot_proprietaires: {
        Row: {
          id: string;
          lot_id: string;
          proprietaire_id: string;
          nature: NatureDetention;
          quote_part: number;
          date_debut: string;
          date_fin: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["lot_proprietaires"]["Row"]> & {
          lot_id: string;
          proprietaire_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["lot_proprietaires"]["Row"]>;
        Relationships: [];
      };
      occupants: {
        Row: {
          id: string;
          lot_id: string;
          nom: string;
          email: string | null;
          telephone: string | null;
          est_locataire: boolean;
          date_debut: string | null;
          date_fin: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["occupants"]["Row"]> & {
          lot_id: string;
          nom: string;
        };
        Update: Partial<Database["public"]["Tables"]["occupants"]["Row"]>;
        Relationships: [];
      };
      acces_personnes: {
        Row: {
          id: string;
          user_id: string;
          proprietaire_id: string | null;
          occupant_id: string | null;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["acces_personnes"]["Row"]> & {
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["acces_personnes"]["Row"]>;
        Relationships: [];
      };
      cles_repartition: {
        Row: {
          id: string;
          immeuble_id: string;
          code: string;
          libelle: string;
          methode: string;
          parametres: Record<string, unknown>;
          article: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["cles_repartition"]["Row"]> & {
          immeuble_id: string;
          code: string;
          libelle: string;
          methode: string;
        };
        Update: Partial<Database["public"]["Tables"]["cles_repartition"]["Row"]>;
        Relationships: [];
      };
      postes_charges: {
        Row: {
          id: string;
          immeuble_id: string;
          libelle: string;
          categorie: string;
          cle_repartition_id: string;
          actif: boolean;
          ordre: number;
        };
        Insert: Partial<Database["public"]["Tables"]["postes_charges"]["Row"]> & {
          immeuble_id: string;
          libelle: string;
          cle_repartition_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["postes_charges"]["Row"]>;
        Relationships: [];
      };
      exercices: {
        Row: {
          id: string;
          immeuble_id: string;
          libelle: string;
          date_debut: string;
          date_fin: string;
          budget_vote: number | null;
          vote_le: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["exercices"]["Row"]> & {
          immeuble_id: string;
          libelle: string;
          date_debut: string;
          date_fin: string;
        };
        Update: Partial<Database["public"]["Tables"]["exercices"]["Row"]>;
        Relationships: [];
      };
      periodes: {
        Row: {
          id: string;
          exercice_id: string;
          libelle: string;
          date_debut: string;
          date_fin: string;
          date_echeance: string;
          statut: StatutPeriode;
        };
        Insert: Partial<Database["public"]["Tables"]["periodes"]["Row"]> & {
          exercice_id: string;
          libelle: string;
          date_debut: string;
          date_fin: string;
          date_echeance: string;
        };
        Update: Partial<Database["public"]["Tables"]["periodes"]["Row"]>;
        Relationships: [];
      };
      budget_lignes: {
        Row: {
          id: string;
          periode_id: string;
          poste_charge_id: string;
          montant: number;
          fournisseur: string | null;
          note: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["budget_lignes"]["Row"]> & {
          periode_id: string;
          poste_charge_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["budget_lignes"]["Row"]>;
        Relationships: [];
      };
      appels: {
        Row: {
          id: string;
          periode_id: string;
          proprietaire_id: string;
          reference: string;
          numero: number | null;
          montant_total: number;
          report_anterieur: number;
          date_emission: string | null;
          date_echeance: string;
          statut: StatutAppel;
          document_path: string | null;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["appels"]["Row"]> & {
          periode_id: string;
          proprietaire_id: string;
          reference: string;
          date_echeance: string;
        };
        Update: Partial<Database["public"]["Tables"]["appels"]["Row"]>;
        Relationships: [];
      };
      appel_lignes: {
        Row: {
          id: string;
          appel_id: string;
          lot_id: string;
          poste_charge_id: string;
          base_calcul: number;
          montant: number;
        };
        Insert: Partial<Database["public"]["Tables"]["appel_lignes"]["Row"]> & {
          appel_id: string;
          lot_id: string;
          poste_charge_id: string;
          base_calcul: number;
          montant: number;
        };
        Update: Partial<Database["public"]["Tables"]["appel_lignes"]["Row"]>;
        Relationships: [];
      };
      paiements: {
        Row: {
          id: string;
          appel_id: string | null;
          proprietaire_id: string;
          montant: number;
          moyen: MoyenPaiement;
          reference_externe: string | null;
          date_paiement: string;
          statut: StatutPaiement;
          recu_path: string | null;
          saisi_par: string | null;
          cree_le: string;
        };
        Insert: Partial<Database["public"]["Tables"]["paiements"]["Row"]> & {
          proprietaire_id: string;
          montant: number;
          moyen: MoyenPaiement;
        };
        Update: Partial<Database["public"]["Tables"]["paiements"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      generer_appels: {
        Args: { p_periode_id: string };
        Returns: number;
      };
      changer_langue: {
        Args: { p_langue: string };
        Returns: undefined;
      };
      ma_langue: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
    Enums: {
      role_membre: RoleMembre;
      type_personne: TypePersonne;
      nature_detention: NatureDetention;
      periodicite: Periodicite;
      statut_periode: StatutPeriode;
      statut_appel: StatutAppel;
      moyen_paiement: MoyenPaiement;
      statut_paiement: StatutPaiement;
    };
  };
}
