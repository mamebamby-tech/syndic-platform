import { useFormatter, useTranslations } from "next-intl";
import { useValeurs } from "@/lib/i18n/utiliser-valeurs";
import type { VersionEnAttente } from "@/lib/data/parametres-immeuble";
import type { JeuCoordonnees, SituationVersion } from "@/lib/parametres/double-validation";
import { memesCoordonnees } from "@/lib/parametres/double-validation";
import {
  confirmerModification,
  refuserModification,
} from "@/app/immeubles/[immeubleId]/parametres/actions";

// La modification qui attend confirmation, en CLAIR : pour confirmer il faut
// pouvoir comparer chaque valeur à sa source. (Le tableau de bord, lu par tout le
// personnel, la montre masquée ; cette page est réservée aux membres habilités.)
export function PanneauModificationEnAttente({
  immeubleId,
  version,
  enVigueur,
  situation,
}: {
  immeubleId: string;
  version: VersionEnAttente;
  enVigueur: JeuCoordonnees;
  situation: SituationVersion;
}) {
  const t = useTranslations("Parametres.enAttente");
  const tChamps = useTranslations("TableauDeBord.champs");
  const tMoyen = useTranslations("MoyenPaiement");
  const valeurs = useValeurs();
  const format = useFormatter();

  const propose: JeuCoordonnees = {
    titulaire: version.titulaire,
    banque: version.banque,
    numero: version.numero,
    bic: version.bic,
    moyens: version.moyens,
    marchands: version.marchands,
  };

  const texte = (valeur: string) => (valeur.trim().length > 0 ? valeur : t("vide"));
  const moyens = (liste: readonly string[]) =>
    liste.length === 0
      ? t("aucun")
      : format.list(
          liste.map((moyen) => tMoyen(moyen as "wave")),
          { type: "unit", style: "long" },
        );
  const marchands = (numeros: Record<string, string>) =>
    Object.keys(numeros).length === 0
      ? t("aucun")
      : Object.entries(numeros)
          .map(([moyen, numero]) => `${tMoyen(moyen as "wave")} : ${numero}`)
          .join(", ");

  const lignes: { cle: "compte_titulaire" | "compte_banque" | "compte_numero" | "compte_bic" | "moyens_paiement_acceptes" | "numeros_marchands"; avant: string; apres: string; change: boolean }[] = [
    { cle: "compte_titulaire", avant: texte(enVigueur.titulaire), apres: texte(propose.titulaire), change: enVigueur.titulaire.trim() !== propose.titulaire.trim() },
    { cle: "compte_banque", avant: texte(enVigueur.banque), apres: texte(propose.banque), change: enVigueur.banque.trim() !== propose.banque.trim() },
    { cle: "compte_numero", avant: texte(enVigueur.numero), apres: texte(propose.numero), change: enVigueur.numero.trim() !== propose.numero.trim() },
    { cle: "compte_bic", avant: texte(enVigueur.bic), apres: texte(propose.bic), change: enVigueur.bic.trim() !== propose.bic.trim() },
    {
      cle: "moyens_paiement_acceptes",
      avant: moyens(enVigueur.moyens),
      apres: moyens(propose.moyens),
      change: !memesCoordonnees({ ...enVigueur, moyens: enVigueur.moyens }, { ...enVigueur, moyens: propose.moyens }),
    },
    {
      cle: "numeros_marchands",
      avant: marchands(enVigueur.marchands),
      apres: marchands(propose.marchands),
      change: !memesCoordonnees({ ...enVigueur }, { ...enVigueur, marchands: propose.marchands }),
    },
  ];

  const classeBouton = "h-11 rounded-control px-4 text-sm disabled:opacity-50";

  return (
    <section
      aria-labelledby="modification-en-attente"
      className="mb-8 rounded-card border border-alerte-doux bg-alerte-doux p-6 text-encre"
    >
      <h2 id="modification-en-attente" className="font-serif text-lg text-alerte">
        {t("titre")}
      </h2>
      <p className="mt-1 text-sm text-encre-2">
        {version.proposeParLibelle
          ? t("proposeePar", { date: valeurs.dateHeure(version.proposeLe), auteur: version.proposeParLibelle })
          : t("proposeeAuteurInconnu", { date: valeurs.dateHeure(version.proposeLe) })}
      </p>

      <div className="mt-4 overflow-x-auto rounded-control bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-filet text-left text-xs uppercase tracking-wide text-encre-3">
              <th className="px-3 py-2 font-medium">{t("champ")}</th>
              <th className="px-3 py-2 font-medium">{t("enVigueur")}</th>
              <th className="px-3 py-2 font-medium">{t("propose")}</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.cle} className="border-b border-filet last:border-0">
                <td className="px-3 py-2 text-encre-3">{tChamps(ligne.cle)}</td>
                <td className="px-3 py-2 tabular-nums text-encre-2">{ligne.avant}</td>
                <td className={`px-3 py-2 tabular-nums ${ligne.change ? "font-medium text-encre" : "text-encre-2"}`}>
                  {ligne.apres}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-encre-2">{t("consigne")}</p>
      {situation.peutConfirmer && <p className="mt-1 text-sm text-encre-2">{t("verifier")}</p>}
      {situation.estAuteur && (
        <p className="mt-2 text-sm text-alerte">{t("vousEtesAuteur")}</p>
      )}
      {situation.aucunAutreHabilite && (
        <p role="alert" className="mt-2 rounded-control bg-impaye-doux px-3 py-2 text-sm text-impaye">
          {t("aucunAutreHabilite")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {situation.peutConfirmer && (
          <form action={confirmerModification}>
            <input type="hidden" name="immeubleId" value={immeubleId} />
            <input type="hidden" name="versionId" value={version.id} />
            <button type="submit" className={`${classeBouton} bg-action text-white`}>
              {t("confirmer")}
            </button>
          </form>
        )}
        <form action={refuserModification}>
          <input type="hidden" name="immeubleId" value={immeubleId} />
          <input type="hidden" name="versionId" value={version.id} />
          <button type="submit" className={`${classeBouton} border border-filet bg-surface text-encre`}>
            {situation.estAuteur ? t("retirer") : t("refuser")}
          </button>
        </form>
      </div>
    </section>
  );
}
