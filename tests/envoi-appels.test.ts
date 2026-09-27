import { describe, expect, it, vi } from "vitest";
import type { InstantaneAppel } from "@/lib/appels/instantane";
import { envoyerAppels, recapituler, type Acces, type AppelAEnvoyer, type DemandeEnvoi } from "@/lib/appels/envoi";
import { EnvoiInterdit, estAdresseFictive } from "@/lib/courriel/garde-fou";
import type { Courriel } from "@/lib/courriel/transport";

// L'envoi des appels, de bout en bout, sans base ni service réel : destinataires
// du jeu fictif (mêmes contacts que le seed, anomalies comprises), transport espion.

const instantane: InstantaneAppel = {
  version: 2,
  complement: null,
  emisLe: "2026-09-15T08:00:00Z",
  reference: "MT-2026T4-001",
  numero: 1,
  dateEcheance: "2026-10-01",
  dateEmission: "2026-09-15",
  reportAnterieur: 0,
  montantTotal: 71_520,
  destinataire: { id: "d", nom: "Moussa BA" },
  periode: { id: "t4", libelle: "4e trimestre 2026" },
  immeuble: { id: "i", nom: "Mamelles Tower" },
  organisation: { nom: "ENIGMA AFRICA SARL", adresse: "Dakar", email: "enigma@enigmasn.com", ninea: "1", rccm: "2" },
  lignes: [],
  reglement: { compte: null, moyens: [], numerosMarchands: {}, compteModifieLe: null },
};

let n = 0;
const appel = (nom: string, email: string | null, telephone: string | null, dernierEnvoiLe: string | null = null): AppelAEnvoyer => ({
  appelId: `a${++n}`,
  reference: `MT-2026T4-${String(n).padStart(3, "0")}`,
  destinataireId: `p${n}`,
  destinataireNom: nom,
  email,
  telephone,
  langue: "fr",
  dernierEnvoiLe,
});

// Les contacts du seed : prêts, courriel seulement, WhatsApp seulement, adresse invalide.
const APPELS = [
  appel("Awa TOURE", "awa.toure@example.com", "+221700000004"),
  appel("SCI BAOBAB", "sci.baobab@example.com", null),
  appel("Tarik OZTURK", null, "+996550000001"),
  appel("Ousmane KANE", "kaneousmane441", "+221700000007"),
  appel("Sans contact", null, null),
  appel("Wei CHEN", "bureau.commun@example.org", "+221700000009", "2026-09-16T10:00:00Z"),
];

function acces() {
  const envoyes: Courriel[] = [];
  const traces: Parameters<Acces["tracer"]>[0][] = [];
  const a: Acces = {
    instantane: async () => instantane,
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    dateLimite: async () => "2026-10-27",
    tracer: async (t) => {
      traces.push(t);
    },
    transport: {
      nom: "espion",
      envoyer: vi.fn(async (c: Courriel) => {
        envoyes.push(c);
        return { reussi: true as const, identifiant: `id-${envoyes.length}`, service: "espion" };
      }),
    },
  };
  return { a, envoyes, traces };
}

const demande = (partiel: Partial<DemandeEnvoi> = {}): DemandeEnvoi => ({
  recapitulatifValide: true,
  renvoyerDejaEnvoyes: false,
  demonstration: true,
  redirection: "moi@domaine-reel.sn",
  expediteur: "Coprane <envoi@domaine-reel.sn>",
  adresseCabinet: "enigma@enigmasn.com",
  ...partiel,
});

describe("récapitulatif", () => {
  it("un état par destinataire, le décompte de chaque état, les injoignables nommés", () => {
    const r = recapituler(APPELS);
    expect(r.decompte).toEqual({ pret: 2, courriel_seulement: 1, whatsapp_seulement: 2, injoignable: 1 });
    expect(r.injoignables).toEqual(["Sans contact"]);
    expect(r.whatsappSeulement).toEqual(["Ousmane KANE", "Tarik OZTURK"]);
    expect(r.dejaEnvoyes).toBe(1);
  });
});

describe("envoi en démonstration", () => {
  it("rien ne part vers une adresse du jeu fictif : tout part vers la redirection, avec la mention du destinataire prévu", async () => {
    const { a, envoyes, traces } = acces();
    const bilan = await envoyerAppels(recapituler(APPELS), demande(), a);

    expect(envoyes).toHaveLength(2); // Awa TOURE, SCI BAOBAB ; Wei CHEN déjà envoyé
    for (const c of envoyes) {
      expect(c.a).toBe("moi@domaine-reel.sn");
      expect(estAdresseFictive(c.a)).toBe(false);
      expect(c.repondreA).toBe("moi@domaine-reel.sn");
      expect(c.sujet).toMatch(/^\[Démonstration\]/);
    }
    expect(envoyes[0]!.texte).toContain("awa.toure@example.com");
    expect(envoyes[0]!.html).toContain("awa.toure@example.com");
    expect(envoyes[0]!.texte).toMatch(/DÉMONSTRATION/);
    // L'exigibilité (figée) et la date limite de CE destinataire (fixée à l'envoi).
    expect(envoyes[0]!.texte).toContain("Exigible le : 1er octobre 2026");
    expect(envoyes[0]!.texte).toContain("À régler au plus tard le : 27 octobre 2026");
    expect(envoyes[0]!.piecesJointes[0]).toMatchObject({ nom: "Appel-MT-2026T4-001.pdf", type: "application/pdf" });

    // Chaque envoi est tracé : adresse réelle, destinataire prévu, résultat du service.
    expect(traces.map((t) => [t.adresse, t.adressePrevue, t.resultat.reussi, t.dateLimite])).toEqual([
      ["moi@domaine-reel.sn", "awa.toure@example.com", true, "2026-10-27"],
      ["moi@domaine-reel.sn", "sci.baobab@example.com", true, "2026-10-27"],
    ]);
    expect(bilan.nonServis.map((x) => [x.nom, x.motif])).toEqual([
      ["Ousmane KANE", "sans_courriel"],
      ["Sans contact", "sans_courriel"],
      ["Tarik OZTURK", "sans_courriel"],
      ["Wei CHEN", "deja_envoye"],
    ]);
  });

  it("sans adresse de redirection, ou avec une adresse fictive, rien ne part ni n'est tracé", async () => {
    for (const redirection of [null, "", "moi@example.com"]) {
      const { a, envoyes, traces } = acces();
      await expect(envoyerAppels(recapituler(APPELS), demande({ redirection }), a)).rejects.toThrow(EnvoiInterdit);
      expect(envoyes).toHaveLength(0);
      expect(traces).toHaveLength(0);
    }
  });

  it("sans validation du récapitulatif, rien ne part", async () => {
    const { a, envoyes } = acces();
    await expect(envoyerAppels(recapituler(APPELS), demande({ recapitulatifValide: false }), a)).rejects.toThrow(
      EnvoiInterdit,
    );
    expect(envoyes).toHaveLength(0);
  });

  it("un appel déjà envoyé ne repart qu'avec la confirmation explicite", async () => {
    const { a, envoyes } = acces();
    await envoyerAppels(recapituler(APPELS), demande({ renvoyerDejaEnvoyes: true }), a);
    expect(envoyes).toHaveLength(3);
  });
});

describe("envoi hors démonstration", () => {
  it("les adresses du jeu fictif n'atteignent jamais le service : échecs tracés, rien d'envoyé", async () => {
    const { a, envoyes, traces } = acces();
    const bilan = await envoyerAppels(recapituler(APPELS), demande({ demonstration: false, redirection: null }), a);
    expect(envoyes).toHaveLength(0);
    expect(a.transport.envoyer).not.toHaveBeenCalled();
    expect(bilan.echecs).toHaveLength(2);
    expect(traces.every((t) => !t.resultat.reussi)).toBe(true);
  });

  it("vers une adresse réelle, le gabarit encore en brouillon est refusé : il n'a pas été validé par le cabinet", async () => {
    const { a, envoyes } = acces();
    const bilan = await envoyerAppels(
      recapituler([appel("Copropriétaire réel", "copro@domaine-reel.sn", null)]),
      demande({ demonstration: false, redirection: null }),
      a,
    );
    expect(envoyes).toHaveLength(0);
    expect(bilan.echecs[0]!.erreur).toMatch(/validé par le cabinet/);
  });
});
