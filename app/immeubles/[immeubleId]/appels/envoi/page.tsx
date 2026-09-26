import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { chargerAppelsAEnvoyer } from "@/lib/data/envoi-appels";
import { recapituler } from "@/lib/appels/envoi";
import { peutParametrer, roleSurOrganisation } from "@/lib/data/parametres-immeuble";
import { trouverImmeuble } from "@/lib/data/immeubles";
import { configurationCourriel } from "@/lib/courriel/configuration";
import { enDemonstration } from "@/lib/demonstration";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { FormulaireEnvoi } from "@/components/appels/formulaire-envoi";
import type { EtatEnvoi } from "@/lib/data/anomalie-contact";

// Le récapitulatif obligatoire avant tout envoi (décision 70) : chaque
// destinataire, son état, le décompte par état, les injoignables NOMMÉS. Rien
// ne part tant que le gestionnaire ne l'a pas validé.

const ETATS: EtatEnvoi[] = ["pret", "courriel_seulement", "whatsapp_seulement", "injoignable"];
const TON: Record<EtatEnvoi, string> = {
  pret: "text-action",
  courriel_seulement: "text-alerte",
  whatsapp_seulement: "text-alerte",
  injoignable: "text-impaye",
};

export default async function PageEnvoi({ params }: { params: Promise<{ immeubleId: string }> }) {
  const { immeubleId } = await params;
  const [t, valeurs, donnees, immeuble] = await Promise.all([
    getTranslations("Envoi"),
    getValeurs(),
    chargerAppelsAEnvoyer(immeubleId),
    trouverImmeuble(immeubleId),
  ]);
  const habilite = immeuble ? peutParametrer(await roleSurOrganisation(immeuble.organisation_id)) : false;
  const recap = recapituler(donnees.appels);
  const partiront = recap.lignes.filter((l) => l.parCourriel && l.dernierEnvoiLe === null).length;

  return (
    <div className="max-w-5xl">
      <Link href={`/immeubles/${immeubleId}/appels`} className="text-sm text-action underline-offset-2 hover:underline">
        {t("retour")}
      </Link>
      <h1 className="mt-2 text-2xl text-encre">{t("titre", { periode: donnees.periode?.libelle ?? "" })}</h1>

      {recap.lignes.length === 0 ? (
        <p className="mt-4 text-sm text-encre-2">{t("aucunAppel")}</p>
      ) : (
        <>
          <section aria-labelledby="recapitulatif" className="mt-6">
            <h2 id="recapitulatif" className="font-serif text-lg text-marque">{t("recapitulatif")}</h2>
            <p className="mt-1 text-sm text-encre-2">{t("consigneRecapitulatif")}</p>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ETATS.map((etat) => (
                <li key={etat} className="rounded-card border border-filet bg-surface p-3">
                  <span className={`text-sm font-medium tabular-nums ${recap.decompte[etat] > 0 ? TON[etat] : "text-encre-3"}`}>
                    {t(`decompte.${etat}`, { nombre: recap.decompte[etat] })}
                  </span>
                </li>
              ))}
            </ul>

            {recap.injoignables.length > 0 && (
              <p role="alert" className="mt-3 rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
                {t("injoignables", { noms: recap.injoignables.join(", ") })}
              </p>
            )}
            {recap.whatsappSeulement.length > 0 && (
              <p className="mt-3 rounded-control bg-alerte-doux px-3 py-2 text-sm text-alerte">
                {t("whatsappSeulement", { noms: recap.whatsappSeulement.join(", ") })}
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-card border border-filet bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
                    <th className="px-4 py-3 font-medium">{t("colonnes.destinataire")}</th>
                    <th className="px-4 py-3 font-medium">{t("colonnes.reference")}</th>
                    <th className="px-4 py-3 font-medium">{t("colonnes.etat")}</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">{t("colonnes.adresse")}</th>
                    <th className="px-4 py-3 font-medium">{t("colonnes.envoi")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-filet">
                  {recap.lignes.map((l) => (
                    <tr key={l.appelId}>
                      <td className="px-4 py-3 text-encre">{l.destinataireNom}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-encre-2">{l.reference}</td>
                      <td className={`px-4 py-3 ${TON[l.etat]}`}>{t(`etat.${l.etat}`)}</td>
                      <td className="hidden px-4 py-3 text-encre-2 md:table-cell">{l.email ?? ""}</td>
                      <td className="px-4 py-3 text-encre-2">
                        {l.dernierEnvoiLe ? t("envoyeLe", { date: valeurs.dateHeure(l.dernierEnvoiLe) }) : t("jamaisEnvoye")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {donnees.sansPdf.length > 0 && (
              <p className="mt-2 text-xs text-encre-3">{t("sansPdf", { nombre: donnees.sansPdf.length })}</p>
            )}
          </section>

          {!habilite ? (
            <p className="mt-6 text-sm text-encre-2">{t("reserve")}</p>
          ) : !configurationCourriel() ? (
            <p role="alert" className="mt-6 rounded-control bg-alerte-doux px-3 py-2 text-sm text-alerte">
              {t("nonConfigure")}
            </p>
          ) : (
            <FormulaireEnvoi
              immeubleId={immeubleId}
              demonstration={enDemonstration()}
              partiront={partiront}
              dejaEnvoyes={recap.lignes.filter((l) => l.parCourriel && l.dernierEnvoiLe !== null).length}
            />
          )}
        </>
      )}
    </div>
  );
}
