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
  const { t, format, version } = outilsDocument(document);

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
        <dt className="text-encre-3">{t("Appel.echeance")}</dt>
        <dd className="tabular-nums text-encre">
          {format.dateTime(new Date(appel.dateEcheance), "dateJuridique")}
        </dd>
        {appel.reportAnterieur !== 0 && (
          <>
            <dt className="text-encre-3">{t("Appel.reportAnterieur")}</dt>
            <dd className="tabular-nums text-encre">
              {format.number(appel.reportAnterieur, "xof")}
            </dd>
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
                  {format.number(ligne.montant, "xof")}
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
                {format.number(appel.montantTotal, "xof")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {piedDePage && (
        <footer className="mt-8 border-t border-filet pt-4 text-xs text-encre-3">
          {piedDePage}
        </footer>
      )}
    </div>
  );
}
