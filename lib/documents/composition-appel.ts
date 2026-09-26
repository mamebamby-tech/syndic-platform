import type { InstantaneAppel } from "@/lib/appels/instantane";
import { outilsDocument, type DocumentLocalise } from "@/lib/i18n/document";
import { nom as nomProduit } from "@/lib/marque";

// Ce que le PDF de l'appel imprime, composé depuis l'INSTANTANÉ et lui seul
// (décision 69) — jamais depuis les données courantes. Séparé du rendu
// (lib/documents/pdf-appel.tsx) pour être testé sans produire de PDF.
//
// Tous les textes viennent de messages/*.json (`Documents.Appel`), dans la
// langue de la version du document ; les valeurs juridiques (taux, période,
// mise en demeure, article) viennent du règlement figé dans l'instantané.

export class DocumentImpossible extends Error {
  constructor(detail: string) {
    super(`PDF de l'appel impossible : ${detail}`);
    this.name = "DocumentImpossible";
  }
}

export interface LigneDocument {
  poste: string;
  cle: string;
  base: string;
  quotePart: string;
}

export interface LotDocument {
  entete: string;
  lignes: LigneDocument[];
  sousTotal: string;
}

export interface CompositionAppel {
  langue: string;
  courtoisie: string | null;
  cabinet: string;
  immeuble: string;
  titre: string;
  identification: {
    destinataire: { libelle: string; nom: string; email: string | null };
    lots: { libelle: string; lignes: string[] };
    gestionnaire: { libelle: string; lignes: string[]; aRenseigner: boolean; aRenseignerTexte: string };
    references: { libelle: string; lignes: string[] };
    paiement: { libelle: string; moyens: string; compte: { libelle: string; valeur: string }[]; consigne: string };
  };
  detail: {
    titre: string;
    colonnes: { poste: string; cle: string; base: string; quotePart: string };
    lots: LotDocument[];
    explication: string;
  };
  report: { libelle: string; montant: string } | null;
  total: { libelle: string; montant: string };
  exigibilite: string;
  retard: { titre: string; texte: string };
  piedDePage: string;
  // « Document édité avec Coprane » : le produit se nomme en pied de page, jamais
  // à la place du cabinet (décision 68).
  mentionProduit: string;
  produit: string;
  // Libellé « Page {page} sur {total} », gabarit à compléter au rendu.
  pagination: (page: number, total: number) => string;
}

const enCentimes = (montant: number) => Math.round(montant * 100);

export function composerAppel(i: InstantaneAppel, document: DocumentLocalise): CompositionAppel {
  if (i.version !== 2 || !i.complement) {
    throw new DocumentImpossible(
      "l'instantané de cet appel est antérieur à la version 2 et ne contient pas tout ce que le PDF imprime",
    );
  }
  const c = i.complement;
  if (c.lignes.length !== i.lignes.length) throw new DocumentImpossible("lignes de l'instantané incohérentes");

  // L'argent ne se devine pas : le détail doit redonner, au centime, le total figé.
  const sommeLignes = i.lignes.reduce((s, l) => s + enCentimes(l.montant), 0);
  if (sommeLignes + enCentimes(i.reportAnterieur) !== enCentimes(i.montantTotal)) {
    throw new DocumentImpossible("le détail des lignes ne redonne pas le total appelé");
  }

  const { t, format, valeurs, version } = outilsDocument(document);
  const moyen = (m: string) => {
    const numero = i.reglement.numerosMarchands[m];
    return numero ? t("moyens.avecNumero", { moyen: t(`moyens.${m}` as "moyens.wave"), numero }) : t(`moyens.${m}` as "moyens.wave");
  };

  const compte = i.reglement.compte
    ? [
        { libelle: t("Appel.reglement.titulaire"), valeur: i.reglement.compte.titulaire },
        { libelle: t("Appel.reglement.banque"), valeur: i.reglement.compte.banque },
        { libelle: t("Appel.reglement.numero"), valeur: i.reglement.compte.numero },
        ...(i.reglement.compte.bic ? [{ libelle: t("Appel.reglement.bic"), valeur: i.reglement.compte.bic }] : []),
      ]
    : [{ libelle: t("Appel.reglement.compte"), valeur: t("Appel.reglement.compteARenseigner") }];

  // Détail regroupé par lot, dans l'ordre de l'instantané.
  const groupes: { numero: number; indices: number[] }[] = [];
  i.lignes.forEach((ligne, index) => {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.numero === ligne.lotNumero) dernier.indices.push(index);
    else groupes.push({ numero: ligne.lotNumero, indices: [index] });
  });
  const designationParNumero = new Map(c.lots.map((l) => [l.numero, l.designation]));
  const lots: LotDocument[] = groupes.map(({ numero, indices }) => {
    const centimes = indices.reduce((s, k) => s + enCentimes(i.lignes[k]!.montant), 0);
    return {
      entete: t("Appel.identification.lot", { numero, designation: designationParNumero.get(numero) ?? "" }),
      lignes: indices.map((k) => ({
        poste: i.lignes[k]!.posteLibelle,
        cle: c.lignes[k]!.cleLibelle,
        base: t("Appel.detail.baseValeur", { base: i.lignes[k]!.baseCalcul, total: c.lignes[k]!.baseTotale }),
        quotePart: valeurs.montant(i.lignes[k]!.montant),
      })),
      sousTotal: `${t("Appel.detail.sousTotalLot", { numero })} : ${valeurs.montant(centimes / 100)}`,
    };
  });

  const retard = c.retard
    ? t("Appel.retard.texte", {
        article: c.retard.article ?? "aucun",
        taux: format.number(c.retard.tauxPenalite, "tauxReglement"),
        par: c.retard.penalitePar,
        miseEnDemeure: c.retard.requiertMiseEnDemeure ? "oui" : "non",
      })
    : t("Appel.retard.inconnu");

  const piedDePage = [
    i.organisation.nom,
    i.organisation.adresse,
    i.organisation.email,
    i.organisation.ninea ? t("Appel.ninea", { valeur: i.organisation.ninea }) : null,
    i.organisation.rccm ? t("Appel.rccm", { valeur: i.organisation.rccm }) : null,
  ]
    .filter((m): m is string => Boolean(m))
    .join(" | ");

  return {
    langue: version.langue,
    courtoisie: version.opposable ? null : t("mentions.courtoisie"),
    cabinet: i.organisation.nom,
    immeuble: [i.immeuble.nom, c.immeubleAdresse, c.immeubleVille].filter(Boolean).join(" — "),
    titre: t("Appel.titre", { periode: i.periode.libelle }),
    identification: {
      destinataire: {
        libelle: t("Appel.identification.destinataire"),
        nom: i.destinataire.nom,
        email: c.destinataireEmail,
      },
      lots: {
        libelle: t("Appel.identification.lots"),
        lignes: c.lots.map(
          (l) =>
            `${t("Appel.identification.lot", { numero: l.numero, designation: l.designation })} · ${t(
              "Appel.identification.lotTantiemes",
              { tantiemes: l.tantiemes },
            )}`,
        ),
      },
      gestionnaire: {
        libelle: t("Appel.identification.gestionnaire"),
        lignes: [c.gestionnaire.nom, c.gestionnaire.email].filter((v): v is string => Boolean(v)),
        aRenseigner: !c.gestionnaire.nom && !c.gestionnaire.email,
        aRenseignerTexte: t("Appel.identification.gestionnaireARenseigner"),
      },
      references: {
        libelle: t("Appel.identification.references"),
        lignes: [
          t("Appel.identification.referenceAppel", { reference: i.reference }),
          t("Appel.identification.referenceImmeuble", {
            code: c.immeubleCodeReference ?? "—",
            nom: i.immeuble.nom,
          }),
        ],
      },
      paiement: {
        libelle: t("Appel.identification.paiement"),
        moyens:
          i.reglement.moyens.length > 0
            ? format.list(i.reglement.moyens.map(moyen), { type: "unit", style: "long" })
            : t("Appel.reglement.moyensARenseigner"),
        compte,
        consigne: t("Appel.reglement.consigne"),
      },
    },
    detail: {
      titre: t("Appel.detail.titre"),
      colonnes: {
        poste: t("Appel.detail.poste"),
        cle: t("Appel.detail.cle"),
        base: t("Appel.detail.base"),
        quotePart: t("Appel.detail.quotePart"),
      },
      lots,
      explication: t("Appel.detail.explication"),
    },
    report:
      i.reportAnterieur !== 0
        ? { libelle: t("Appel.reportAnterieur"), montant: valeurs.montant(i.reportAnterieur) }
        : null,
    total: { libelle: t("Appel.totalAppele"), montant: valeurs.montant(i.montantTotal) },
    exigibilite: t("Appel.exigibilite", { date: valeurs.dateJuridique(i.dateEcheance) }),
    retard: { titre: t("Appel.retard.titre"), texte: retard },
    piedDePage,
    mentionProduit: t("Appel.editeAvec", { produit: nomProduit }),
    produit: nomProduit,
    pagination: (page, total) => t("Appel.page", { page, total }),
  };
}
