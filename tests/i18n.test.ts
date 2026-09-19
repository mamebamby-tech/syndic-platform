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

describe("formatage par locale — la devise reste XOF, sans conversion", () => {
  const format = (langue: "fr" | "en") =>
    createFormatter({ locale: localeDe(langue), formats, timeZone: FUSEAU });

  it("affiche le code XOF, sans décimale, dans toutes les langues", () => {
    expect(lisible(format("fr").number(1234567, "xof"))).toBe("1 234 567 XOF");
    expect(lisible(format("en").number(1234567, "xof"))).toBe("XOF 1,234,567");
  });

  it("ne convertit rien : la valeur affichée est la valeur stockée", () => {
    for (const langue of ["fr", "en"] as const) {
      const chiffres = format(langue).number(2500000, "xof").replace(/\D/g, "");
      expect(chiffres).toBe("2500000");
    }
  });

  it("n'affiche pas de décimale même sur un montant numeric(14,2)", () => {
    expect(lisible(format("fr").number(1000, "xof"))).toBe("1 000 XOF");
  });

  it("formate les quotes-parts en pourcentage à deux décimales", () => {
    expect(lisible(format("fr").number(0.3946, "pourcentage"))).toBe("39,46 %");
    expect(format("en").number(0.3946, "pourcentage")).toBe("39.46%");
  });
});

describe("dates juridiques et financières — mois en toutes lettres", () => {
  const format = (langue: "fr" | "en") =>
    createFormatter({ locale: localeDe(langue), formats, timeZone: FUSEAU });

  it("écrit 1 October 2026 en anglais britannique, 1 octobre 2026 en français", () => {
    expect(format("en").dateTime(new Date("2026-10-01"), "dateJuridique")).toBe("1 October 2026");
    expect(format("fr").dateTime(new Date("2026-10-01"), "dateJuridique")).toBe("1 octobre 2026");
  });

  it("ne produit jamais de date numérique, quelle que soit la date ou la langue", () => {
    for (const langue of ["fr", "en"] as const) {
      for (const jour of ["2026-01-02", "2026-10-01", "2026-12-31", "2027-03-04"]) {
        const rendu = format(langue).dateTime(new Date(jour), "dateJuridique");
        expect(rendu, `${langue} ${jour}`).not.toMatch(/\d+\s*[/.-]\s*\d+/);
        expect(rendu, `${langue} ${jour}`).toMatch(/[A-Za-zÀ-ÿ]{3,}/);
      }
    }
  });

  it("ne décale pas d'un jour : une date de calendrier reste la même partout", () => {
    expect(format("en").dateTime(new Date("2026-12-31"), "dateJuridique")).toBe("31 December 2026");
    expect(format("fr").dateTime(new Date("2026-12-31"), "dateJuridique")).toBe("31 décembre 2026");
  });

  it("le format de date est unique : aucune variante numérique n'existe à choisir par erreur", () => {
    expect(Object.keys(formats.dateTime)).toEqual(["dateJuridique"]);
  });

  it("aucun code source n'affiche une date autrement que par ce format", () => {
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
    }

    // Les gabarits n'emploient aucun style de date ICU autre que le format nommé.
    for (const [cle, texte] of feuilles(lire("fr"))) {
      for (const [, style] of texte.matchAll(/\{\w+,\s*date(?:,\s*(\w+))?\}/g)) {
        expect(style, cle).toBe("dateJuridique");
      }
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
    const { t, format } = outilsDocument({ version: VERSION_OPPOSABLE, messages });
    expect(t("Appel.titre", { periode: "T4 2026" })).toBe("Appel de fonds — T4 2026");
    expect(lisible(format.number(appel.montant, "xof"))).toBe("1 234 567 XOF");
    expect(format.dateTime(appel.date, "dateJuridique")).toBe("1 octobre 2026");
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
    expect(lisible(rendu.corps)).toContain("Montant appelé : 1 234 567 XOF");
    expect(rendu.corps).toContain("Échéance : 1 octobre 2026");
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
    expect(lisible(rendu.corps)).toContain("Montant : 1 234 567 XOF, échéance le 1 octobre 2026");
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
    // jamais 10/01/2026. La devise reste XOF, la valeur ne change pas.
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
      expect(lisible(rendu.corps)).toContain("1 234 567 XOF");
    }
  });
});
