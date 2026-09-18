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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      role_membre: RoleMembre;
      type_personne: TypePersonne;
      nature_detention: NatureDetention;
      periodicite: Periodicite;
    };
  };
}
