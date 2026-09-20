import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  erreurDeLaBase,
  lireMontant,
  MOYENS_SAISIE,
  validerAnnulation,
  validerPaiement,
  type CodeErreurPaiement,
} from "@/lib/paiements/validation";
import fr from "@/messages/fr.json";

const AUJOURDHUI = "2031-06-15";
const valide = { appelId: "a1", montant: "150 000", moyen: "virement", date: "2031-06-10", reference: "  VIR-9  " };

describe("lireMontant — FCFA, entier, sans décimales", () => {
  it("accepte un entier, avec espaces ordinaires ou insécables", () => {
    expect(lireMontant("150000")).toBe(150000);
    expect(lireMontant("150 000")).toBe(150000);
    expect(lireMontant("150\u00a0000")).toBe(150000); // espace insécable
    expect(lireMontant("150\u202f000")).toBe(150000); // espace fine insécable
  });
  it("refuse zéro, négatif, décimales, lettres, vide, trop grand", () => {
    for (const brut of ["0", "-5", "12,5", "12.50", "1e3", "abc", "", "   ", "999 999 999 999 999"]) {
      expect(lireMontant(brut), brut).toBeNull();
    }
  });
});

describe("validerPaiement", () => {
  it("accepte une saisie complète et nettoie la référence", () => {
    const r = validerPaiement(valide, AUJOURDHUI);
    expect(r.erreurs).toEqual({});
    expect(r.valeurs).toEqual({ appelId: "a1", montant: 150000, moyen: "virement", date: "2031-06-10", reference: "VIR-9" });
  });
  it("la référence est facultative", () => {
    expect(validerPaiement({ ...valide, reference: "  " }, AUJOURDHUI).valeurs?.reference).toBeNull();
  });
  it("les cinq moyens saisis à la main, et le chèque n'en fait pas partie", () => {
    expect([...MOYENS_SAISIE]).toEqual(["virement", "virement_international", "especes", "wave", "orange_money"]);
    for (const moyen of MOYENS_SAISIE) expect(validerPaiement({ ...valide, moyen }, AUJOURDHUI).erreurs).toEqual({});
    expect(validerPaiement({ ...valide, moyen: "cheque" }, AUJOURDHUI).erreurs.moyen).toBe("moyen_invalide");
  });
  it("refuse chaque champ invalide, avec son code", () => {
    expect(validerPaiement({ ...valide, appelId: " " }, AUJOURDHUI).erreurs.appel).toBe("appel_requis");
    expect(validerPaiement({ ...valide, montant: "0" }, AUJOURDHUI).erreurs.montant).toBe("montant_invalide");
    expect(validerPaiement({ ...valide, date: "2031-02-30" }, AUJOURDHUI).erreurs.date).toBe("date_invalide");
    expect(validerPaiement({ ...valide, date: "15/06/2031" }, AUJOURDHUI).erreurs.date).toBe("date_invalide");
    expect(validerPaiement({ ...valide, date: "2031-06-16" }, AUJOURDHUI).erreurs.date).toBe("date_future");
    expect(validerPaiement({ ...valide, date: AUJOURDHUI }, AUJOURDHUI).erreurs).toEqual({});
    expect(validerPaiement({ ...valide, reference: "x".repeat(121) }, AUJOURDHUI).erreurs.reference).toBe("reference_trop_longue");
  });
});

describe("validerAnnulation", () => {
  it("exige un motif et un paiement", () => {
    expect(validerAnnulation({ paiementId: "p", motif: "  " }).erreurs.motif).toBe("motif_requis");
    expect(validerAnnulation({ paiementId: " ", motif: "x" }).erreurs.paiement).toBe("paiement_requis");
    expect(validerAnnulation({ paiementId: "p", motif: "x".repeat(501) }).erreurs.motif).toBe("motif_trop_long");
    expect(validerAnnulation({ paiementId: "p", motif: " Doublon " }).valeurs).toEqual({ paiementId: "p", motif: "Doublon" });
  });
});

describe("erreurDeLaBase — les codes de la migration", () => {
  it("chaque code PA0xx et l'accès refusé ont leur message", () => {
    expect(erreurDeLaBase({ code: "PA002" })).toEqual({ montant: "depasse_reste_du" });
    expect(erreurDeLaBase({ code: "PA001" })).toEqual({ appel: "appel_non_payable" });
    expect(erreurDeLaBase({ code: "PA005" })).toEqual({ paiement: "deja_annule" });
    expect(erreurDeLaBase({ code: "42501" })).toEqual({ general: "acces_refuse" });
  });
  it("une erreur inconnue n'est jamais présentée comme un succès ni détaillée", () => {
    expect(erreurDeLaBase({ code: "XX000" })).toEqual({ general: "enregistrement_impossible" });
    expect(erreurDeLaBase({})).toEqual({ general: "enregistrement_impossible" });
  });
});

describe("messages", () => {
  const codes: CodeErreurPaiement[] = [
    "appel_requis", "montant_invalide", "moyen_invalide", "date_invalide", "date_future", "reference_trop_longue",
    "paiement_requis", "motif_requis", "motif_trop_long", "appel_non_payable", "depasse_reste_du", "deja_annule",
    "non_annulable", "destinataire_different", "acces_refuse", "enregistrement_impossible",
  ];
  it("chaque code d'erreur a un message en français", () => {
    const messages = fr.Paiements.erreurs as Record<string, string>;
    for (const code of codes) expect(messages[code], code).toBeTruthy();
    expect(Object.keys(messages).sort()).toEqual([...codes].sort());
  });
});

describe("l'application n'écrit jamais dans paiements directement", () => {
  // Les utilisateurs n'ont plus aucun droit d'écriture sur la table : seules les deux
  // fonctions de la base écrivent. Un code qui essaierait échouerait à l'exécution ; ce test
  // l'empêche dès l'écriture.
  const fichiers = (dossier: string): string[] =>
    readdirSync(dossier).flatMap((nom) => {
      const chemin = join(dossier, nom);
      if (nom === "node_modules" || nom === ".next") return [];
      return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
    });

  it("aucun .from('paiements') suivi d'une écriture", () => {
    for (const dossier of ["app", "lib", "components"]) {
      for (const fichier of fichiers(dossier)) {
        const code = readFileSync(fichier, "utf8");
        expect(code, fichier).not.toMatch(/from\(\s*["']paiements["']\s*\)\s*\.\s*(insert|update|upsert|delete)/);
      }
    }
  });

  it("l'action passe par les deux fonctions de la base", () => {
    const actions = readFileSync("app/immeubles/[immeubleId]/proprietaires/[proprietaireId]/actions.ts", "utf8");
    expect(actions).toMatch(/rpc\("enregistrer_paiement"/);
    expect(actions).toMatch(/rpc\("annuler_paiement"/);
  });
});
