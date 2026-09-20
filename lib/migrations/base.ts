import type { Client } from "pg";
import { MARQUEURS } from "./marqueurs.ts";
import {
  calculerEtat,
  type EtatMigrations,
  type MigrationDuDepot,
  type MigrationEnregistree,
} from "./migrations.ts";

// Couche base du suivi des migrations. L'historique vit dans la base qu'il décrit :
// `supabase_migrations.schema_migrations`, la table même de la CLI Supabase (version,
// name, statements), plus une colonne `empreinte` (sha-256 du fichier appliqué). Un
// projet qui adopterait la CLI plus tard retrouve son historique.
//
// LECTURE : `lireEtat` ne fait que des `select` de catalogue, dans une transaction
// `read only` — la base refuse elle-même toute écriture. C'est ce qui sert à afficher
// l'écart d'une base réelle sans la toucher.

export async function lireEtat(client: Client, depot: MigrationDuDepot[]): Promise<EtatMigrations> {
  await client.query("begin read only");
  try {
    const { rows: presence } = await client.query<{ existe: boolean; avec_empreinte: boolean }>(
      `select to_regclass('supabase_migrations.schema_migrations') is not null as existe,
              exists (select 1 from information_schema.columns
                      where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
                        and column_name = 'empreinte') as avec_empreinte`,
    );
    const historiqueExiste = presence[0]!.existe;
    let enregistrees: MigrationEnregistree[] = [];
    if (historiqueExiste) {
      const colonne = presence[0]!.avec_empreinte ? "empreinte" : "null::text as empreinte";
      const { rows } = await client.query<MigrationEnregistree>(
        `select version, name as nom, ${colonne} from supabase_migrations.schema_migrations order by version`,
      );
      enregistrees = rows;
    }

    // Chaque trace dans son point de sauvegarde : une expression qui échoue (un schéma
    // absent, par exemple) est « trace absente », pas une lecture interrompue.
    const marqueurs: Record<string, boolean> = {};
    for (const [version, expression] of Object.entries(MARQUEURS)) {
      await client.query("savepoint marqueur");
      try {
        const { rows } = await client.query<{ present: boolean }>(`select coalesce((${expression}), false) as present`);
        marqueurs[version] = rows[0]!.present === true;
        await client.query("release savepoint marqueur");
      } catch {
        await client.query("rollback to savepoint marqueur");
        marqueurs[version] = false;
      }
    }
    return calculerEtat({ depot, enregistrees, historiqueExiste, marqueurs });
  } finally {
    await client.query("rollback");
  }
}

// ÉCRITURES — n'appeler qu'après la confirmation de la cible.

const CREER_HISTORIQUE = `
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version    text primary key,
    statements text[],
    name       text
  );
  alter table supabase_migrations.schema_migrations add column if not exists empreinte text;
  alter table supabase_migrations.schema_migrations enable row level security;
`;

async function enregistrer(client: Client, m: MigrationDuDepot, empreinte: string | null): Promise<void> {
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name, empreinte) values ($1, $2, $3)
     on conflict (version) do nothing`,
    [m.version, m.nom, empreinte],
  );
}

// Enregistre comme appliquées les migrations DÉDUITES (appliquées avant le suivi). N'exécute
// aucun SQL de migration. L'empreinte reste vide : on ignore quelle version du fichier a été
// appliquée à l'époque, donc on ne prétend pas la connaître.
export async function adopter(client: Client, deduites: MigrationDuDepot[]): Promise<void> {
  await client.query("begin");
  try {
    await client.query(CREER_HISTORIQUE);
    for (const m of deduites) await enregistrer(client, m, null);
    await client.query("commit");
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  }
}

// Une migration et son enregistrement dans la MÊME transaction : ou elle est appliquée et
// enregistrée, ou rien n'a changé.
export async function appliquerUne(client: Client, m: MigrationDuDepot): Promise<void> {
  await client.query("begin");
  try {
    await client.query(CREER_HISTORIQUE);
    await client.query(m.sql);
    await enregistrer(client, m, m.empreinte);
    await client.query("commit");
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  }
}

// Un seul exécutant à la fois par base.
const VERROU = 7_331_020_926;
export async function verrouiller(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock($1) as ok`, [VERROU]);
  return rows[0]!.ok;
}
