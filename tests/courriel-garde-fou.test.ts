import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EnvoiInterdit,
  destinationEffective,
  estAdresseFictive,
  verifierRedirection,
} from "@/lib/courriel/garde-fou";
import { envoyerCourriel, transportResend, type Courriel, type Transport } from "@/lib/courriel/transport";

// Aucun envoi ne doit pouvoir partir vers une adresse du jeu fictif (décision 70).
// Les adresses sont lues dans supabase/seed/seed.sql lui-même : une adresse
// ajoutée au jeu est couverte sans toucher à ce test.

const TOUTES_LES_ADRESSES = [
  ...new Set(readFileSync("supabase/seed/seed.sql", "utf8").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []),
];

// La seule adresse RÉELLE que le seed contient, assumée : celle, publique, du
// cabinet (organisations.email, docs/04-charte.md). Elle n'est jamais un
// destinataire ; en démonstration, elle n'est même pas l'adresse de réponse.
const ADRESSES_REELLES_ASSUMEES = ["enigma@enigmasn.com"];

const ADRESSES_DU_SEED = TOUTES_LES_ADRESSES.filter((a) => !ADRESSES_REELLES_ASSUMEES.includes(a));

const courriel = (a: string): Courriel => ({
  de: "Coprane <envoi@coprane.test-reel.sn>",
  a,
  repondreA: "cabinet@cabinet-reel.sn",
  sujet: "Appel de fonds",
  html: "<p>Bonjour</p>",
  texte: "Bonjour",
  piecesJointes: [],
});

const transportEspion = (): Transport & { envoyer: ReturnType<typeof vi.fn> } => ({
  nom: "espion",
  envoyer: vi.fn(async () => ({ reussi: true as const, identifiant: "x", service: "espion" })),
});

describe("garde-fou : aucune adresse du jeu fictif ne part", () => {
  it("le seed contient bien des adresses (le test ne tourne pas à vide)", () => {
    expect(ADRESSES_DU_SEED.length).toBeGreaterThanOrEqual(15);
    expect(ADRESSES_DU_SEED).toContain("contact.partage@example.com");
  });

  it("le seed ne contient aucune autre adresse réelle que celle, assumée, du cabinet", () => {
    const reelles = TOUTES_LES_ADRESSES.filter((a) => !estAdresseFictive(a));
    expect(reelles).toEqual(ADRESSES_REELLES_ASSUMEES);
  });

  it("chaque adresse du seed est reconnue comme fictive", () => {
    for (const adresse of ADRESSES_DU_SEED) expect(estAdresseFictive(adresse), adresse).toBe(true);
  });

  it("dernier point d'envoi : chaque adresse du seed est refusée avant d'atteindre le service", async () => {
    const transport = transportEspion();
    for (const adresse of ADRESSES_DU_SEED) {
      await expect(envoyerCourriel(courriel(adresse), transport), adresse).rejects.toThrow(EnvoiInterdit);
    }
    expect(transport.envoyer).not.toHaveBeenCalled();
  });

  it("le transport Resend n'est même pas appelé pour une adresse fictive", async () => {
    const requete = vi.fn();
    await expect(
      envoyerCourriel(courriel("sci.alize@example.com"), transportResend("cle", requete as unknown as typeof fetch)),
    ).rejects.toThrow(EnvoiInterdit);
    expect(requete).not.toHaveBeenCalled();
  });

  it("variantes de casse, espaces et sous-domaines : toujours refusées", () => {
    for (const adresse of [
      "Awa.Toure@EXAMPLE.COM",
      "  x@example.org ",
      "x@mail.example.net",
      "x@quelquechose.test",
      "x@a.invalid",
      "x@b.example",
      "x@localhost.localhost",
    ]) {
      expect(estAdresseFictive(adresse), adresse).toBe(true);
    }
  });

  it("une adresse réelle n'est pas prise pour une fictive", () => {
    for (const adresse of ["cabinet@enigmasn.com", "x@example-reel.com", "x@exemple.com", "x@myexample.com"]) {
      expect(estAdresseFictive(adresse), adresse).toBe(false);
    }
  });
});

describe("aiguillage en démonstration", () => {
  it("sans adresse de redirection, rien ne part", () => {
    for (const redirection of [undefined, null, "", "   "]) {
      expect(() =>
        destinationEffective({ demonstration: true, redirection, adresseDestinataire: "awa.toure@example.com" }),
      ).toThrow(EnvoiInterdit);
    }
  });

  it("une redirection vers une adresse du jeu fictif est refusée", () => {
    for (const adresse of ADRESSES_DU_SEED) expect(() => verifierRedirection(adresse), adresse).toThrow(EnvoiInterdit);
  });

  it("une redirection mal formée est refusée", () => {
    expect(() => verifierRedirection("pas-une-adresse")).toThrow(EnvoiInterdit);
  });

  it("chaque destinataire du seed part vers la redirection, et le destinataire fictif est gardé pour la mention", () => {
    for (const adresse of ADRESSES_DU_SEED) {
      expect(
        destinationEffective({ demonstration: true, redirection: "moi@domaine-reel.sn", adresseDestinataire: adresse }),
      ).toEqual({ adresse: "moi@domaine-reel.sn", adressePrevue: adresse });
    }
  });
});

describe("aiguillage en production", () => {
  it("une adresse du jeu fictif est refusée même hors démonstration", () => {
    expect(() =>
      destinationEffective({ demonstration: false, redirection: null, adresseDestinataire: "sci.baobab@example.com" }),
    ).toThrow(EnvoiInterdit);
  });

  it("une adresse réelle part telle quelle, sans redirection", () => {
    expect(
      destinationEffective({ demonstration: false, redirection: "ignoree@domaine-reel.sn", adresseDestinataire: "copro@domaine-reel.sn" }),
    ).toEqual({ adresse: "copro@domaine-reel.sn", adressePrevue: null });
  });
});

describe("adresse de réponse", () => {
  it("une adresse de réponse fictive est refusée au dernier point d'envoi", async () => {
    const transport = transportEspion();
    await expect(
      envoyerCourriel({ ...courriel("moi@domaine-reel.sn"), repondreA: "gestion.mamelles@example.com" }, transport),
    ).rejects.toThrow(EnvoiInterdit);
    expect(transport.envoyer).not.toHaveBeenCalled();
  });
});
