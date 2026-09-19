import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { chargerMessages } from "@/lib/i18n/messages";
import { formats } from "@/i18n/formats";
import type { VersionEnAttente } from "@/lib/data/parametres-immeuble";
import { situationDeLaVersion, type JeuCoordonnees } from "@/lib/parametres/double-validation";

// Les actions serveur importent cookies et Supabase : hors sujet pour un rendu.
vi.mock("@/app/immeubles/[immeubleId]/parametres/actions", () => ({
  confirmerModification: async () => undefined,
  refuserModification: async () => undefined,
}));

const { PanneauModificationEnAttente } = await import("@/components/parametres/panneau-modification-en-attente");
const messages = await chargerMessages("fr");

const enVigueur: JeuCoordonnees = {
  titulaire: "Syndicat",
  banque: "Banque du Sahel",
  numero: "SN08 0000 1111 2222",
  bic: "",
  moyens: ["virement"],
  marchands: {},
};

const version: VersionEnAttente = {
  id: "v1",
  titulaire: "Syndicat",
  banque: "Banque du Sahel",
  numero: "SN99 9999 8888 7777",
  bic: "ABCDSNDA",
  moyens: ["virement", "wave"],
  marchands: { wave: "77 000 00 00" },
  proposePar: "alice",
  proposeParLibelle: "alice@example.com",
  proposeLe: "2026-10-01T09:30:00Z",
};

function rendre(utilisateurId: string, habilites: number) {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" messages={messages} formats={formats} timeZone="UTC">
      <PanneauModificationEnAttente
        immeubleId="i1"
        version={version}
        enVigueur={enVigueur}
        situation={situationDeLaVersion(version.proposePar, utilisateurId, habilites)}
      />
    </NextIntlClientProvider>,
  );
  const texte = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ");
  return { html, texte };
}

describe("panneau « modification en attente de confirmation »", () => {
  it("montre, en CLAIR, ce qui est en vigueur et ce qui est proposé — pour pouvoir comparer à la source", () => {
    const { texte } = rendre("bob", 2);
    expect(texte).toContain("Modification des coordonnées de paiement en attente de confirmation");
    expect(texte).toContain("SN08 0000 1111 2222");
    expect(texte).toContain("SN99 9999 8888 7777");
    expect(texte).toContain("ABCDSNDA");
    expect(texte).toContain("Wave : 77 000 00 00");
    expect(texte).toContain("Proposée le 1er oct. 2026, 09:30");
    expect(texte).toContain("par alice@example.com");
  });

  it("dit que les appels utilisent les coordonnées en vigueur en attendant", () => {
    expect(rendre("bob", 2).texte).toContain("les appels utilisent les coordonnées en vigueur");
  });

  it("un AUTRE membre habilité voit Confirmer et Refuser", () => {
    const { texte, html } = rendre("bob", 2);
    expect(texte).toContain("Confirmer la modification");
    expect(texte).toContain("Refuser");
    expect(texte).not.toContain("Retirer ma demande");
    expect(texte).toContain("Comparez chaque valeur à sa source");
    expect(html.match(/name="versionId" value="v1"/g)).toHaveLength(2);
  });

  it("l'AUTEUR ne voit pas Confirmer : il peut seulement retirer sa demande", () => {
    const { texte } = rendre("alice", 3);
    expect(texte).not.toContain("Confirmer la modification");
    expect(texte).toContain("Retirer ma demande");
    expect(texte).toContain("vous ne pouvez pas la confirmer");
    expect(texte).not.toContain("Refuser");
  });

  it("cabinet à UN SEUL habilité : le blocage est dit clairement, sans bouton de contournement", () => {
    const { texte } = rendre("alice", 1);
    expect(texte).toContain("ne compte qu'un membre habilité");
    expect(texte).toContain("la règle ne se contourne pas");
    expect(texte).not.toContain("Confirmer la modification");
    expect(texte).toContain("Retirer ma demande");
  });

  it("n'affiche pas le blocage quand un autre habilité existe", () => {
    expect(rendre("alice", 2).texte).not.toContain("ne compte qu'un membre habilité");
  });

  it("aucune clé de message brute ne s'affiche", () => {
    for (const [u, n] of [["bob", 2], ["alice", 3], ["alice", 1]] as const) {
      expect(rendre(u, n).texte).not.toMatch(/Parametres\.|TableauDeBord\.|MoyenPaiement\./);
    }
  });
});
