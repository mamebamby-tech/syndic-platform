import { describe, expect, it } from "vitest";
import {
  compterHabilites,
  instantaneCoordonnees,
  memesCoordonnees,
  situationDeLaVersion,
  type JeuCoordonnees,
} from "@/lib/parametres/double-validation";
import { decrireModification } from "@/lib/parametres/journal";

const jeu = (surcharge: Partial<JeuCoordonnees> = {}): JeuCoordonnees => ({
  titulaire: "Syndicat",
  banque: "Banque",
  numero: "SN08 0000 1111 2222",
  bic: "ABCDSNDA",
  moyens: ["wave", "virement"],
  marchands: { wave: "770000000" },
  ...surcharge,
});

describe("situation d'une modification en attente", () => {
  it("l'auteur ne peut pas confirmer sa propre modification", () => {
    const s = situationDeLaVersion("alice", "alice", 3);
    expect(s.estAuteur).toBe(true);
    expect(s.peutConfirmer).toBe(false);
  });

  it("un autre membre habilité peut confirmer", () => {
    const s = situationDeLaVersion("alice", "bob", 2);
    expect(s.estAuteur).toBe(false);
    expect(s.peutConfirmer).toBe(true);
    expect(s.aucunAutreHabilite).toBe(false);
  });

  it("un seul membre habilité : personne d'autre ne peut confirmer, et on le signale", () => {
    const s = situationDeLaVersion("solo", "solo", 1);
    expect(s.aucunAutreHabilite).toBe(true);
    expect(s.peutConfirmer).toBe(false);
    // Aucun contournement : le seul habilité n'est pas « autorisé exceptionnellement ».
    expect(situationDeLaVersion("solo", "solo", 1).peutConfirmer).toBe(false);
  });

  it("le signalement vaut dès qu'il y a moins de deux habilités, et jamais à partir de deux", () => {
    expect(situationDeLaVersion("a", "a", 0).aucunAutreHabilite).toBe(true);
    expect(situationDeLaVersion("a", "a", 1).aucunAutreHabilite).toBe(true);
    expect(situationDeLaVersion("a", "a", 2).aucunAutreHabilite).toBe(false);
  });

  it("auteur inconnu (compte supprimé) ou visiteur non identifié : personne n'est « l'auteur »", () => {
    expect(situationDeLaVersion(null, "bob", 2).estAuteur).toBe(false);
    expect(situationDeLaVersion("alice", null, 2).estAuteur).toBe(false);
    expect(situationDeLaVersion(null, null, 2).estAuteur).toBe(false);
  });

  it("compte les habilités : gestionnaire et proprietaire_org, pas le lecteur", () => {
    expect(compterHabilites(["gestionnaire", "lecteur", "proprietaire_org", "lecteur"])).toBe(2);
    expect(compterHabilites(["lecteur", "lecteur"])).toBe(0);
    expect(compterHabilites(["proprietaire_org"])).toBe(1);
    expect(compterHabilites([])).toBe(0);
  });
});

describe("comparaison des jeux de coordonnées", () => {
  it("identiques : des espaces en trop, un champ vide contre un champ absent, un autre ordre de moyens", () => {
    expect(memesCoordonnees(jeu(), jeu({ titulaire: "  Syndicat  " }))).toBe(true);
    expect(memesCoordonnees(jeu({ bic: "" }), jeu({ bic: "   " }))).toBe(true);
    expect(memesCoordonnees(jeu({ moyens: ["wave", "virement"] }), jeu({ moyens: ["virement", "wave"] }))).toBe(true);
  });

  it("différents : chaque champ compte, y compris un numéro marchand et un moyen", () => {
    const base = jeu();
    for (const autre of [
      jeu({ titulaire: "Autre" }),
      jeu({ banque: "Autre" }),
      jeu({ numero: "SN99" }),
      jeu({ bic: "ZZZZSNDA" }),
      jeu({ moyens: ["wave"] }),
      jeu({ marchands: { wave: "779999999" } }),
      jeu({ marchands: {} }),
    ]) {
      expect(memesCoordonnees(base, autre)).toBe(false);
    }
  });

  it("l'instantané met les champs vides à nul et garde la forme du journal", () => {
    expect(instantaneCoordonnees(jeu({ titulaire: "", bic: " " }))).toEqual({
      compte_titulaire: null,
      compte_banque: "Banque",
      compte_numero: "SN08 0000 1111 2222",
      compte_bic: null,
      moyens_paiement_acceptes: ["wave", "virement"],
      numeros_marchands: { wave: "770000000" },
    });
  });
});

describe("le tableau de bord décrit une modification en attente sans réafficher les numéros", () => {
  it("avant = en vigueur, après = proposé, numéro de compte et numéros marchands masqués", () => {
    const d = decrireModification({
      id: "v1",
      cree_le: "2026-10-01T09:30:00Z",
      acteur_libelle: "alice@example.com",
      action: "coordonnees_paiement_proposees",
      avant: instantaneCoordonnees(jeu()),
      apres: instantaneCoordonnees(jeu({ numero: "SN99 9999 8888 7777", marchands: { wave: "779999999" } })),
    })!;
    expect(d.action).toBe("coordonnees_paiement_proposees");
    expect(d.acteur).toBe("alice@example.com");
    expect(d.changements.map((c) => c.champ)).toEqual(["compte_numero", "numeros_marchands"]);
    expect(JSON.stringify(d)).not.toMatch(/SN08|SN99|9999 8888|770000000|779999999/);
  });

  it("les actions de la double validation sont décrites ; une action inconnue ne l'est pas", () => {
    const ligne = (action: string) => ({
      id: "x",
      cree_le: "2026-10-01T09:30:00Z",
      acteur_libelle: null,
      action,
      avant: instantaneCoordonnees(jeu()),
      apres: instantaneCoordonnees(jeu({ banque: "Autre" })),
    });
    for (const action of ["coordonnees_paiement_proposees", "coordonnees_paiement_refusees", "coordonnees_paiement_modifiees"]) {
      expect(decrireModification(ligne(action))?.changements).toHaveLength(1);
    }
    expect(decrireModification(ligne("autre"))).toBeNull();
  });
});
