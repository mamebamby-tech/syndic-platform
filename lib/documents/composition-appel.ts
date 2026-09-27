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

export interface LigneSynthese {
  libelle: string;
  valeur: string;
  // Le total restant dû : mis en évidence.
  fort?: boolean;
}

export interface MoyenDocument {
  libelle: string;
  coordonnees: string[];
}

export interface CompositionAppel {
  langue: string;
  courtoisie: string | null;
  cabinet: string;
  immeuble: string;
  titre: string;
  // « Édité le 15 septembre 2026 » : date du document, en toutes lettres.
  editeLe: string;
  // En tête de la première page : ce qu'il faut savoir avant le détail.
  synthese: LigneSynthese[];
  // Situation du compte à la date d'édition (décision 71) : jamais absente.
  situation: {
    titre: string;
    introduction: string;
    lignes: { libelle: string; montant: string }[];
    total: { libelle: string; montant: string } | null;
    mention: string;
  };
  // Chaque moyen annoncé avec ses coordonnées (décision 74).
  paiement: { titre: string; moyens: MoyenDocument[]; consigne: string };
  modalites: { delai: string; imputation: string };
  identification: {
    destinataire: { libelle: string; nom: string; email: string | null };
    lots: { libelle: string; lignes: string[] };
    gestionnaire: { libelle: string; lignes: string[]; aRenseigner: boolean; aRenseignerTexte: string };
    references: { libelle: string; lignes: string[] };
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
  if (i.version !== 3 || !i.complement?.v3) {
    throw new DocumentImpossible(
      "l'instantané de cet appel est antérieur à la version 3 et ne contient pas tout ce que le PDF imprime",
    );
  }
  const c = i.complement;
  const v3 = c.v3!;
  if (c.lignes.length !== i.lignes.length) throw new DocumentImpossible("lignes de l'instantané incohérentes");

  // L'argent ne se devine pas : le détail doit redonner, au centime, le total figé.
  const sommeLignes = i.lignes.reduce((s, l) => s + enCentimes(l.montant), 0);
  if (sommeLignes + enCentimes(i.reportAnterieur) !== enCentimes(i.montantTotal)) {
    throw new DocumentImpossible("le détail des lignes ne redonne pas le total appelé");
  }

  const { t, format, valeurs, version } = outilsDocument(document);
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

  // La date du document : celle de l'émission, où il a été engendré.
  const dateEdition = valeurs.dateJuridique(i.dateEmission ?? i.emisLe);
  const article = (x: string | null) => x ?? "aucun";
  const delai = t("Appel.modalites.delai", {
    jours: v3.modalites.delaiPaiementJours,
    article: article(v3.modalites.articleDelai),
  });

  const soldeCentimes = enCentimes(v3.situation.soldeAnterieur);
  const totalDu = valeurs.montant((soldeCentimes + enCentimes(i.montantTotal)) / 100);

  const compteSyndicat = i.reglement.compte;
  const coordonneesMoyen = (m: string): string[] => {
    const ligne = (cle: string, valeur: string | null | undefined) =>
      valeur ? [t(`Appel.paiement.${cle}` as "Appel.paiement.titulaire", { valeur })] : [];
    switch (m) {
      case "virement":
        return [...ligne("titulaire", compteSyndicat?.titulaire), ...ligne("banque", compteSyndicat?.banque), ...ligne("numero", compteSyndicat?.numero)];
      case "virement_international":
        return [...ligne("numero", compteSyndicat?.numero), ...ligne("bic", compteSyndicat?.bic)];
      case "cheque":
        return ligne("ordre", compteSyndicat?.titulaire);
      case "wave":
      case "orange_money":
        return ligne("numeroMarchand", i.reglement.numerosMarchands[m]);
      case "especes":
        return [
          ...ligne(v3.especes.lieuDuCabinet ? "lieuCabinet" : "lieu", v3.especes.lieu),
          ...ligne("horaires", v3.especes.horaires),
        ];
      default:
        return [];
    }
  };
  const moyens: MoyenDocument[] = i.reglement.moyens.map((m) => ({
    libelle: t(`moyens.${m}` as "moyens.wave"),
    coordonnees: coordonneesMoyen(m),
  }));
  // Un moyen annoncé sans ses coordonnées n'est pas un moyen (décision 74) : la
  // base refuse d'émettre dans ce cas ; le document refuse aussi de l'imprimer.
  const sansCoordonnees = moyens.filter((m) => m.coordonnees.length === 0);
  if (sansCoordonnees.length > 0) {
    throw new DocumentImpossible(`moyen de paiement sans coordonnées : ${sansCoordonnees.map((m) => m.libelle).join(", ")}`);
  }

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
    editeLe: t("Appel.editeLe", { date: dateEdition }),
    synthese: [
      { libelle: t("Appel.synthese.montant"), valeur: valeurs.montant(i.montantTotal) },
      { libelle: t("Appel.synthese.periode"), valeur: i.periode.libelle },
      { libelle: t("Appel.synthese.exigibilite"), valeur: valeurs.dateJuridique(i.dateEcheance) },
      { libelle: t("Appel.synthese.reglement"), valeur: delai },
      { libelle: t("Appel.synthese.soldeAnterieur", { date: dateEdition }), valeur: valeurs.montant(v3.situation.soldeAnterieur) },
      { libelle: t("Appel.synthese.totalDu", { date: dateEdition }), valeur: totalDu, fort: true },
    ],
    situation: {
      titre: t("Appel.situation.titre", { date: dateEdition }),
      introduction:
        v3.situation.appels.length > 0
          ? t("Appel.situation.seulePeriode", { periode: i.periode.libelle })
          : t("Appel.situation.aucun"),
      lignes: [
        ...v3.situation.appels.map((a) => ({
          libelle: t("Appel.situation.ligne", { reference: a.reference, periode: a.periode }),
          montant: valeurs.montant(a.reste),
        })),
        ...(v3.situation.appels.length > 0
          ? [
              { libelle: t("Appel.situation.anterieur"), montant: valeurs.montant(v3.situation.soldeAnterieur) },
              { libelle: t("Appel.situation.present"), montant: valeurs.montant(i.montantTotal) },
            ]
          : []),
      ],
      total:
        v3.situation.appels.length > 0 ? { libelle: t("Appel.situation.total", { date: dateEdition }), montant: totalDu } : null,
      mention: t("Appel.situation.mention", { date: dateEdition }),
    },
    paiement: { titre: t("Appel.paiement.titre"), moyens, consigne: t("Appel.reglement.consigne") },
    modalites: {
      delai,
      imputation: t("Appel.modalites.imputation", {
        regle: v3.modalites.imputation,
        article: article(v3.modalites.articleImputation),
      }),
    },
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
