import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  chargerParametres,
  chargerVersionEnAttente,
  compterMembresHabilites,
  peutParametrer,
  roleSurOrganisation,
  utilisateurCourantId,
} from "@/lib/data/parametres-immeuble";
import { situationDeLaVersion } from "@/lib/parametres/double-validation";
import { PanneauModificationEnAttente } from "@/components/parametres/panneau-modification-en-attente";
import { getValeurs } from "@/lib/i18n/valeurs-serveur";
import { codePeriode } from "@/lib/parametres/reference";
import { FormulaireParametres } from "@/components/parametres/formulaire-parametres";

const DECISIONS = ["confirmee", "refusee", "auteur", "plus_en_attente", "non_autorise", "erreur"] as const;

export default async function PageParametres({
  params,
  searchParams,
}: {
  params: Promise<{ immeubleId: string }>;
  searchParams: Promise<{ decision?: string }>;
}) {
  const { immeubleId } = await params;
  const { decision } = await searchParams;
  const parametres = await chargerParametres(immeubleId);
  if (!parametres) notFound();

  const t = await getTranslations("Parametres");

  // Réservé au gestionnaire et au proprietaire_org. La sécurité par ligne
  // interdit de toute façon l'écriture à un lecteur : ceci évite de lui montrer
  // un formulaire qui ne peut pas aboutir.
  if (!peutParametrer(await roleSurOrganisation(parametres.organisationId))) {
    return (
      <div>
        <h1 className="text-2xl text-encre">{t("accesReserve.titre")}</h1>
        <p className="mt-4 text-sm text-encre-2">{t("accesReserve.message")}</p>
      </div>
    );
  }

  const valeurs = await getValeurs();
  const [version, habilites, utilisateurId] = await Promise.all([
    chargerVersionEnAttente(immeubleId),
    compterMembresHabilites(parametres.organisationId),
    utilisateurCourantId(),
  ]);
  const situation = version ? situationDeLaVersion(version.proposePar, utilisateurId, habilites) : null;
  const decisionConnue = DECISIONS.find((d) => d === decision);
  const maintenant = new Date();
  // Sans règlement en vigueur, la périodicité est inconnue : pas d'exemple
  // plutôt qu'une périodicité inventée.
  const periodicite = parametres.periodicite;

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-1 text-sm text-encre-2">{t("introduction")}</p>
      </header>

      {decisionConnue && (
        <p
          role="status"
          className={`mb-6 rounded-control px-3 py-2 text-sm ${
            decisionConnue === "confirmee" || decisionConnue === "refusee"
              ? "bg-action-doux text-action-encre"
              : "bg-impaye-doux text-impaye"
          }`}
        >
          {t(`decision.${decisionConnue}`)}
        </p>
      )}

      {version && situation && (
        <PanneauModificationEnAttente
          immeubleId={immeubleId}
          version={version}
          enVigueur={{
            titulaire: parametres.titulaire,
            banque: parametres.banque,
            numero: parametres.numero,
            bic: parametres.bic,
            moyens: parametres.moyens,
            marchands: parametres.marchands,
          }}
          situation={situation}
        />
      )}

      <FormulaireParametres
        // Remonté à chaque changement enregistré ou proposé : les champs reprennent les valeurs enregistrées.
        key={`${parametres.compteModifieLe}|${parametres.codeReference}|${parametres.formatReference}|${version?.id ?? ""}`}
        enAttenteExiste={version !== null}
        parametres={parametres}
        exemple={
          periodicite
            ? {
                annee: maintenant.getUTCFullYear(),
                periode: codePeriode(periodicite, maintenant.getUTCMonth() + 1),
              }
            : null
        }
        dateDerniereModification={
          parametres.compteModifieLe ? valeurs.dateJuridique(parametres.compteModifieLe) : null
        }
      />
    </div>
  );
}
