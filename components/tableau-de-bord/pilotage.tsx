import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useValeurs } from "@/lib/i18n/utiliser-valeurs";
import type { PeriodeCourante } from "@/lib/data/periodes";
import type {
  MontantParTranche,
  Recouvrement,
  Retards,
  TrancheAnciennete,
} from "@/lib/recouvrement/calcul";

// Le pilotage du tableau de bord. Règle : chaque chiffre mène à une action — un
// lien vers la liste filtrée ou l'écran qui permet d'agir. Un chiffre sans
// action n'a pas sa place ici.

const carte = "rounded-card border border-filet bg-surface p-4";
const lien = "text-action underline-offset-2 hover:underline";

export function useLibelleTranche() {
  const t = useTranslations("TableauDeBord.anciennete");
  return (tranche: TrancheAnciennete) => {
    if (tranche.min === null) return t("aEchoir");
    if (tranche.max === null) return t("audela", { jours: tranche.min - 1 });
    return t("tranche", { min: tranche.min, max: tranche.max });
  };
}

export function PeriodeEnCours({
  periode,
  joursAvantEcheance,
  immeubleId,
}: {
  periode: PeriodeCourante | null;
  joursAvantEcheance: number | null;
  immeubleId: string;
}) {
  const t = useTranslations("TableauDeBord.periode");
  const valeurs = useValeurs();

  if (!periode || joursAvantEcheance === null) {
    return (
      <section className={carte}>
        <p className="text-sm text-encre-2">{t("aucune")}</p>
        <Link href={`/immeubles/${immeubleId}/budget`} className={`mt-2 inline-block text-sm ${lien}`}>
          {t("ouvrirBudget")}
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="periode-en-cours">
      <h2 id="periode-en-cours" className="text-xs uppercase tracking-wide text-encre-3">
        {t("titre")}
      </h2>
      <Link href={`/immeubles/${immeubleId}/appels`} className="group mt-1 block">
        <p className="font-serif text-xl text-encre group-hover:text-action">
          {t("exercicePeriode", { exercice: periode.exerciceLibelle, periode: periode.libelle })}
        </p>
        <p className="mt-0.5 text-sm text-encre-2">
          {t("echeance", { date: valeurs.dateJuridique(periode.dateEcheance) })}
          {" · "}
          <span className={joursAvantEcheance < 0 ? "text-impaye" : "text-encre"}>
            {joursAvantEcheance >= 0
              ? t("dans", { jours: joursAvantEcheance })
              : t("depuis", { jours: -joursAvantEcheance })}
          </span>
        </p>
      </Link>
    </section>
  );
}

// `className` : la teinte du montant (un jeton de la charte).
function Chiffre({ libelle, montant, href, className = "text-encre" }: {
  libelle: string;
  montant: string;
  href: string;
  className?: string;
}) {
  return (
    // Téléphone : une ligne, libellé à gauche, montant à droite ; au-delà : trois colonnes.
    <Link
      href={href}
      className="flex min-h-11 items-baseline justify-between gap-3 rounded-control px-1 py-1 hover:bg-action-doux/60 sm:block"
    >
      <span className="block text-sm text-encre-3 sm:text-xs">{libelle}</span>
      <span className={`block text-base font-medium tabular-nums sm:text-lg ${className}`}>{montant}</span>
    </Link>
  );
}

export function CarteRecouvrement({
  recouvrement,
  echeancePassee,
  immeubleId,
}: {
  recouvrement: Recouvrement;
  // Avant l'échéance, le reste dû est à échoir : pas un impayé, pas de rouge.
  echeancePassee: boolean;
  immeubleId: string;
}) {
  const t = useTranslations("TableauDeBord.recouvrement");
  const format = useFormatter();
  const valeurs = useValeurs();
  const base = `/immeubles/${immeubleId}`;

  if (recouvrement.taux === null) {
    return (
      <section aria-labelledby="recouvrement" className={carte}>
        <h2 id="recouvrement" className="font-serif text-lg text-marque">{t("titre")}</h2>
        <p className="mt-1 text-sm text-encre-2">{t("aucunAppel")}</p>
        <Link href={`${base}/appels`} className={`mt-2 inline-block text-sm ${lien}`}>
          {t("ouvrirAppels")}
        </Link>
      </section>
    );
  }

  // Arrondi par défaut : 99,6 % encaissés ne s'affichent pas « 100 % ».
  const taux = Math.floor(recouvrement.taux * 100) / 100;
  const largeur = `${Math.min(100, recouvrement.taux * 100)}%`;

  return (
    <section aria-labelledby="recouvrement" className={carte}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="recouvrement" className="font-serif text-lg text-marque">{t("titre")}</h2>
        <Link href={`${base}/comptes`} className="text-sm font-medium tabular-nums text-action hover:underline">
          {t("taux", { taux: format.number(taux, "taux") })}
        </Link>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(taux * 100)}
        aria-label={t("barre")}
        className="mt-3 h-2.5 w-full overflow-hidden rounded-control bg-action-doux"
      >
        <div className="h-full bg-action" style={{ width: largeur }} />
      </div>

      <div className="mt-3 grid gap-1 sm:grid-cols-3 sm:gap-2">
        <Chiffre libelle={t("appele")} montant={valeurs.montant(recouvrement.appele)} href={`${base}/appels`} />
        <Chiffre libelle={t("encaisse")} montant={valeurs.montant(recouvrement.encaisse)} href={`${base}/comptes`} className="text-action" />
        <Chiffre
          libelle={t("resteDu")}
          montant={valeurs.montant(recouvrement.resteDu)}
          href={`${base}/comptes?filtre=reste-du`}
          className={recouvrement.resteDu > 0 && echeancePassee ? "text-impaye" : "text-encre"}
        />
      </div>

      {recouvrement.tropPercu > 0 && (
        <p className="mt-2 text-xs text-alerte">
          {t("tropPercu", { montant: valeurs.montant(recouvrement.tropPercu) })}
        </p>
      )}
    </section>
  );
}

export interface LigneRetard {
  proprietaireId: string;
  nom: string;
  montantEchu: number;
  joursRetardMax: number;
}

// Au-delà, la carte renvoie à la liste complète : elle reste une carte.
const LIGNES_RETARD_AFFICHEES = 5;

export function CarteRetards({
  retards,
  lignes,
  immeubleId,
}: {
  retards: Retards;
  // Déjà triées : le plus ancien retard d'abord.
  lignes: LigneRetard[];
  immeubleId: string;
}) {
  const t = useTranslations("TableauDeBord.retard");
  const valeurs = useValeurs();
  const affichees = lignes.slice(0, LIGNES_RETARD_AFFICHEES);
  const restantes = lignes.length - affichees.length;

  return (
    <section aria-labelledby="retards" className={carte}>
      <h3 id="retards" className="text-sm font-medium text-encre">{t("titre")}</h3>
      {retards.nombreProprietaires === 0 ? (
        <p className="mt-1 text-sm text-encre-2">{t("aucun")}</p>
      ) : (
        <Link href={`/immeubles/${immeubleId}/comptes?filtre=en-retard`} className="mt-1 block min-h-11 group">
          <span className="block text-2xl tabular-nums text-impaye group-hover:underline">
            {t("nombre", { nombre: retards.nombreProprietaires })}
          </span>
          <span className="block text-sm tabular-nums text-encre-2">
            {t("montant", { montant: valeurs.montant(retards.montant) })}
          </span>
        </Link>
      )}

      {affichees.length > 0 && (
        <>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-encre-3">
                <th className="py-1 font-normal">{t("colonneNom")}</th>
                <th className="py-1 text-right font-normal">{t("colonneEchu")}</th>
                <th className="py-1 pl-3 text-right font-normal">{t("colonneRetard")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-filet border-t border-filet">
              {affichees.map((ligne) => (
                <tr key={ligne.proprietaireId}>
                  <td className="py-2 pr-2">
                    <Link
                      href={`/immeubles/${immeubleId}/proprietaires/${ligne.proprietaireId}`}
                      className={lien}
                    >
                      {ligne.nom}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums text-impaye">
                    {valeurs.montant(ligne.montantEchu)}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums text-encre-2">
                    {t("jours", { jours: ligne.joursRetardMax })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link
            href={`/immeubles/${immeubleId}/comptes?filtre=en-retard`}
            className={`mt-2 inline-block min-h-11 py-2 text-sm ${lien}`}
          >
            {restantes > 0 ? `${t("autres", { nombre: restantes })} · ${t("voir")}` : t("voir")}
          </Link>
        </>
      )}
    </section>
  );
}

export function CarteAnciennete({
  repartition,
  immeubleId,
}: {
  repartition: MontantParTranche[];
  immeubleId: string;
}) {
  const t = useTranslations("TableauDeBord.anciennete");
  const valeurs = useValeurs();
  const libelle = useLibelleTranche();
  const plusGrand = Math.max(0, ...repartition.map((r) => r.montant));
  const total = repartition.reduce((somme, r) => somme + Math.round(r.montant * 100), 0) / 100;

  // Couleur selon la gravité, par les jetons de la charte : à échoir (pas
  // encore un retard), retard, puis la tranche la plus ancienne.
  const teinte = (index: number) =>
    index === 0 ? "bg-action" : index === repartition.length - 1 ? "bg-impaye" : "bg-alerte";

  return (
    <section aria-labelledby="anciennete" className={carte}>
      <h3 id="anciennete" className="text-sm font-medium text-encre">{t("titre")}</h3>
      {plusGrand === 0 ? (
        <p className="mt-1 text-sm text-encre-2">{t("aucun")}</p>
      ) : (
        <>
          <Link
            href={`/immeubles/${immeubleId}/comptes`}
            className="mt-1 flex min-h-11 items-baseline justify-between gap-3 rounded-control px-1 py-1 hover:bg-action-doux/60"
          >
            <span className="text-sm text-encre-2">{t("total")}</span>
            <span className="text-base font-medium tabular-nums text-encre">{valeurs.montant(total)}</span>
          </Link>
          <ul className="mt-1 space-y-1 border-t border-filet pt-2">
            {repartition.map((r, index) => {
              const contenu = (
                <>
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-encre-2">{libelle(r.tranche)}</span>
                    <span className={`tabular-nums ${r.montant > 0 ? "text-encre" : "text-encre-3"}`}>
                      {valeurs.montant(r.montant)}
                    </span>
                  </span>
                  <span className="mt-1 block h-2 w-full rounded-control bg-fond">
                    <span
                      className={`block h-full rounded-control ${teinte(index)}`}
                      style={{ width: `${plusGrand > 0 ? (r.montant / plusGrand) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="mt-0.5 block text-xs text-encre-3">
                    {t("appels", { nombre: r.nombreAppels })}
                  </span>
                </>
              );
              return (
                <li key={r.tranche.cle}>
                  {r.montant > 0 ? (
                    <Link
                      href={`/immeubles/${immeubleId}/comptes?anciennete=${r.tranche.cle}`}
                      className="block min-h-11 rounded-control px-1 py-1 hover:bg-action-doux/60"
                    >
                      {contenu}
                    </Link>
                  ) : (
                    <div className="px-1 py-1">{contenu}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-encre-3">{t("parAppel")}</p>
        </>
      )}
    </section>
  );
}

export function CarteInjoignables({ nombre, immeubleId }: { nombre: number; immeubleId: string }) {
  const t = useTranslations("TableauDeBord.injoignables");

  // Une anomalie à corriger, pas une statistique : sans anomalie, pas de chiffre.
  if (nombre === 0) {
    return (
      <section aria-labelledby="injoignables" className={carte}>
        <h3 id="injoignables" className="text-sm font-medium text-encre">{t("titre")}</h3>
        <p className="mt-1 text-sm text-encre-2">{t("aucun")}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="injoignables"
      role="alert"
      className="rounded-card border border-alerte-doux bg-alerte-doux p-4 text-alerte"
    >
      <h3 id="injoignables" className="text-sm font-medium">{t("titre")}</h3>
      <p className="mt-1 text-lg tabular-nums">{t("nombre", { nombre })}</p>
      <p className="mt-1 text-xs">{t("consigne")}</p>
      <Link
        href={`/immeubles/${immeubleId}/comptes?filtre=injoignables`}
        className="mt-2 inline-block min-h-11 py-2 text-sm text-action underline underline-offset-2"
      >
        {t("voir")}
      </Link>
    </section>
  );
}
