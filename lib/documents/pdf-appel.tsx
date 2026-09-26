import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { couleurs } from "@/tailwind.config";
import type { CompositionAppel } from "@/lib/documents/composition-appel";

// Le PDF de l'appel de fonds (décision 69), rendu depuis la composition
// (lib/documents/composition-appel.ts), elle-même tirée de l'instantané.
// Il ressemble aux documents du cabinet (docs/04-charte.md) : identité du
// cabinet en tête et en pied, titres en serif, intertitres en `marque`
// soulignés d'un filet, aucune ombre, montants alignés.
//
// Polices standard du PDF (Times, Helvetica) : aucun fichier à embarquer. Elles
// ne connaissent pas l'espace fine insécable qu'Intl met entre les milliers ;
// elle est remplacée par une espace insécable ordinaire, même rendu.
const lisible = (texte: string) => texte.replace(/ /g, " ");

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: couleurs.encre,
  },
  cabinet: { fontFamily: "Times-Roman", fontSize: 16, color: couleurs.marque },
  immeuble: { fontSize: 9, color: couleurs["encre-2"], marginTop: 2 },
  entete: { borderBottomWidth: 1, borderBottomColor: couleurs.filet, paddingBottom: 8 },
  titre: {
    fontFamily: "Times-Roman",
    fontSize: 14,
    color: couleurs.marque,
    marginTop: 16,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: couleurs.marque,
  },
  courtoisie: { marginTop: 8, padding: 6, backgroundColor: couleurs["alerte-doux"], color: couleurs.alerte },
  identification: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  bloc: { width: "50%", paddingRight: 12, marginTop: 8 },
  blocLarge: { width: "100%", marginTop: 8 },
  etiquette: { fontSize: 7.5, color: couleurs["encre-3"], textTransform: "uppercase", marginBottom: 2 },
  fort: { fontFamily: "Helvetica-Bold" },
  alerte: { color: couleurs.alerte },
  ligneCompte: { flexDirection: "row" },
  libelleCompte: { width: 110, color: couleurs["encre-3"] },
  intertitre: {
    fontFamily: "Times-Roman",
    fontSize: 11.5,
    color: couleurs.marque,
    marginTop: 16,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: couleurs.marque,
  },
  tete: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: couleurs.filet, paddingVertical: 4, color: couleurs["encre-3"], fontSize: 7.5 },
  lot: { fontFamily: "Helvetica-Bold", marginTop: 6, paddingVertical: 2 },
  ligne: { flexDirection: "row", paddingVertical: 1.5 },
  colPoste: { width: "38%" },
  colCle: { width: "26%", color: couleurs["encre-2"] },
  colBase: { width: "18%", textAlign: "right", color: couleurs["encre-2"] },
  colMontant: { width: "18%", textAlign: "right" },
  sousTotal: { textAlign: "right", color: couleurs["encre-2"], borderTopWidth: 0.5, borderTopColor: couleurs.filet, paddingTop: 2, marginTop: 1 },
  explication: { marginTop: 6, fontSize: 7.5, color: couleurs["encre-3"] },
  totaux: { marginTop: 12, borderTopWidth: 1, borderTopColor: couleurs.encre, paddingTop: 6 },
  ligneTotal: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  total: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  exigibilite: { marginTop: 6, fontFamily: "Helvetica-Bold", color: couleurs.action },
  retard: { marginTop: 4 },
  pied: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: couleurs.filet,
    paddingTop: 6,
    fontSize: 7,
    color: couleurs["encre-3"],
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function DocumentPdfAppel({ c }: { c: CompositionAppel }) {
  const id = c.identification;
  return (
    <Document
      title={lisible(c.titre)}
      author={lisible(c.cabinet)}
      creator={lisible(c.produit)}
      producer={lisible(c.produit)}
      language={c.langue}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.entete}>
          <Text style={styles.cabinet}>{lisible(c.cabinet)}</Text>
          <Text style={styles.immeuble}>{lisible(c.immeuble)}</Text>
        </View>

        <Text style={styles.titre}>{lisible(c.titre)}</Text>
        {c.courtoisie && <Text style={styles.courtoisie}>{lisible(c.courtoisie)}</Text>}

        <View style={styles.identification}>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>{lisible(id.destinataire.libelle)}</Text>
            <Text style={styles.fort}>{lisible(id.destinataire.nom)}</Text>
            {id.destinataire.email && <Text>{lisible(id.destinataire.email)}</Text>}
          </View>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>{lisible(id.references.libelle)}</Text>
            {id.references.lignes.map((l, k) => (
              <Text key={k} style={k === 0 ? styles.fort : undefined}>{lisible(l)}</Text>
            ))}
          </View>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>{lisible(id.lots.libelle)}</Text>
            {id.lots.lignes.map((l, k) => (
              <Text key={k}>{lisible(l)}</Text>
            ))}
          </View>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>{lisible(id.gestionnaire.libelle)}</Text>
            {id.gestionnaire.aRenseigner ? (
              <Text style={styles.alerte}>{lisible(id.gestionnaire.aRenseignerTexte)}</Text>
            ) : (
              id.gestionnaire.lignes.map((l, k) => <Text key={k}>{lisible(l)}</Text>)
            )}
          </View>
          <View style={styles.blocLarge}>
            <Text style={styles.etiquette}>{lisible(id.paiement.libelle)}</Text>
            <Text>{lisible(id.paiement.moyens)}</Text>
            {id.paiement.compte.map((ligne, k) => (
              <View key={k} style={styles.ligneCompte}>
                <Text style={styles.libelleCompte}>{lisible(ligne.libelle)}</Text>
                <Text>{lisible(ligne.valeur)}</Text>
              </View>
            ))}
            <Text style={styles.explication}>{lisible(id.paiement.consigne)}</Text>
          </View>
        </View>

        <Text style={styles.intertitre}>{lisible(c.detail.titre)}</Text>
        <View style={styles.tete} fixed>
          <Text style={styles.colPoste}>{lisible(c.detail.colonnes.poste)}</Text>
          <Text style={styles.colCle}>{lisible(c.detail.colonnes.cle)}</Text>
          <Text style={styles.colBase}>{lisible(c.detail.colonnes.base)}</Text>
          <Text style={styles.colMontant}>{lisible(c.detail.colonnes.quotePart)}</Text>
        </View>
        {c.detail.lots.map((lot, k) => (
          <View key={k} wrap={false}>
            <Text style={styles.lot}>{lisible(lot.entete)}</Text>
            {lot.lignes.map((l, j) => (
              <View key={j} style={styles.ligne}>
                <Text style={styles.colPoste}>{lisible(l.poste)}</Text>
                <Text style={styles.colCle}>{lisible(l.cle)}</Text>
                <Text style={styles.colBase}>{lisible(l.base)}</Text>
                <Text style={styles.colMontant}>{lisible(l.quotePart)}</Text>
              </View>
            ))}
            <Text style={styles.sousTotal}>{lisible(lot.sousTotal)}</Text>
          </View>
        ))}
        <Text style={styles.explication}>{lisible(c.detail.explication)}</Text>

        <View style={styles.totaux} wrap={false}>
          {c.report && (
            <View style={styles.ligneTotal}>
              <Text>{lisible(c.report.libelle)}</Text>
              <Text>{lisible(c.report.montant)}</Text>
            </View>
          )}
          <View style={styles.ligneTotal}>
            <Text style={styles.total}>{lisible(c.total.libelle)}</Text>
            <Text style={styles.total}>{lisible(c.total.montant)}</Text>
          </View>
          <Text style={styles.exigibilite}>{lisible(c.exigibilite)}</Text>
        </View>

        <View wrap={false}>
          <Text style={styles.intertitre}>{lisible(c.retard.titre)}</Text>
          <Text style={styles.retard}>{lisible(c.retard.texte)}</Text>
        </View>

        <View style={styles.pied} fixed>
          <View style={{ width: "80%" }}>
            <Text>{lisible(c.piedDePage)}</Text>
            <Text style={{ marginTop: 2 }}>{lisible(c.mentionProduit)}</Text>
          </View>
          <Text render={({ pageNumber, totalPages }) => lisible(c.pagination(pageNumber, totalPages))} />
        </View>
      </Page>
    </Document>
  );
}

export async function rendrePdfAppel(composition: CompositionAppel): Promise<Buffer> {
  return renderToBuffer(<DocumentPdfAppel c={composition} />);
}
