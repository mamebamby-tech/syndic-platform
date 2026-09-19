import { getTranslations } from "next-intl/server";
import { trouverPeriodeCourante } from "@/lib/data/periodes";
import { listerAppelsDeLaPeriode } from "@/lib/data/appels";
import { ListeAppels } from "@/components/appels/liste-appels";
import { chargerDocumentLocalise } from "@/lib/i18n/document-serveur";

export default async function PageAppels({
  params,
  searchParams,
}: {
  params: Promise<{ immeubleId: string }>;
  searchParams: Promise<{ generes?: string }>;
}) {
  const { immeubleId } = await params;
  const { generes } = await searchParams;
  const periode = await trouverPeriodeCourante(immeubleId);
  const t = await getTranslations("Appels");

  if (!periode) {
    return (
      <div>
        <h1 className="text-2xl text-encre">{t("titre")}</h1>
        <p className="mt-4 text-sm text-encre-2">{t("aucunePeriode")}</p>
      </div>
    );
  }

  const { appels, contexte } = await listerAppelsDeLaPeriode(
    immeubleId,
    periode.id,
    periode.libelle,
  );

  // Le document est rendu dans sa langue opposable, pas dans celle de la
  // personne : voir lib/i18n/document.ts.
  const document = await chargerDocumentLocalise();
  const nombreGeneres = generes === undefined ? Number.NaN : Number(generes);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">{t("titrePeriode", { periode: periode.libelle })}</h1>
        <p className="mt-1 text-sm text-encre-2">{t("nombreGeneres", { nombre: appels.length })}</p>
        {Number.isFinite(nombreGeneres) && (
          <p className="mt-2 rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
            {t("generationTerminee", { nombre: nombreGeneres })}
          </p>
        )}
      </header>

      <ListeAppels
        immeubleId={immeubleId}
        appels={appels}
        contexte={contexte}
        document={document}
      />
    </div>
  );
}
