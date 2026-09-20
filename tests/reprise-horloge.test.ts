import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DELAIS_REPRISE_MS, fetchAvecReprise } from "@/lib/supabase/reprise";

// « JWT issued at future » : PostgREST refuse un jeton neuf si son horloge retarde.
// La reprise est bornée, ne rejoue que cette erreur-là, et rend la dernière réponse
// intacte quand le décalage persiste.

const SANS_ATTENTE = [0, 0, 0, 0];

const decalage = () =>
  new Response(JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer error="invalid_token", error_description="JWT issued at future"' },
  });
const ok = () => new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { "content-type": "application/json" } });

function sequence(...reponses: Array<() => Response>) {
  let i = 0;
  const appels: Array<[unknown, RequestInit | undefined]> = [];
  const base = vi.fn(async (entree: RequestInfo | URL, init?: RequestInit) => {
    appels.push([entree, init]);
    const fabrique = reponses[Math.min(i++, reponses.length - 1)]!;
    return fabrique();
  }) as unknown as typeof fetch;
  return { base, appels };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("fetchAvecReprise", () => {
  it("rejoue la requête refusée pour décalage d'horloge, jusqu'à ce qu'elle passe", async () => {
    const { base, appels } = sequence(decalage, decalage, ok);
    const reponse = await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots", { method: "GET" });
    expect(reponse.status).toBe(200);
    expect(appels).toHaveLength(3);
  });

  it("ne rejoue pas une réponse réussie", async () => {
    const { base, appels } = sequence(ok);
    await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots");
    expect(appels).toHaveLength(1);
  });

  it("ne rejoue pas les autres 401 (jeton expiré, jeton invalide) : ce ne sont pas des décalages", async () => {
    for (const message of ["JWT expired", "JWSError JWSInvalidSignature"]) {
      const { base, appels } = sequence(
        () => new Response(JSON.stringify({ code: "PGRST301", message }), { status: 401, headers: { "content-type": "application/json" } }),
      );
      const reponse = await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots");
      expect(reponse.status, message).toBe(401);
      expect(appels, message).toHaveLength(1);
    }
  });

  it("ne rejoue ni un 403, ni un 500", async () => {
    for (const statut of [403, 500]) {
      const { base, appels } = sequence(() => new Response("{}", { status: statut }));
      await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots");
      expect(appels).toHaveLength(1);
    }
  });

  it("est BORNÉE : après les reprises prévues, rend la dernière réponse, lisible, sans boucler", async () => {
    const { base, appels } = sequence(decalage);
    const reponse = await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots");
    expect(appels).toHaveLength(1 + SANS_ATTENTE.length);
    expect(reponse.status).toBe(401);
    expect((await reponse.json()).code).toBe("PGRST303"); // le corps n'a pas été consommé par la détection
  });

  it("l'attente totale par défaut reste sous quatre secondes", () => {
    expect(DELAIS_REPRISE_MS.length).toBeLessThanOrEqual(4);
    expect(DELAIS_REPRISE_MS.reduce((a, b) => a + b, 0)).toBeLessThan(4000);
  });

  it("attend réellement entre deux tentatives", async () => {
    vi.useFakeTimers();
    try {
      const { base, appels } = sequence(decalage, ok);
      const promesse = fetchAvecReprise(base, [500])("https://x/rest/v1/lots");
      await vi.advanceTimersByTimeAsync(499);
      expect(appels).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await promesse).status).toBe(200);
      expect(appels).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejoue un corps texte à l'identique (insert, appel de fonction)", async () => {
    const { base, appels } = sequence(decalage, ok);
    await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/rpc/f", { method: "POST", body: '{"a":1}' });
    expect(appels.map(([, init]) => init?.body)).toEqual(['{"a":1}', '{"a":1}']);
  });

  it("ne rejoue pas ce qu'elle ne peut pas rejouer (flux, Request déjà construite)", async () => {
    const flux = new ReadableStream();
    const a = sequence(decalage, ok);
    const r1 = await fetchAvecReprise(a.base, SANS_ATTENTE)("https://x/", { method: "POST", body: flux, duplex: "half" } as RequestInit);
    expect(r1.status).toBe(401);
    expect(a.appels).toHaveLength(1);
    const b = sequence(decalage, ok);
    const r2 = await fetchAvecReprise(b.base, SANS_ATTENTE)(new Request("https://x/", { method: "POST", body: "x" }));
    expect(r2.status).toBe(401);
    expect(b.appels).toHaveLength(1);
  });

  it("s'interrompt si la requête est annulée pendant l'attente", async () => {
    const { base, appels } = sequence(decalage, ok);
    const controle = new AbortController();
    const promesse = fetchAvecReprise(base, [10_000])("https://x/", { signal: controle.signal });
    setTimeout(() => controle.abort(new Error("annulée")), 5);
    await expect(promesse).rejects.toThrow("annulée");
    expect(appels).toHaveLength(1);
  });

  it("consigne chaque reprise dans les journaux, sans jeton", async () => {
    const { base } = sequence(decalage, ok);
    await fetchAvecReprise(base, SANS_ATTENTE)("https://x/rest/v1/lots", { headers: { Authorization: "Bearer secret-jeton" } });
    const lignes = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatch(/^\[horloge\]/);
    expect(lignes[0]).not.toMatch(/secret-jeton|Bearer/);
  });
});

describe("de bout en bout : supabase-js contre un faux PostgREST en retard d'horloge", () => {
  let serveur: Server;
  let requetes: number;
  let refusees: number;
  beforeEach(async () => {
    requetes = 0;
    serveur = createServer((req, res) => {
      requetes++;
      if (requetes <= refusees) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": 'Bearer error="invalid_token", error_description="JWT issued at future"' });
        res.end(JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "1", nom: "Mamelles Tower" }]));
      }
    });
    await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  });
  afterEach(async () => {
    await new Promise<void>((r) => serveur.close(() => r()));
  });
  const client = (delais: readonly number[]) =>
    createClient(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`, "cle-anonyme-factice", {
      global: { fetch: fetchAvecReprise(fetch, delais) },
      auth: { persistSession: false },
    });

  it("deux refus, puis la requête aboutit : l'appelant ne voit aucune erreur", async () => {
    refusees = 2;
    const { data, error } = await client(SANS_ATTENTE).from("immeubles").select("id, nom");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "1", nom: "Mamelles Tower" }]);
    expect(requetes).toBe(3);
  });

  it("décalage permanent : l'erreur PGRST303 remonte après les reprises bornées", async () => {
    refusees = 999;
    const { data, error } = await client(SANS_ATTENTE).from("immeubles").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST303");
    expect(requetes).toBe(1 + SANS_ATTENTE.length);
  });

  it("un insert refusé pour décalage n'est rejoué qu'avec le même corps", async () => {
    refusees = 1;
    const { error } = await client(SANS_ATTENTE).from("immeubles").insert({ nom: "Test" });
    expect(error).toBeNull();
    expect(requetes).toBe(2);
  });
});

describe("branchement : les deux chemins passent par la reprise", () => {
  const code = (fichier: string) => readFileSync(fichier, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("le client serveur et celui du proxy utilisent fetchAvecReprise", () => {
    for (const fichier of ["lib/supabase/server.ts", "lib/supabase/proxy.ts"]) {
      expect(code(fichier), fichier).toMatch(/global:\s*\{\s*fetch:\s*fetchAvecReprise\(\)/);
    }
  });

  it("la route de développement n'a plus d'attente fixe, et passe par le même client serveur", () => {
    const route = code("app/auth/confirmation/route.ts");
    expect(route).not.toMatch(/setTimeout|ATTENTE|DEV_LIEN_ATTENTE/);
    expect(route).toMatch(/creerClientServeur\(\)/);
  });

  it("la connexion normale (page d'accueil) interroge via ce même client serveur", () => {
    expect(code("lib/data/immeubles.ts")).toMatch(/creerClientServeur/);
  });
});
