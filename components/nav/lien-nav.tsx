"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LienNav({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const actif = pathname === href || pathname.startsWith(`${href}/`);

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
