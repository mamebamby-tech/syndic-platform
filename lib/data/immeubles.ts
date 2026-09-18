import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";

export interface ImmeubleAvecOrganisation {
  id: string;
  nom: string;
  ville: string | null;
  organisation_id: string;
  organisation_nom: string;
}

// La sécurité par ligne filtre déjà sur le périmètre de l'utilisateur
// (app.immeubles_de_lutilisateur / app.organisations_de_lutilisateur) :
// ces requêtes ne renvoient jamais les données d'un autre cabinet.
export async function listerImmeublesAccessibles(): Promise<
  ImmeubleAvecOrganisation[]
> {
  const supabase = await creerClientServeur();

  const [{ data: immeubles, error: erreurImmeubles }, { data: organisations, error: erreurOrgs }] =
    await Promise.all([
      supabase.from("immeubles").select("id, nom, ville, organisation_id").order("nom"),
      supabase.from("organisations").select("id, nom"),
    ]);

  if (erreurImmeubles) {
    throw new Error(`Lecture des immeubles impossible : ${erreurImmeubles.message}`);
  }
  if (erreurOrgs) {
    throw new Error(`Lecture des cabinets impossible : ${erreurOrgs.message}`);
  }

  const nomParOrganisation = new Map(
    (organisations ?? []).map((organisation) => [organisation.id, organisation.nom]),
  );

  return (immeubles ?? []).map((immeuble) => ({
    id: immeuble.id,
    nom: immeuble.nom,
    ville: immeuble.ville,
    organisation_id: immeuble.organisation_id,
    organisation_nom: nomParOrganisation.get(immeuble.organisation_id) ?? "",
  }));
}

export async function trouverImmeuble(immeubleId: string) {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase
    .from("immeubles")
    .select("id, nom, ville, organisation_id")
    .eq("id", immeubleId)
    .maybeSingle();

  if (error) {
    throw new Error(`Lecture de l'immeuble impossible : ${error.message}`);
  }

  return data;
}
