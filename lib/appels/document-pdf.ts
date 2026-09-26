import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { lireInstantane } from "@/lib/appels/instantane";
import { composerAppel } from "@/lib/documents/composition-appel";
import { rendrePdfAppel } from "@/lib/documents/pdf-appel";
import { chargerDocumentLocalise } from "@/lib/i18n/document-serveur";

// Le PDF d'un appel émis (décision 69) : engendré UNE fois, depuis
// l'instantané, stocké dans le seau privé `appels`, puis servi tel quel.
// Aucune fonction ici ne reconstruit un PDF existant : `engendrerDocumentAppel`
// renvoie le document déjà enregistré s'il existe, et `lireDocumentAppel`
// vérifie que le fichier servi est bien celui qui a été enregistré (empreinte).
//
// Toutes les opérations passent par la session de l'utilisateur : la sécurité
// par ligne et les politiques du seau s'appliquent (pas de clé de service).

export const SEAU_APPELS = "appels";

type Client = SupabaseClient<Database>;

export interface DocumentEnregistre {
  chemin: string;
  empreinte: string;
  taille: number;
  engendreLe: string;
}

export const empreinte = (contenu: Uint8Array) => createHash("sha256").update(contenu).digest("hex");

async function documentExistant(supabase: Client, appelId: string): Promise<DocumentEnregistre | null> {
  const { data, error } = await supabase
    .from("documents_appels")
    .select("chemin, empreinte, taille, engendre_le")
    .eq("appel_id", appelId)
    .maybeSingle();
  if (error) throw new Error(`Lecture du document de l'appel impossible : ${error.message}`);
  return data && { chemin: data.chemin, empreinte: data.empreinte, taille: data.taille, engendreLe: data.engendre_le };
}

export async function engendrerDocumentAppel(supabase: Client, appelId: string): Promise<DocumentEnregistre> {
  const existant = await documentExistant(supabase, appelId);
  if (existant) return existant;

  const { data: appel, error } = await supabase
    .from("appels")
    .select("id, statut, instantane, periode_id")
    .eq("id", appelId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de l'appel impossible : ${error.message}`);
  if (!appel) throw new Error("Appel introuvable");
  if (!appel.instantane) throw new Error("Cet appel n'est pas émis : il n'a pas d'instantané");

  const instantane = lireInstantane(appel.instantane);
  const pdf = await rendrePdfAppel(composerAppel(instantane, await chargerDocumentLocalise()));
  const chemin = `${instantane.immeuble.id}/${appelId}.pdf`;

  // upsert: false — un fichier déjà présent n'est jamais écrasé.
  const depot = await supabase.storage
    .from(SEAU_APPELS)
    .upload(chemin, pdf, { contentType: "application/pdf", upsert: false });
  if (depot.error) throw new Error(`Dépôt du PDF impossible : ${depot.error.message}`);

  const document = { chemin, empreinte: empreinte(pdf), taille: pdf.length };
  const { error: erreurEnregistrement } = await supabase.rpc("enregistrer_document_appel", {
    p_appel: appelId,
    p_chemin: document.chemin,
    p_empreinte: document.empreinte,
    p_taille: document.taille,
  });
  if (erreurEnregistrement) {
    throw new Error(`Enregistrement du PDF impossible : ${erreurEnregistrement.message}`);
  }
  return { ...document, engendreLe: new Date().toISOString() };
}

export class DocumentAbsent extends Error {}
export class DocumentAltere extends Error {}

// Le fichier enregistré, vérifié. Jamais reconstruit : absent, c'est une erreur.
export async function lireDocumentAppel(supabase: Client, appelId: string): Promise<Uint8Array> {
  const document = await documentExistant(supabase, appelId);
  if (!document) throw new DocumentAbsent("Le PDF de cet appel n'a pas encore été engendré");
  const { data, error } = await supabase.storage.from(SEAU_APPELS).download(document.chemin);
  if (error || !data) throw new Error(`Lecture du PDF impossible : ${error?.message ?? "fichier absent"}`);
  const contenu = new Uint8Array(await data.arrayBuffer());
  if (empreinte(contenu) !== document.empreinte) {
    throw new DocumentAltere("Le PDF stocké ne correspond pas à celui qui a été enregistré : il n'est pas servi");
  }
  return contenu;
}
