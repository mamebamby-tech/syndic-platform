import { describe, expect, it } from "vitest";
import { formaterExpediteur } from "@/lib/courriel/expediteur";
import { nom } from "@/lib/marque";

// L'expéditeur affiché est le cabinet ; Coprane seulement en repli (décision 68).
const ADRESSE = "syndic@messages.coprane.com";

describe("expéditeur des courriels", () => {
  it("affiche le nom du cabinet, à l'adresse technique de la plateforme", () => {
    expect(formaterExpediteur("ENIGMA AFRICA SARL", ADRESSE)).toBe('"ENIGMA AFRICA SARL" <syndic@messages.coprane.com>');
  });

  it("se replie sur le nom du produit si le nom du cabinet manque", () => {
    for (const absent of [null, undefined, "", "   "]) {
      expect(formaterExpediteur(absent, ADRESSE)).toBe(`"${nom}" <${ADRESSE}>`);
    }
    expect(nom).toBe("Coprane");
  });

  it("un nom avec virgule ou guillemets reste un seul nom affiché", () => {
    expect(formaterExpediteur('Cabinet "Teranga", Syndic', ADRESSE)).toBe('"Cabinet \\"Teranga\\", Syndic" <syndic@messages.coprane.com>');
  });

  it("un retour à la ligne dans le nom ne peut pas injecter d'en-tête", () => {
    const e = formaterExpediteur("Cabinet\r\nBcc: tous@exemple.sn", ADRESSE);
    expect(e).not.toMatch(/[\r\n]/);
    expect(e).toBe('"Cabinet Bcc: tous@exemple.sn" <syndic@messages.coprane.com>');
  });
});
