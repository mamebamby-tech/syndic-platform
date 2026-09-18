import { notFound } from "next/navigation";
import { listerImmeublesAccessibles, trouverImmeuble } from "@/lib/data/immeubles";
import { BarreLaterale } from "@/components/nav/barre-laterale";

export default async function GabaritImmeuble({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ immeubleId: string }>;
}) {
  const { immeubleId } = await params;

  // La sécurité par ligne fait déjà le tri : si l'immeuble n'appartient
  // pas au cabinet de l'utilisateur connecté, trouverImmeuble renvoie null.
  const [immeuble, immeubles] = await Promise.all([
    trouverImmeuble(immeubleId),
    listerImmeublesAccessibles(),
  ]);

  if (!immeuble) {
    notFound();
  }

  const organisationNom =
    immeubles.find((candidat) => candidat.id === immeubleId)?.organisation_nom ?? "";

  return (
    <div className="flex min-h-screen bg-fond">
      <BarreLaterale
        organisationNom={organisationNom}
        immeubles={immeubles}
        immeubleActuelId={immeubleId}
      />
      <main className="min-w-0 flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
