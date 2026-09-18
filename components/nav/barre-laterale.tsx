import { seDeconnecter } from "@/app/auth/actions";
import type { ImmeubleAvecOrganisation } from "@/lib/data/immeubles";
import { SelecteurImmeuble } from "./selecteur-immeuble";
import { LienNav } from "./lien-nav";

export function BarreLaterale({
  organisationNom,
  immeubles,
  immeubleActuelId,
}: {
  organisationNom: string;
  immeubles: ImmeubleAvecOrganisation[];
  immeubleActuelId: string;
}) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-filet bg-surface">
      <div className="border-b border-filet p-4">
        <p className="font-serif text-lg text-marque">{organisationNom}</p>
        <div className="mt-3">
          <SelecteurImmeuble immeubles={immeubles} immeubleActuelId={immeubleActuelId} />
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        <LienNav href={`/immeubles/${immeubleActuelId}/lots`}>
          Registre des lots
        </LienNav>
      </nav>

      <form action={seDeconnecter} className="border-t border-filet p-3">
        <button
          type="submit"
          className="w-full rounded-control px-3 py-2 text-left text-sm text-encre-2 hover:bg-action-doux/60"
        >
          Se déconnecter
        </button>
      </form>
    </aside>
  );
}
