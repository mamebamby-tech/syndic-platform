import { trouverPeriodeCourante } from "@/lib/data/periodes";
import { listerAppelsDeLaPeriode } from "@/lib/data/appels";
import { ListeAppels } from "@/components/appels/liste-appels";

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

  if (!periode) {
    return (
      <div>
        <h1 className="text-2xl text-encre">Appels de fonds</h1>
        <p className="mt-4 text-sm text-encre-2">
          Aucune période n&apos;existe encore pour cet immeuble.
        </p>
      </div>
    );
  }

  const { appels, contexte } = await listerAppelsDeLaPeriode(
    immeubleId,
    periode.id,
    periode.libelle,
  );

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl text-encre">Appels de fonds — {periode.libelle}</h1>
        <p className="mt-1 text-sm text-encre-2">
          {appels.length} appel{appels.length > 1 ? "s" : ""} généré
          {appels.length > 1 ? "s" : ""}
        </p>
        {generes !== undefined && (
          <p className="mt-2 rounded-control bg-action-doux px-3 py-2 text-sm text-action-encre">
            Génération terminée : {generes} appel{Number(generes) > 1 ? "s" : ""} créé
            {Number(generes) > 1 ? "s" : ""}.
          </p>
        )}
      </header>

      <ListeAppels immeubleId={immeubleId} appels={appels} contexte={contexte} />
    </div>
  );
}
