"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// `exact` : le tableau de bord (/immeubles/<id>) est le préfixe de toutes les
// autres pages de l'immeuble ; sans lui il serait toujours « actif ».
export function LienNav({
  href,
  children,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const actif = pathname === href || (!exact && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={`block rounded-control px-3 py-2 text-sm transition-colors ${
        actif ? "bg-action-doux text-action-encre" : "text-encre-2 hover:bg-action-doux/60"
      }`}
    >
      {children}
    </Link>
  );
}
