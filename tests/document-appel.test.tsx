import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentAppel } from "@/components/documents/document-appel";
import type { AppelDetail, ContexteDocument } from "@/lib/data/appels";
import { VERSION_OPPOSABLE, versionDocument } from "@/lib/i18n/document";
import { chargerMessages } from "@/lib/i18n/messages";

// Rendu réel du document d'appel : ce que le syndic prévisualise est ce qui
// sera envoyé. Sans base de données ni fournisseur de langue — le document
// porte lui-même sa langue.

const contexte: ContexteDocument = {
  organisationNom: "Cabinet de test",
  organisationAdresse: null,
  organisationEmail: null,
  organisationNinea: null,
  organisationRccm: null,
  immeubleNom: "Immeuble de test",
  periodeLibelle: "4e trimestre 2026",
  compteSyndicat: null,
  moyensPaiementAcceptes: [],
  numerosMarchands: {},
  compteModifieLe: null,
};

const appel: AppelDetail = {
  id: "a1",
  reference: "MT-2026T4-007",
  statut: "brouillon",
  montantTotal: 1234567,
  reportAnterieur: 0,
  dateEcheance: "2026-10-01",
  dateEmission: null,
  proprietaireId: "p1",
  proprietaireNom: "Propriétaire de test",
  anomalies: [],
  envoi: "pret",
  lignes: [{ lotNumero: 48, posteLibelle: "Charges générales", baseCalcul: 120, montant: 1234567 }],
};

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

async function rendre(ctx: ContexteDocument) {
  const messages = (await chargerMessages("fr")).Documents;
  return renderToStaticMarkup(
    <DocumentAppel document={{ version: VERSION_OPPOSABLE, messages }} contexte={ctx} appel={appel} />,
  );
}

describe("document d'appel — Modalités de règlement", () => {
  it("sans compte : emplacement explicite « Coordonnées bancaires à renseigner »", async () => {
    const html = texte(await rendre(contexte));
    expect(html).toContain("Modalités de règlement");
    expect(html).toContain("Coordonnées bancaires à renseigner");
    expect(html).toContain("Moyens de règlement à renseigner");
    expect(html).not.toMatch(/Titulaire du compte/);
  });

  it("rappelle la référence à porter dans le libellé du règlement", async () => {
    const html = texte(await rendre(contexte));
    expect(html).toContain("Référence à rappeler MT-2026T4-007");
    expect(html).toContain("Rappelez cette référence dans le libellé de votre règlement.");
    // La référence figure aussi en tête du document.
    expect(html.match(/MT-2026T4-007/g)!.length).toBe(2);
  });

  it("avec un compte : coordonnées et moyens, plus d'emplacement à renseigner", async () => {
    const html = texte(
      await rendre({
        ...contexte,
        compteSyndicat: {
          titulaire: "Syndicat de test",
          banque: "Banque de test",
          numero: "SN000 0000 0000",
          bic: null,
        },
        moyensPaiementAcceptes: ["virement", "cheque"],
      }),
    );
    expect(html).toContain("Titulaire du compte Syndicat de test");
    expect(html).toContain("Banque Banque de test");
    expect(html).toContain("Numéro de compte SN000 0000 0000");
    expect(html).toContain("Virement");
    expect(html).toContain("Chèque");
    expect(html).not.toContain("à renseigner");
    expect(html).not.toMatch(/\bBIC\b/);
  });

  it("affiche les numéros marchands avec leur moyen, et la date de dernière modification", async () => {
    const html = texte(
      await rendre({
        ...contexte,
        compteSyndicat: { titulaire: "T", banque: "B", numero: "N", bic: null },
        moyensPaiementAcceptes: ["wave", "orange_money", "virement"],
        numerosMarchands: { wave: "77 000 00 00" },
        compteModifieLe: "2026-10-01T09:30:00Z",
      }),
    );
    expect(html).toContain("Wave (numéro marchand 77 000 00 00)");
    // Orange Money accepté sans numéro marchand : pas de parenthèse vide.
    expect(html).toMatch(/Orange Money(?! \()/);
    expect(html).toContain("Coordonnées modifiées le 1er octobre 2026");
  });

  it("sans modification enregistrée, aucune date de modification n'est affichée", async () => {
    expect(texte(await rendre(contexte))).not.toContain("Coordonnées modifiées le");
  });

  it("affiche le BIC quand il existe", async () => {
    const html = texte(
      await rendre({
        ...contexte,
        compteSyndicat: { titulaire: "T", banque: "B", numero: "N", bic: "ABCDSNDA" },
      }),
    );
    expect(html).toContain("BIC ABCDSNDA");
  });
});

describe("document d'appel — devise et dates", () => {
  it("affiche FCFA, jamais XOF, et « 1er octobre 2026 »", async () => {
    const html = texte(await rendre(contexte));
    expect(html).toContain("1 234 567 FCFA");
    expect(html).not.toContain("XOF");
    expect(html).toContain("1er octobre 2026");
    expect(html).not.toMatch(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  });

  it("reste en français et opposable : aucune mention de courtoisie", async () => {
    const html = texte(await rendre(contexte));
    expect(html).not.toContain("non opposable");
  });

  it("une version de courtoisie porte la mention non opposable", async () => {
    const messages = (await chargerMessages("en")).Documents;
    const html = texte(
      renderToStaticMarkup(
        <DocumentAppel
          document={{ version: versionDocument("en"), messages }}
          contexte={contexte}
          appel={appel}
        />,
      ),
    );
    expect(html).toContain("non opposable");
    // Sans traduction, le repli est français, mais montants et dates suivent la langue du document.
    expect(html).toContain("XOF 1,234,567");
    expect(html).toContain("1 October 2026");
  });
});
