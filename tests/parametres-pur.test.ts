import { describe, expect, it } from "vitest";
import { sansMentionGroupe } from "@/lib/data/nom-groupe";
import {
  decrireModification,
  masquer,
  type LigneJournal,
} from "@/lib/parametres/journal";
import {
  codePeriode,
  codeReferenceValide,
  formatReferenceValide,
  rendreReference,
} from "@/lib/parametres/reference";
import {
  compteIncomplet,
  MOYENS_OFFERTS,
  validerParametres,
  type SaisieParametres,
} from "@/lib/parametres/validation";

// Logique pure des paramètres de l'immeuble : sans base de données. Le miroir
// avec les contraintes de la base est vérifié dans parametres-immeuble.test.ts.

const saisie = (surcharge: Partial<SaisieParametres> = {}): SaisieParametres => ({
  titulaire: "Syndicat de test",
  banque: "Banque de test",
  numero: "SN08 0000 1111 2222",
  bic: "",
  moyens: [],
  marchands: { wave: "", orange_money: "" },
  codeReference: "MT",
  formatReference: "{code}-{annee}{periode}-{seq}",
  ...surcharge,
});

describe("référence — rendu", () => {
  it("rend MT-2026T4-007 avec le format par défaut", () => {
    expect(
      rendreReference("{code}-{annee}{periode}-{seq}", { code: "MT", annee: 2026, periode: "T4", seq: 7 }),
    ).toBe("MT-2026T4-007");
  });

  it("le numéro d'ordre a au moins trois chiffres, et davantage au-delà de 999", () => {
    const rendre = (seq: number) => rendreReference("{seq}", { code: "X", annee: 2026, periode: "T1", seq });
    expect(rendre(1)).toBe("001");
    expect(rendre(48)).toBe("048");
    expect(rendre(999)).toBe("999");
    expect(rendre(1000)).toBe("1000");
  });

  it("un gabarit personnalisé, ou un jeton répété", () => {
    expect(rendreReference("TOUR-{annee}-{seq}", { code: "MT", annee: 2027, periode: "T1", seq: 12 })).toBe(
      "TOUR-2027-012",
    );
    expect(rendreReference("{code}{code}-{seq}", { code: "AB", annee: 2027, periode: "A", seq: 1 })).toBe("ABAB-001");
  });

  it("un exemple valide ne contient jamais d'espace", () => {
    const format = "{code}-{annee}{periode}-{seq}";
    expect(formatReferenceValide(format)).toBe(true);
    expect(rendreReference(format, { code: "MT", annee: 2026, periode: "T4", seq: 7 })).not.toMatch(/\s/);
  });

  it("code de période : T pour trimestriel, M pour mensuel, S, A", () => {
    expect(codePeriode("trimestriel", 10)).toBe("T4");
    expect(codePeriode("trimestriel", 1)).toBe("T1");
    expect(codePeriode("trimestriel", 3)).toBe("T1");
    expect(codePeriode("trimestriel", 4)).toBe("T2");
    expect(codePeriode("mensuel", 3)).toBe("M03");
    expect(codePeriode("mensuel", 12)).toBe("M12");
    expect(codePeriode("semestriel", 6)).toBe("S1");
    expect(codePeriode("semestriel", 7)).toBe("S2");
    expect(codePeriode("annuel", 5)).toBe("A");
  });
});

describe("référence — validité du gabarit et du code", () => {
  it("accepte un gabarit avec {seq} et des caractères dictables", () => {
    for (const ok of ["{seq}", "{code}-{seq}", "TOUR_{annee}-{seq}", "{code}{annee}{periode}{seq}"]) {
      expect(formatReferenceValide(ok), ok).toBe(true);
    }
  });

  it("refuse : sans {seq}, avec espace, jeton inconnu, caractère spécial", () => {
    for (const ko of ["{code}-{annee}", "{code} {seq}", "{code}-{seq}-{uuid}", "{seq}/{annee}", "{seq}!", "", "é{seq}"]) {
      expect(formatReferenceValide(ko), ko).toBe(false);
    }
  });

  it("le code de l'immeuble : 1 à 8 lettres majuscules ou chiffres", () => {
    for (const ok of ["MT", "A", "ABCDEFGH", "M1"]) expect(codeReferenceValide(ok), ok).toBe(true);
    for (const ko of ["", "mt", "ABCDEFGHI", "M T", "M-T", "É"]) expect(codeReferenceValide(ko), ko).toBe(false);
  });
});

describe("validation des paramètres", () => {
  it("accepte une saisie complète et normalise les valeurs", () => {
    const { valeurs, erreurs } = validerParametres(
      saisie({
        titulaire: "  Syndicat  ",
        codeReference: " mt ",
        moyens: ["virement", "wave"],
        marchands: { wave: " 77 000 00 00 ", orange_money: "780000000" },
      }),
    );
    expect(erreurs).toEqual({});
    expect(valeurs?.compte_titulaire).toBe("Syndicat");
    expect(valeurs?.code_reference).toBe("MT");
    // Ordre canonique des moyens, indépendant de l'ordre de saisie.
    expect(valeurs?.moyens_paiement_acceptes).toEqual(["wave", "virement"]);
    // Le numéro Orange Money est écarté : le moyen n'est pas accepté.
    expect(valeurs?.numeros_marchands).toEqual({ wave: "77 000 00 00" });
  });

  it("un champ vide ou blanc devient null (absent), jamais une chaîne vide", () => {
    const { valeurs } = validerParametres(saisie({ titulaire: "   ", banque: "", numero: "" }));
    expect(valeurs?.compte_titulaire).toBeNull();
    expect(valeurs?.compte_banque).toBeNull();
    expect(valeurs?.compte_numero).toBeNull();
    expect(valeurs?.compte_bic).toBeNull();
  });

  it("le code SWIFT se saisit avec des espaces et en minuscules : normalisé en capitales", () => {
    expect(validerParametres(saisie({ bic: "abcd sn da" })).valeurs?.compte_bic).toBe("ABCDSNDA");
    expect(validerParametres(saisie({ bic: "ABCDSNDAXXX" })).valeurs?.compte_bic).toBe("ABCDSNDAXXX");
  });

  it("refuse un code SWIFT de mauvaise longueur ou avec des caractères spéciaux", () => {
    for (const bic of ["abc", "ABCDEFG", "ABCDEFGHI", "ABCDEFGHIJ", "ABCDSND!"]) {
      const { valeurs, erreurs } = validerParametres(saisie({ bic }));
      expect(valeurs, bic).toBeNull();
      expect(erreurs.bic, bic).toBe("bic_invalide");
    }
  });

  it("les virements internationaux exigent un code SWIFT", () => {
    const sans = validerParametres(saisie({ moyens: ["virement_international"], bic: "" }));
    expect(sans.valeurs).toBeNull();
    expect(sans.erreurs.bic).toBe("swift_requis");
    const avec = validerParametres(saisie({ moyens: ["virement_international"], bic: "ABCDSNDA" }));
    expect(avec.erreurs).toEqual({});
    // Un virement simple n'en exige pas.
    expect(validerParametres(saisie({ moyens: ["virement"], bic: "" })).erreurs).toEqual({});
  });

  it("un SWIFT mal formé prime sur « SWIFT requis » : une seule erreur, la bonne", () => {
    const r = validerParametres(saisie({ moyens: ["virement_international"], bic: "abc" }));
    expect(r.erreurs.bic).toBe("bic_invalide");
  });

  it("refuse un moyen de paiement inconnu ; le chèque n'est pas offert", () => {
    expect(validerParametres(saisie({ moyens: ["bitcoin"] })).erreurs.moyens).toBe("moyen_inconnu");
    expect(validerParametres(saisie({ moyens: ["cheque"] })).erreurs.moyens).toBe("moyen_inconnu");
    expect([...MOYENS_OFFERTS]).toEqual(["wave", "orange_money", "virement", "virement_international", "especes"]);
  });

  it("décocher un moyen mobile efface son numéro marchand (pas de donnée orpheline)", () => {
    const r = validerParametres(
      saisie({ moyens: ["virement"], marchands: { wave: "770000000", orange_money: "780000000" } }),
    );
    expect(r.valeurs?.numeros_marchands).toEqual({});
  });

  it("un numéro marchand est facultatif : moyen accepté sans numéro est valide", () => {
    const r = validerParametres(saisie({ moyens: ["wave"], marchands: { wave: "  ", orange_money: "" } }));
    expect(r.erreurs).toEqual({});
    expect(r.valeurs?.numeros_marchands).toEqual({});
  });

  it("refuse un code d'immeuble ou un format invalide, avec l'erreur du bon champ", () => {
    const r = validerParametres(saisie({ codeReference: "M T", formatReference: "{code}-{annee}" }));
    expect(r.valeurs).toBeNull();
    expect(r.erreurs.codeReference).toBe("code_invalide");
    expect(r.erreurs.formatReference).toBe("format_invalide");
  });

  it("cumule plusieurs erreurs plutôt que de s'arrêter à la première", () => {
    const r = validerParametres(
      saisie({ bic: "x", moyens: ["bitcoin"], codeReference: "", formatReference: "" }),
    );
    expect(Object.keys(r.erreurs).sort()).toEqual(["bic", "codeReference", "formatReference", "moyens"]);
  });

  it("compte incomplet : signalé quand 1 ou 2 champs sur 3 sont remplis, pas quand 0 ou 3", () => {
    const base = { compte_titulaire: null, compte_banque: null, compte_numero: null };
    expect(compteIncomplet(base)).toBe(false);
    expect(compteIncomplet({ ...base, compte_titulaire: "T" })).toBe(true);
    expect(compteIncomplet({ ...base, compte_titulaire: "T", compte_banque: "B" })).toBe(true);
    expect(compteIncomplet({ compte_titulaire: "T", compte_banque: "B", compte_numero: "N" })).toBe(false);
  });
});

describe("masquer — on ne réaffiche jamais un numéro en clair", () => {
  it("garde les quatre derniers caractères", () => {
    expect(masquer("SN08 0000 1111 2222")).toBe("•••• 2222");
    expect(masquer("770000000")).toBe("•••• 0000");
    expect(masquer("12345")).toBe("•••• 2345");
  });

  it("un numéro court est masqué en entier ; null reste null", () => {
    expect(masquer("1234")).toBe("••••");
    expect(masquer("12")).toBe("••••");
    expect(masquer(null)).toBeNull();
  });

  it("le masque ne contient jamais le début du numéro", () => {
    expect(masquer("SN08 0000 1111 2222")).not.toMatch(/SN08|0000|1111/);
  });
});

describe("description d'une ligne de journal", () => {
  const vide = {
    compte_titulaire: null,
    compte_banque: null,
    compte_numero: null,
    compte_bic: null,
    moyens_paiement_acceptes: [],
    numeros_marchands: {},
  };
  const ligne = (surcharge: Partial<LigneJournal>): LigneJournal => ({
    id: "j1",
    cree_le: "2026-10-01T09:30:00Z",
    acteur_libelle: "gestionnaire@example.com",
    action: "coordonnees_paiement_modifiees",
    avant: vide,
    apres: vide,
    ...surcharge,
  });

  it("première saisie : rien n'était renseigné avant", () => {
    const d = decrireModification(
      ligne({ apres: { ...vide, compte_titulaire: "Syndicat", compte_numero: "SN08 0000 1111 2222" } }),
    )!;
    expect(d.premiereSaisie).toBe(true);
    expect(d.acteur).toBe("gestionnaire@example.com");
    expect(d.changements.map((c) => c.champ)).toEqual(["compte_titulaire", "compte_numero"]);
  });

  it("insertion : avant nul est aussi une première saisie", () => {
    expect(decrireModification(ligne({ avant: null, apres: { ...vide, compte_banque: "B" } }))!.premiereSaisie).toBe(
      true,
    );
  });

  it("le numéro de compte n'apparaît JAMAIS en clair, ni avant ni après", () => {
    const d = decrireModification(
      ligne({
        avant: { ...vide, compte_titulaire: "T", compte_numero: "SN08 0000 1111 2222" },
        apres: { ...vide, compte_titulaire: "T", compte_numero: "SN99 9999 8888 7777" },
      }),
    )!;
    expect(d.premiereSaisie).toBe(false);
    const c = d.changements.find((x) => x.champ === "compte_numero")!;
    expect(c.nature).toBe("secret");
    expect(c.avant).toBe("•••• 2222");
    expect(c.apres).toBe("•••• 7777");
    expect(JSON.stringify(d)).not.toMatch(/SN08|SN99|9999|8888|1111/);
  });

  it("les numéros marchands sont masqués aussi", () => {
    const d = decrireModification(
      ligne({
        avant: { ...vide, moyens_paiement_acceptes: ["wave"], numeros_marchands: { wave: "770000001" } },
        apres: { ...vide, moyens_paiement_acceptes: ["wave"], numeros_marchands: { wave: "779999999" } },
      }),
    )!;
    const c = d.changements.find((x) => x.champ === "numeros_marchands")!;
    expect(c.avant).toEqual({ wave: "•••• 0001" });
    expect(c.apres).toEqual({ wave: "•••• 9999" });
    expect(JSON.stringify(d)).not.toContain("77000");
  });

  it("ne liste que ce qui a changé", () => {
    const d = decrireModification(
      ligne({
        avant: { ...vide, compte_titulaire: "T", compte_banque: "Ancienne" },
        apres: { ...vide, compte_titulaire: "T", compte_banque: "Nouvelle" },
      }),
    )!;
    expect(d.changements).toEqual([
      { champ: "compte_banque", nature: "texte", avant: "Ancienne", apres: "Nouvelle" },
    ]);
  });

  it("les moyens acceptés : liste avant et après", () => {
    const d = decrireModification(
      ligne({
        avant: { ...vide, compte_titulaire: "T", moyens_paiement_acceptes: ["virement"] },
        apres: { ...vide, compte_titulaire: "T", moyens_paiement_acceptes: ["virement", "wave"] },
      }),
    )!;
    expect(d.changements).toEqual([
      { champ: "moyens_paiement_acceptes", nature: "moyens", avant: ["virement"], apres: ["virement", "wave"] },
    ]);
  });

  it("l'auteur inconnu (modification hors session) reste nul, sans planter", () => {
    expect(decrireModification(ligne({ acteur_libelle: null }))!.acteur).toBeNull();
  });

  it("le format de la référence : tracé sous son action, en clair (ce n'est pas un secret)", () => {
    const d = decrireModification(
      ligne({
        action: "format_reference_modifie",
        avant: { code_reference: "MT", format_reference_appel: "{code}-{annee}{periode}-{seq}" },
        apres: { code_reference: "MT", format_reference_appel: "TOUR-{annee}-{seq}" },
      }),
    )!;
    expect(d.premiereSaisie).toBe(false);
    expect(d.changements).toEqual([
      {
        champ: "format_reference_appel",
        nature: "texte",
        avant: "{code}-{annee}{periode}-{seq}",
        apres: "TOUR-{annee}-{seq}",
      },
    ]);
  });

  it("une action inconnue n'est pas décrite (le tableau de bord ne plante pas)", () => {
    expect(decrireModification(ligne({ action: "autre_chose" }))).toBeNull();
  });

  it("des données de journal inattendues ne font pas planter", () => {
    expect(() => decrireModification(ligne({ avant: "n'importe quoi", apres: 42 }))).not.toThrow();
    expect(() => decrireModification(ligne({ avant: null, apres: null }))).not.toThrow();
  });
});

describe("registre — le mot « groupe » n'apparaît qu'une fois", () => {
  it("retire la mention « (groupe) » du nom stocké", () => {
    expect(sansMentionGroupe("SCI ALIZE (groupe)")).toBe("SCI ALIZE");
    expect(sansMentionGroupe("SCI ALIZE (Groupe)")).toBe("SCI ALIZE");
    expect(sansMentionGroupe("SCI ALIZE   (groupe)  ")).toBe("SCI ALIZE");
    expect(sansMentionGroupe("HOLDING (group)")).toBe("HOLDING");
  });

  it("ne touche pas un nom qui ne porte pas la mention", () => {
    expect(sansMentionGroupe("SCI ALIZE")).toBe("SCI ALIZE");
    expect(sansMentionGroupe("Groupe Horizon")).toBe("Groupe Horizon");
    expect(sansMentionGroupe("SCI (groupe) ALIZE")).toBe("SCI (groupe) ALIZE");
  });

  it("ne renvoie jamais un nom vide", () => {
    expect(sansMentionGroupe("(groupe)")).toBe("(groupe)");
    expect(sansMentionGroupe("")).toBe("");
  });

  it("avec le préfixe de l'écran, le mot est écrit une seule fois", () => {
    const affiche = `groupe ${sansMentionGroupe("SCI ALIZE (groupe)")}`;
    expect(affiche).toBe("groupe SCI ALIZE");
    expect(affiche.match(/groupe/gi)).toHaveLength(1);
  });
});
