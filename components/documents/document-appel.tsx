import type { AppelDetail, ContexteDocument } from "@/lib/data/appels";
import { LIBELLES_ANOMALIE_CONTACT } from "@/lib/data/anomalie-contact";
import { formaterDate, formaterNombre, formaterXof } from "@/lib/format";

// Le document ressemble à ceux du cabinet, pas à l'application
// (docs/04-charte.md) : seule l'identité de `organisations` y figure,
// jamais le nom du produit.
export function DocumentAppel({
  contexte,
  appel,
}: {
  contexte: ContexteDocument;
  appel: AppelDetail;
}) {
  const piedDePage = [
    contexte.organisationAdresse,
    contexte.organisationEmail,
    contexte.organisationNinea ? `NINEA ${contexte.organisationNinea}` : null,
    contexte.organisationRccm ? `RCCM ${contexte.organisationRccm}` : null,
  ]
    .filter((mention): mention is string => Boolean(mention))
    .join(" | ");

  return (
    <div className="rounded-card border border-filet bg-surface p-8">
      <header className="border-b border-filet pb-4">
        <p className="font-serif text-xl text-marque">{contexte.organisationNom}</p>
        <p className="text-sm text-encre-2">{contexte.immeubleNom}</p>
      </header>

      <h2 className="mt-6 border-b border-marque pb-1 font-serif text-lg text-marque">
        Appel de fonds — {contexte.periodeLibelle}
      </h2>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-encre-3">Référence</dt>
        <dd className="tabular-nums text-encre">{appel.reference}</dd>
        <dt className="text-encre-3">Destinataire</dt>
        <dd className="text-encre">{appel.proprietaireNom}</dd>
        <dt className="text-encre-3">Échéance</dt>
        <dd className="tabular-nums text-encre">{formaterDate(appel.dateEcheance)}</dd>
        {appel.reportAnterieur !== 0 && (
          <>
            <dt className="text-encre-3">Report antérieur</dt>
            <dd className="tabular-nums text-encre">{formaterXof(appel.reportAnterieur)}</dd>
          </>
        )}
      </dl>

      {appel.anomalies.length > 0 && (
        <p className="mt-4 rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
          Envoi bloqué : {appel.anomalies.map((a) => LIBELLES_ANOMALIE_CONTACT[a]).join(", ")}.
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="py-2 pr-2">Lot</th>
              <th className="py-2 pr-2">Poste</th>
              <th className="py-2 pr-2 text-right">Base</th>
              <th className="py-2 text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {appel.lignes.map((ligne, index) => (
              <tr key={index} className="border-b border-filet last:border-0">
                <td className="py-1.5 pr-2 tabular-nums text-encre">{ligne.lotNumero}</td>
                <td className="py-1.5 pr-2 text-encre-2">{ligne.posteLibelle}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-encre-2">
                  {formaterNombre(ligne.baseCalcul)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-encre">
                  {formaterXof(ligne.montant)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium text-encre">
              <td className="pt-3" colSpan={3}>
                Total appelé
              </td>
              <td className="pt-3 text-right tabular-nums">{formaterXof(appel.montantTotal)}</td>
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
