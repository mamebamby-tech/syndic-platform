import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { createFormatter } from "next-intl";
import { formats, FUSEAU } from "@/i18n/formats";
import {
  LANGUE_OPPOSABLE,
  LANGUE_PAR_DEFAUT,
  LANGUES,
  localeDe,
  normaliserLangue,
} from "@/lib/i18n/config";
import { outilsDocument, versionDocument, VERSION_OPPOSABLE } from "@/lib/i18n/document";
import { chargerMessages } from "@/lib/i18n/messages";
import { GABARITS_BROUILLON, rendreNotification } from "@/lib/notifications/gabarits";
import { libelleDevise, premierDuMois, valeursDe } from "@/lib/i18n/valeurs";

// Tests sans base de données : la préparation au multilingue ne livre que la
// structure et le français, et ces tests gardent ce périmètre en place.

// Intl sépare les milliers par des espaces insécables (U+00A0, U+202F) :
// on les ramène à une espace ordinaire pour comparer lisiblement.
const lisible = (texte: string) => texte.replace(/[  ]/g, " ");

function feuilles(arbre: unknown, chemin = ""): [string, string][] {
  if (typeof arbre === "string") return [[chemin, arbre]];
  if (arbre && typeof arbre === "object") {
    return Object.entries(arbre).flatMap(([cle, valeur]) =>
      feuilles(valeur, chemin ? `${chemin}.${cle}` : cle),
    );
  }
  return [];
}

const lire = (fichier: string) =>
  JSON.parse(readFileSync(`messages/${fichier}.json`, "utf8")) as unknown;

describe("configuration des langues", () => {
  it("le français est la langue par défaut et la seule opposable", () => {
    expect(LANGUE_PAR_DEFAUT).toBe("fr");
    expect(LANGUE_OPPOSABLE).toBe("fr");
  });

  it("l'anglais se formate en anglais britannique, pas en anglais sans région", () => {
    expect(localeDe("fr")).toBe("fr");
    expect(localeDe("en")).toBe("en-GB");
  });

  it("une valeur inconnue, vide ou mal formée retombe sur le français", () => {
    expect(normaliserLangue("en")).toBe("en");
    expect(normaliserLangue("xx")).toBe("fr");
    expect(normaliserLangue("")).toBe("fr");
    expect(normaliserLangue(null)).toBe("fr");
    expect(normaliserLangue(undefined)).toBe("fr");
  });
});

describe("messages", () => {
  it("chaque message de fr.json est une syntaxe ICU valide", () => {
    const messages = feuilles(lire("fr"));
    expect(messages.length).toBeGreaterThan(100);
    for (const [cle, texte] of messages) {
      expect(() => new IntlMessageFormat(texte, "fr", formats), cle).not.toThrow();
    }
  });

  it("en.json ne contient que des clés qui existent en français, et rien d'autre pour l'instant", () => {
    const francais = new Set(feuilles(lire("fr")).map(([cle]) => cle));
    const anglais = feuilles(lire("en"));
    expect(anglais).toEqual([]);
    for (const [cle] of anglais) expect(francais.has(cle), cle).toBe(true);
  });

  it("une langue non traduite s'affiche en français, jamais en clés brutes", async () => {
    const [fr, en] = await Promise.all([chargerMessages("fr"), chargerMessages("en")]);
    expect(en).toEqual(fr);
  });

  it("les langues offertes ont un fichier de messages", () => {
    for (const langue of LANGUES) expect(() => lire(langue)).not.toThrow();
  });
});

describe("formatage par locale — XOF stocké, FCFA affiché en français, sans conversion", () => {
  const valeurs = (langue: "fr" | "en") => {
    const locale = localeDe(langue);
    return valeursDe(createFormatter({ locale, formats, timeZone: FUSEAU }), locale);
  };

  it("affiche FCFA en français, XOF en anglais", () => {
    expect(lisible(valeurs("fr").montant(1234567))).toBe("1 234 567 FCFA");
    expect(lisible(valeurs("en").montant(1234567))).toBe("XOF 1,234,567");
    expect(libelleDevise("fr")).toBe("FCFA");
    expect(libelleDevise("en-GB")).toBe("XOF");
  });

  it("ne convertit rien : la valeur affichée est la valeur stockée", () => {
    for (const langue of ["fr", "en"] as const) {
      const chiffres = valeurs(langue).montant(2500000).replace(/\D/g, "");
      expect(chiffres).toBe("2500000");
    }
  });

  it("n'affiche pas de décimale même sur un montant numeric(14,2)", () => {
    expect(lisible(valeurs("fr").montant(1000))).toBe("1 000 FCFA");
    expect(lisible(valeurs("fr").montant(1000.4))).toBe("1 000 FCFA");
  });

  it("n'affiche jamais « XOF » à un lecteur français", () => {
    for (const montant of [0, 1, 999, 1000, 1234567.89, -500]) {
      expect(valeurs("fr").montant(montant)).not.toContain("XOF");
      expect(valeurs("fr").montant(montant)).toContain("FCFA");
    }
  });

  it("formate les quotes-parts en pourcentage à deux décimales", () => {
    const format = (langue: "fr" | "en") =>
      createFormatter({ locale: localeDe(langue), formats, timeZone: FUSEAU });
    expect(lisible(format("fr").number(0.3946, "pourcentage"))).toBe("39,46 %");
    expect(format("en").number(0.3946, "pourcentage")).toBe("39.46%");
  });
});

describe("dates juridiques et financières — mois en toutes lettres", () => {
  const valeurs = (langue: "fr" | "en") => {
    const locale = localeDe(langue);
    return valeursDe(createFormatter({ locale, formats, timeZone: FUSEAU }), locale);
  };

  it("écrit 1 October 2026 en anglais britannique, 1er octobre 2026 en français", () => {
    expect(valeurs("en").dateJuridique("2026-10-01")).toBe("1 October 2026");
    expect(valeurs("fr").dateJuridique("2026-10-01")).toBe("1er octobre 2026");
  });

  it("le premier du mois s'écrit « 1er » en français, et lui seul", () => {
    const fr = valeurs("fr");
    const attendus: [string, string][] = [
      ["2026-01-01", "1er janvier 2026"],
      ["2026-02-01", "1er février 2026"],
      ["2026-12-01", "1er décembre 2026"],
      ["2026-10-02", "2 octobre 2026"],
      ["2026-10-10", "10 octobre 2026"],
      ["2026-10-11", "11 octobre 2026"],
      ["2026-10-21", "21 octobre 2026"],
      ["2026-10-31", "31 octobre 2026"],
    ];
    for (const [date, attendu] of attendus) expect(fr.dateJuridique(date), date).toBe(attendu);
  });

  it("le premier du mois s'écrit aussi « 1er » sur la forme abrégée", () => {
    expect(valeurs("fr").dateCourte("2026-10-01")).toBe("1er oct. 2026");
    expect(valeurs("fr").dateCourte("2026-10-21")).toBe("21 oct. 2026");
    expect(valeurs("fr").dateCourte("2026-10-11")).toBe("11 oct. 2026");
  });

  it("l'anglais ne reçoit jamais « 1er » ni « 1st »", () => {
    expect(valeurs("en").dateJuridique("2026-10-01")).toBe("1 October 2026");
    expect(valeurs("en").dateCourte("2026-10-01")).toBe("1 Oct 2026");
    expect(premierDuMois("1 October 2026", "en-GB")).toBe("1 October 2026");
  });

  it("premierDuMois ne touche qu'un « 1 » isolé en début de texte", () => {
    expect(premierDuMois("1 octobre 2026", "fr")).toBe("1er octobre 2026");
    expect(premierDuMois("1\u00a0octobre 2026", "fr")).toBe("1er\u00a0octobre 2026");
    expect(premierDuMois("11 octobre 2026", "fr")).toBe("11 octobre 2026");
    expect(premierDuMois("31 octobre 2026", "fr")).toBe("31 octobre 2026");
    expect(premierDuMois("le 1 octobre", "fr")).toBe("le 1 octobre");
    expect(premierDuMois("10 octobre 1 2026", "fr")).toBe("10 octobre 1 2026");
    expect(premierDuMois("1 octobre 2026", "fr-FR")).toBe("1er octobre 2026");
  });

  it("accepte un instant ISO complet comme une date de calendrier", () => {
    expect(valeurs("fr").dateCourte("2026-10-01T00:00:00+00:00")).toBe("1er oct. 2026");
  });

  it("ne produit jamais de date numérique, quelle que soit la date, la langue ou la forme", () => {
    for (const langue of ["fr", "en"] as const) {
      for (const jour of ["2026-01-02", "2026-10-01", "2026-12-31", "2027-03-04"]) {
        for (const rendu of [valeurs(langue).dateJuridique(jour), valeurs(langue).dateCourte(jour)]) {
          expect(rendu, `${langue} ${jour}`).not.toMatch(/\d+\s*[/.-]\s*\d+/);
          expect(rendu, `${langue} ${jour}`).toMatch(/[A-Za-zÀ-ÿ]{3,}/);
        }
      }
    }
  });

  it("ne décale pas d'un jour : une date de calendrier reste la même partout", () => {
    expect(valeurs("en").dateJuridique("2026-12-31")).toBe("31 December 2026");
    expect(valeurs("fr").dateJuridique("2026-12-31")).toBe("31 décembre 2026");
  });

  it("les seuls formats de date existants ont le mois en lettres", () => {
    expect(Object.keys(formats.dateTime).sort()).toEqual(["dateJuridique", "dateJuridiqueCourte"]);
    for (const format of Object.values(formats.dateTime)) {
      expect(["long", "short"]).toContain(format.month);
    }
  });

  it("aucun code source n'affiche une date ou un montant autrement que par valeurs.ts", () => {
    const motifs = [
      /toLocaleDateString|toLocaleTimeString|toLocaleString\(/,
      /dateStyle|timeStyle/,
      /month:\s*["'](numeric|2-digit)["']/,
      /Intl\.DateTimeFormat/,
    ];
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.(ts|tsx)$/.test(nom)) fichiers.push(chemin);
      }
    };
    for (const dossier of ["app", "components", "lib", "i18n"]) parcourir(dossier);
    expect(fichiers.length).toBeGreaterThan(20);

    for (const fichier of fichiers) {
      const source = readFileSync(fichier, "utf8")
        .split("\n")
        .filter((ligne) => !ligne.trim().startsWith("//"))
        .join("\n");
      for (const motif of motifs) expect(source, `${fichier} ${motif}`).not.toMatch(motif);

      // Le format monétaire brut ne sort jamais du module qui le corrige :
      // ailleurs, il afficherait « XOF » à un lecteur français.
      if (fichier !== join("lib", "i18n", "valeurs.ts")) {
        expect(source, `${fichier} : montant brut`).not.toMatch(/["']xof["']/);
        expect(source, `${fichier} : date brute`).not.toMatch(/dateTime\([^)]*["']dateJuridique/);
      }
    }

    // Les gabarits n'emploient aucun format ICU de nombre monétaire ou de date :
    // montants et dates leur arrivent déjà en mots.
    for (const [cle, texte] of feuilles(lire("fr"))) {
      expect(texte, cle).not.toMatch(/\{\w+,\s*(date|time)\b/);
      expect(texte, cle).not.toMatch(/\{\w+,\s*number,\s*xof\}/);
    }
  });
});

describe("documents juridiques — le français reste la seule version opposable", () => {
  const appel = { montant: 1234567, date: new Date("2026-10-01") };

  it("la version par défaut est le français, opposable", () => {
    expect(VERSION_OPPOSABLE).toEqual({ langue: "fr", opposable: true });
  });

  it("le statut opposable se dérive de la langue : toute autre langue est de courtoisie", () => {
    expect(versionDocument("fr").opposable).toBe(true);
    expect(versionDocument("en").opposable).toBe(false);
  });

  it("rend le document en français, quelle que soit la langue de la personne", async () => {
    // La personne lit l'interface en anglais : le document, lui, est chargé
    // pour SA version. Rien ici ne lit la langue de la personne.
    const messages = (await chargerMessages("fr")).Documents;
    const { t, valeurs } = outilsDocument({ version: VERSION_OPPOSABLE, messages });
    expect(t("Appel.titre", { periode: "T4 2026" })).toBe("Appel de fonds — T4 2026");
    expect(lisible(valeurs.montant(appel.montant))).toBe("1 234 567 FCFA");
    expect(valeurs.dateJuridique(appel.date)).toBe("1er octobre 2026");
  });

  it("le bloc Modalités de règlement a tous ses textes, y compris les emplacements à renseigner", async () => {
    const messages = (await chargerMessages("fr")).Documents;
    const { t } = outilsDocument({ version: VERSION_OPPOSABLE, messages });
    expect(t("Appel.reglement.titre")).toBe("Modalités de règlement");
    expect(t("Appel.reglement.compteARenseigner")).toBe("Coordonnées bancaires à renseigner");
    expect(t("Appel.reglement.moyensARenseigner")).toBe("Moyens de règlement à renseigner");
    expect(t("Appel.reglement.reference")).toBe("Référence à rappeler");
    for (const moyen of ["wave", "orange_money", "virement", "virement_international", "especes", "cheque"] as const) {
      expect(t(`moyens.${moyen}`), moyen).not.toBe("");
    }
  });

  it("la mention de non-opposabilité existe pour les versions de courtoisie", async () => {
    const messages = (await chargerMessages("fr")).Documents;
    const { t } = outilsDocument({ version: versionDocument("en"), messages });
    expect(t("mentions.courtoisie")).toMatch(/non opposable/);
    expect(t("mentions.courtoisie")).toMatch(/version française fait foi/);
  });
});

describe("gabarits de notification — la langue du destinataire", () => {
  const chargeUtile = {
    cabinet: "ENIGMA AFRICA SARL",
    reference: "AF-2026-T4-001",
    periode: "T4 2026",
    montant: 1234567,
    echeance: "2026-10-01",
  };

  it("courriel en français : objet, corps, montant XOF et date au format français", async () => {
    const rendu = await rendreNotification({
      gabarit: "appel_emis",
      canal: "email",
      langue: "fr",
      chargeUtile,
    });
    expect(rendu.sujet).toBe("Appel de fonds AF-2026-T4-001 — T4 2026");
    expect(lisible(rendu.corps)).toContain("Montant appelé : 1 234 567 FCFA");
    expect(rendu.corps).toContain("Échéance : 1er octobre 2026");
    expect(rendu.corps).toContain("ENIGMA AFRICA SARL");
  });

  it("WhatsApp : pas d'objet, corps court", async () => {
    const rendu = await rendreNotification({
      gabarit: "appel_emis",
      canal: "whatsapp",
      langue: "fr",
      chargeUtile,
    });
    expect(rendu.sujet).toBeUndefined();
    expect(lisible(rendu.corps)).toContain("Montant : 1 234 567 FCFA, échéance le 1er octobre 2026");
  });

  it("ne cite jamais le nom du produit", async () => {
    const { nom } = await import("@/lib/marque");
    const rendu = await rendreNotification({
      gabarit: "appel_emis",
      canal: "email",
      langue: "fr",
      chargeUtile,
    });
    expect(rendu.corps).not.toContain(nom);
    expect(rendu.sujet).not.toContain(nom);
  });

  it("suit la langue du destinataire pour les formats, même avant toute traduction", async () => {
    const rendu = await rendreNotification({
      gabarit: "appel_emis",
      canal: "email",
      langue: "en",
      chargeUtile,
    });
    // Texte : repli sur le français (en.json est vide). Formats : ceux de
    // la locale du destinataire (en-GB) : la date s'écrit « 1 October 2026 »,
    // jamais 10/01/2026 ; la devise reste XOF (FCFA est un usage français),
    // la valeur ne change pas.
    expect(lisible(rendu.corps)).toContain("Montant appelé : XOF 1,234,567");
    expect(rendu.corps).toContain("Échéance : 1 October 2026");
  });

  it("est marqué brouillon tant que le cabinet n'a pas validé le texte", async () => {
    // Retirer `appel_emis` de GABARITS_BROUILLON est le geste qui consigne la
    // relecture du cabinet : ce test échoue alors, et doit être changé en
    // connaissance de cause.
    expect(GABARITS_BROUILLON.has("appel_emis")).toBe(true);
    for (const canal of ["email", "whatsapp"] as const) {
      const rendu = await rendreNotification({
        gabarit: "appel_emis",
        canal,
        langue: "fr",
        chargeUtile,
      });
      expect(rendu.brouillon, canal).toBe(true);
    }
  });

  it("une langue inconnue ou absente retombe sur le français", async () => {
    for (const langue of ["xx", null, ""]) {
      const rendu = await rendreNotification({
        gabarit: "appel_emis",
        canal: "email",
        langue,
        chargeUtile,
      });
      expect(rendu.sujet).toBe("Appel de fonds AF-2026-T4-001 — T4 2026");
      expect(lisible(rendu.corps)).toContain("1 234 567 FCFA");
    }
  });
});
