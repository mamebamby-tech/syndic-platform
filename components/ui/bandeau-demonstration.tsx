// Bandeau discret, en haut de chaque page, affiché seulement en démonstration
// (lib/demonstration.ts). Couleurs : jetons de la charte (docs/04-charte.md),
// `alerte` et `alerte-doux` — le fond des bandeaux d'alerte.
export function BandeauDemonstration({ texte }: { texte: string }) {
  return (
    <div
      role="status"
      className="border-b border-filet bg-alerte-doux px-4 py-1 text-center text-xs text-alerte"
    >
      {texte}
    </div>
  );
}
