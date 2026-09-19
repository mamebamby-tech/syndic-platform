import type { AppelDetail, ContexteDocument } from "@/lib/data/appels";
import { outilsDocument, type DocumentLocalise } from "@/lib/i18n/document";

// Le document ressemble à ceux du cabinet, pas à l'application
// (docs/04-charte.md) : seule l'identité de `organisations` y figure,
// jamais le nom du produit.
//
// Il est rendu dans la langue de SA version (`document.version`), jamais
// dans celle de la personne connectée : le français est la seule version
// opposable. Aucun avertissement de l'application n'y figure — ils vivent
// hors du document, dans la langue de la personne (voir ListeAppels).
export function DocumentAppel({
  document,
  contexte,
  appel,
}: {
  document: DocumentLocalise;
  contexte: ContexteDocument;
  appel: AppelDetail;
}) {
  const { t, format, valeurs, version } = outilsDocument(document);

  const piedDePage = [
    contexte.organisationAdresse,
    contexte.organisationEmail,
    contexte.organisationNinea ? t("Appel.ninea", { valeur: contexte.organisationNinea }) : null,
    contexte.organisationRccm ? t("Appel.rccm", { valeur: contexte.organisationRccm }) : null,
  ]
    .filter((mention): mention is string => Boolean(mention))
    .join(" | ");

  return (
    <div lang={version.langue} className="rounded-card border border-filet bg-surface p-8">
      {!version.opposable && (
        <p className="mb-4 rounded-control bg-alerte-doux px-3 py-2 text-sm text-alerte">
          {t("mentions.courtoisie")}
        </p>
      )}

      <header className="border-b border-filet pb-4">
        <p className="font-serif text-xl text-marque">{contexte.organisationNom}</p>
        <p className="text-sm text-encre-2">{contexte.immeubleNom}</p>
      </header>

      <h2 className="mt-6 border-b border-marque pb-1 font-serif text-lg text-marque">
        {t("Appel.titre", { periode: contexte.periodeLibelle })}
      </h2>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-encre-3">{t("Appel.reference")}</dt>
        <dd className="tabular-nums text-encre">{appel.reference}</dd>
        <dt className="text-encre-3">{t("Appel.destinataire")}</dt>
        <dd className="text-encre">{appel.proprietaireNom}</dd>
        {appel.dateEmission && (
          <>
            <dt className="text-encre-3">{t("Appel.emisLe")}</dt>
            <dd className="tabular-nums text-encre">{valeurs.dateJuridique(appel.dateEmission)}</dd>
          </>
        )}
        <dt className="text-encre-3">{t("Appel.echeance")}</dt>
        <dd className="tabular-nums text-encre">{valeurs.dateJuridique(appel.dateEcheance)}</dd>
        {appel.reportAnterieur !== 0 && (
          <>
            <dt className="text-encre-3">{t("Appel.reportAnterieur")}</dt>
            <dd className="tabular-nums text-encre">{valeurs.montant(appel.reportAnterieur)}</dd>
          </>
        )}
      </dl>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="py-2 pr-2">{t("Appel.colonnes.lot")}</th>
              <th className="py-2 pr-2">{t("Appel.colonnes.poste")}</th>
              <th className="py-2 pr-2 text-right">{t("Appel.colonnes.base")}</th>
              <th className="py-2 text-right">{t("Appel.colonnes.montant")}</th>
            </tr>
          </thead>
          <tbody>
            {appel.lignes.map((ligne, index) => (
              <tr key={index} className="border-b border-filet last:border-0">
                <td className="py-1.5 pr-2 tabular-nums text-encre">{ligne.lotNumero}</td>
                <td className="py-1.5 pr-2 text-encre-2">{ligne.posteLibelle}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-encre-2">
                  {format.number(ligne.baseCalcul)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-encre">
                  {valeurs.montant(ligne.montant)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium text-encre">
              <td className="pt-3" colSpan={3}>
                {t("Appel.totalAppele")}
              </td>
              <td className="pt-3 text-right tabular-nums">
                {valeurs.montant(appel.montantTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Le compte du syndicat n'existe pas encore : un emplacement explicite
          remplace les coordonnées, et la base refuse d'émettre l'appel tant
          qu'il est là (20260919090000_modalites_reglement.sql). */}
      <section className="mt-6">
        <h3 className="border-b border-marque pb-1 font-serif text-base text-marque">
          {t("Appel.reglement.titre")}
        </h3>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-encre-3">{t("Appel.reglement.moyens")}</dt>
          <dd className="text-encre">
            {contexte.moyensPaiementAcceptes.length > 0 ? (
              format.list(
                contexte.moyensPaiementAcceptes.map((moyen) => {
                  const numero = contexte.numerosMarchands[moyen];
                  return numero
                    ? t("moyens.avecNumero", { moyen: t(`moyens.${moyen}`), numero })
                    : t(`moyens.${moyen}`);
                }),
                { type: "unit", style: "long" },
              )
            ) : (
              <span className="text-alerte">{t("Appel.reglement.moyensARenseigner")}</span>
            )}
          </dd>

          {contexte.compteSyndicat ? (
            <>
              <dt className="text-encre-3">{t("Appel.reglement.titulaire")}</dt>
              <dd className="text-encre">{contexte.compteSyndicat.titulaire}</dd>
              <dt className="text-encre-3">{t("Appel.reglement.banque")}</dt>
              <dd className="text-encre">{contexte.compteSyndicat.banque}</dd>
              <dt className="text-encre-3">{t("Appel.reglement.numero")}</dt>
              <dd className="tabular-nums text-encre">{contexte.compteSyndicat.numero}</dd>
              {contexte.compteSyndicat.bic && (
                <>
                  <dt className="text-encre-3">{t("Appel.reglement.bic")}</dt>
                  <dd className="tabular-nums text-encre">{contexte.compteSyndicat.bic}</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt className="text-encre-3">{t("Appel.reglement.compte")}</dt>
              <dd className="rounded-control border border-dashed border-alerte px-2 py-1 text-alerte">
                {t("Appel.reglement.compteARenseigner")}
              </dd>
            </>
          )}

          {contexte.compteModifieLe && (
            <>
              <dt className="text-encre-3">{t("Appel.reglement.modifieLe")}</dt>
              <dd className="tabular-nums text-encre">
                {valeurs.dateJuridique(contexte.compteModifieLe)}
              </dd>
            </>
          )}

          <dt className="text-encre-3">{t("Appel.reglement.reference")}</dt>
          <dd className="font-medium tabular-nums text-encre">{appel.reference}</dd>
        </dl>
        <p className="mt-2 text-xs text-encre-3">{t("Appel.reglement.consigne")}</p>
      </section>

      {piedDePage && (
        <footer className="mt-8 border-t border-filet pt-4 text-xs text-encre-3">
          {piedDePage}
        </footer>
      )}
    </div>
  );
}
