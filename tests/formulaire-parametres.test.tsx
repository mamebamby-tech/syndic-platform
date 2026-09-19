import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { chargerMessages } from "@/lib/i18n/messages";
import type { ParametresImmeuble } from "@/lib/data/parametres-immeuble";

// L'action serveur importe la couche de données (server-only, cookies) : hors
// sujet pour un rendu. Le formulaire ne reçoit d'elle qu'une fonction.
vi.mock("@/app/immeubles/[immeubleId]/parametres/actions", () => ({
  enregistrerParametres: async () => ({ statut: "initial", erreurs: {} }),
}));

const { FormulaireParametres } = await import("@/components/parametres/formulaire-parametres");

const parametres: ParametresImmeuble = {
  immeubleId: "i1",
  organisationId: "o1",
  titulaire: "",
  banque: "",
  numero: "",
  bic: "",
  moyens: [],
  marchands: {},
  codeReference: "MT",
  formatReference: "{code}-{annee}{periode}-{seq}",
  compteModifieLe: null,
  periodicite: "trimestriel",
};

async function rendre(surcharge: Partial<ParametresImmeuble> = {}, exemple: { annee: number; periode: string } | null = { annee: 2026, periode: "T4" }, date: string | null = null) {
  const messages = await chargerMessages("fr");
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="UTC">
      <FormulaireParametres
        parametres={{ ...parametres, ...surcharge }}
        exemple={exemple}
        dateDerniereModification={date}
      />
    </NextIntlClientProvider>,
  );
  // Le texte visible : balises retirées, entités HTML décodées (apostrophes).
  const texte = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, texte };
}

describe("formulaire des paramètres de l'immeuble", () => {
  it("présente les trois sections, avec des libellés lisibles et aucune clé brute", async () => {
    const { texte } = await rendre();
    for (const libelle of [
      "Coordonnées bancaires du syndicat",
      "Titulaire du compte",
      "Banque",
      "Numéro de compte ou IBAN",
      "Code SWIFT / BIC",
      "Moyens de paiement acceptés",
      "Référence des appels",
      "Code de l'immeuble",
      "Format",
      "Enregistrer",
    ]) {
      expect(texte, libelle).toContain(libelle);
    }
    expect(texte).not.toMatch(/Parametres\.|MoyenPaiement\.|TableauDeBord\./);
  });

  it("offre exactement les cinq moyens : Wave, Orange Money, virement, virement international, espèces", async () => {
    const { html, texte } = await rendre();
    const valeurs = [...html.matchAll(/name="moyens"[^>]*value="([^"]+)"/g)].map((m) => m[1]);
    expect(valeurs.sort()).toEqual(["especes", "orange_money", "virement", "virement_international", "wave"]);
    expect(texte).toContain("Espèces");
    expect(texte).not.toContain("Chèque");
  });

  it("le numéro marchand n'apparaît que pour un moyen mobile coché", async () => {
    const sans = await rendre({ moyens: ["virement"] });
    expect(sans.html).not.toContain("marchand_wave");
    const avec = await rendre({ moyens: ["wave"], marchands: { wave: "770000000" } });
    expect(avec.html).toContain('name="marchand_wave"');
    expect(avec.html).toContain('value="770000000"');
    expect(avec.html).not.toContain("marchand_orange_money");
  });

  it("préremplit les valeurs enregistrées", async () => {
    const { html } = await rendre({
      titulaire: "Syndicat de test",
      banque: "Banque de test",
      numero: "SN08 0000 1111 2222",
      bic: "ABCDSNDA",
    });
    for (const valeur of ["Syndicat de test", "Banque de test", "SN08 0000 1111 2222", "ABCDSNDA"]) {
      expect(html).toContain(valeur);
    }
  });

  it("montre un exemple de référence calculé avec le format et le code courants", async () => {
    const { texte } = await rendre();
    expect(texte).toContain("Exemple : MT-2026T4-007");
  });

  it("pas d'exemple quand la périodicité est inconnue, ni quand le format est invalide", async () => {
    expect((await rendre({}, null)).texte).not.toContain("Exemple :");
    expect((await rendre({ formatReference: "{code} {seq}" })).texte).not.toContain("Exemple :");
  });

  it("signale un compte partiellement rempli : l'émission reste bloquée", async () => {
    expect((await rendre({ titulaire: "Syndicat" })).texte).toContain("l'émission des appels reste bloquée");
    expect((await rendre()).texte).not.toContain("l'émission des appels reste bloquée");
    expect((await rendre({ titulaire: "T", banque: "B", numero: "N" })).texte).not.toContain(
      "l'émission des appels reste bloquée",
    );
  });

  it("dit quand les coordonnées ont été modifiées pour la dernière fois, ou qu'elles ne l'ont jamais été", async () => {
    expect((await rendre({}, null, "1er octobre 2026")).texte).toContain(
      "Coordonnées de paiement modifiées le 1er octobre 2026.",
    );
    expect((await rendre()).texte).toContain("Coordonnées de paiement jamais renseignées.");
  });

  it("rappelle que toute modification est tracée et signalée", async () => {
    // L'introduction est portée par la page ; le formulaire ne montre que ce qui l'engage.
    const messages = await chargerMessages("fr");
    expect(messages.Parametres.introduction).toMatch(/tracée/);
    expect(messages.Parametres.introduction).toMatch(/tableau de bord/);
  });
});
