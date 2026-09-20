import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { commeUtilisateur } from "./simuler-utilisateur";
import { essayer } from "./aides";

// Audit complet de la sécurité par ligne (CLAUDE.md règle n°2), dans le
// prolongement de tests/rls-multitenant.test.ts. Deux volets :
//
// 1. Balayage générique de TOUTES les tables du schéma public : simule un
//    gestionnaire d'un second cabinet fictif, sans aucun lien avec Mamelles
//    Tower, et vérifie qu'il n'y voit rien. La liste des tables est lue
//    dans information_schema, pas recopiée à la main : une nouvelle table
//    sans politique correcte fait échouer ce test sans qu'il ait besoin
//    d'être mis à jour.
//
// 2. Pour les neuf politiques corrigées par
//    20260919040000_rls_with_check_audit.sql (with check (true) ou
//    using (true) d'origine), une tentative d'INSERT ciblée : c'est
//    précisément ce que le `using` ne protège pas, puisqu'un insert n'a
//    pas de ligne existante à filtrer — seul le `with check` gouverne.
//
// Pour que le balayage générique soit un vrai test et non un passage à
// vide sur des tables sans données, le beforeAll sème une ligne dans
// chaque table qui en manque, rattachée à Mamelles Tower.

const TABLES_PROPRES_AU_CABINET = new Set(["organisations", "immeubles", "membres"]);

// Tables où l'appartenance au cabinet ne se lit pas sur une colonne
// immeuble_id / organisation_id directe : hors du balayage générique par
// comptage, déjà couvertes autrement (acces_personnes est personnelle,
// journal est vérifiée par ailleurs, motifs_delai_renforce et
// types_majorite sont couvertes par le test d'insertion ciblé ci-dessous
// en plus du balayage générique).
const TABLES_HORS_BALAYAGE = new Set<string>();

describe("audit RLS — toutes les tables du schéma public", () => {
  let client: Client;
  let mamellesImmeubleId: string;
  let mamellesOrganisationId: string;
  let mamellesReglementId: string;
  let mamellesTypeMajoriteOrdinaireId: string;
  let unLotId: string;
  let unProprietaireId: string;
  let unAutreProprietaireId: string;
  let unPosteChargeId: string;
  let exerciceAuditId: string;
  let versionPaiementId: string;

  let userGestionnaireMamelles: string;
  let userLecteurMamelles: string;
  let userGestionnaireAutreCabinet: string;
  let autreOrganisationId: string;
  let autreImmeubleId: string;

  // Lignes semées pour que le balayage générique ne soit pas vide.
  let appelId: string;
  let paiementId: string;
  let assembleeId: string;
  let resolutionId: string;
  let documentId: string;
  let annonceId: string;
  let incidentId: string;
  let notificationId: string;
  let journalId: string;
  let occupantId: string;
  let accesPersonneId: string;

  // Purge les résidus d'un run INTERROMPU (arrêt de la suite, coupure réseau) : sans
  // elle, ses fixtures encore en base font échouer le beforeAll suivant (slug déjà
  // pris) et TOUS les tests du fichier sont sautés, définitivement. Chaque ligne se
  // reconnaît à son marqueur propre ; les comptes de test n'ont ni courriel, ni
  // téléphone, ni date de création (seul l'identifiant est inséré).
  async function purgerResidus(c: Client) {
    for (const sql of [
      `delete from paiements where appel_id in (select id from appels where reference = 'TEST-AUDIT-RLS')`,
      `delete from assemblees where id in (select assemblee_id from resolutions where titre = 'Résolution de test')`,
      `delete from documents where titre = 'Document de test' and storage_path = 'test/audit-rls.pdf'`,
      `delete from annonces where titre = 'Annonce de test'`,
      `delete from incidents where titre = 'Incident de test'`,
      `delete from notifications where gabarit = 'test'`,
      `delete from journal where entite = 'test' and action = 'test'`,
      `delete from coordonnees_paiement_versions where compte_titulaire = 'Test audit RLS'`,
      `delete from occupants where nom = 'Occupant de test'`,
      `delete from appels where reference = 'TEST-AUDIT-RLS'`,
      `delete from exercices where libelle = 'Exercice test audit RLS'`,
      `delete from organisations where slug = 'test-audit-rls'`,
      `delete from auth.users where email is null and phone is null and created_at is null`,
    ]) {
      await c.query(sql);
    }
  }

  beforeAll(async () => {
    client = await connecter();
    await purgerResidus(client);

    const { rows: immeuble } = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    const mamelles = immeuble[0];
    if (!mamelles) throw new Error("Immeuble 'Mamelles Tower' introuvable.");
    mamellesImmeubleId = mamelles.id;
    mamellesOrganisationId = mamelles.organisation_id;

    const { rows: reglement } = await client.query<{ id: string }>(
      `select id from reglements where immeuble_id = $1 and en_vigueur`,
      [mamellesImmeubleId],
    );
    mamellesReglementId = reglement[0]!.id;

    const { rows: typeMajorite } = await client.query<{ id: string }>(
      `select id from types_majorite where reglement_id = $1 and code = 'ordinaire'`,
      [mamellesReglementId],
    );
    mamellesTypeMajoriteOrdinaireId = typeMajorite[0]!.id;

    const { rows: lot } = await client.query<{ id: string }>(
      `select id from lots where immeuble_id = $1 order by numero limit 1`,
      [mamellesImmeubleId],
    );
    unLotId = lot[0]!.id;

    const { rows: proprietaires } = await client.query<{ id: string }>(
      `select id from proprietaires where immeuble_id = $1 and est_groupe = false
       order by nom limit 2`,
      [mamellesImmeubleId],
    );
    unProprietaireId = proprietaires[0]!.id;
    unAutreProprietaireId = proprietaires[1]!.id;

    const { rows: poste } = await client.query<{ id: string }>(
      `select id from postes_charges where immeuble_id = $1 limit 1`,
      [mamellesImmeubleId],
    );
    unPosteChargeId = poste[0]!.id;

    // Période FICTIVE, propre à ce test. Utiliser la période la plus récente
    // de l'immeuble dépendait de l'absence de données réelles : dès que les
    // appels réels sont générés, `unique (periode_id, proprietaire_id)` fait
    // échouer l'insertion ci-dessous. Supprimée avec son exercice en fin de test.
    const exercice = await client.query<{ id: string }>(
      `insert into exercices (immeuble_id, libelle, date_debut, date_fin)
       values ($1, 'Exercice test audit RLS', '2098-01-01', '2098-12-31') returning id`,
      [mamellesImmeubleId],
    );
    exerciceAuditId = exercice.rows[0]!.id;
    const periode = await client.query<{ id: string; date_echeance: string }>(
      `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
       values ($1, 'Période test audit RLS', '2098-01-01', '2098-03-31', '2098-01-01')
       returning id, date_echeance`,
      [exerciceAuditId],
    );
    const periodeMamelles = periode.rows[0]!;

    // --- Deux cabinets fictifs, pour la simulation de rôle ---
    const org = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ('Cabinet Test Audit RLS', 'test-audit-rls')
       returning id`,
    );
    autreOrganisationId = org.rows[0]!.id;

    const autreImmeuble = await client.query<{ id: string }>(
      `insert into immeubles (organisation_id, nom) values ($1, 'Immeuble Test Audit RLS')
       returning id`,
      [autreOrganisationId],
    );
    autreImmeubleId = autreImmeuble.rows[0]!.id;

    const userA = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    userGestionnaireMamelles = userA.rows[0]!.id;
    await client.query(
      `insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`,
      [mamellesOrganisationId, userGestionnaireMamelles],
    );

    // Un lecteur du même cabinet : lecture seule, partout (20260920000000).
    const userLecteur = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    userLecteurMamelles = userLecteur.rows[0]!.id;
    await client.query(
      `insert into membres (organisation_id, user_id, role) values ($1, $2, 'lecteur')`,
      [mamellesOrganisationId, userLecteurMamelles],
    );

    const userB = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    userGestionnaireAutreCabinet = userB.rows[0]!.id;
    await client.query(
      `insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`,
      [autreOrganisationId, userGestionnaireAutreCabinet],
    );

    // --- Une ligne par table vide, rattachée à Mamelles Tower, pour que
    // le balayage générique ne passe jamais à vide. ---
    const appel = await client.query<{ id: string }>(
      `insert into appels (periode_id, proprietaire_id, reference, date_echeance)
       values ($1, $2, 'TEST-AUDIT-RLS', $3) returning id`,
      [periodeMamelles.id, unProprietaireId, periodeMamelles.date_echeance],
    );
    appelId = appel.rows[0]!.id;
    await client.query(
      `insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant)
       values ($1, $2, $3, 1, 0)`,
      [appelId, unLotId, unPosteChargeId],
    );
    await client.query(`insert into mises_en_demeure (appel_id, envoyee_le) values ($1, current_date)`, [
      appelId,
    ]);
    await client.query(
      `insert into penalites (appel_id, base_calcul, taux_applique, periodes_retard, montant)
       values ($1, 0, 0, 0, 0)`,
      [appelId],
    );
    const paiement = await client.query<{ id: string }>(
      `insert into paiements (appel_id, proprietaire_id, montant, moyen) values ($1, $2, 0, 'virement') returning id`,
      [appelId, unProprietaireId],
    );
    paiementId = paiement.rows[0]!.id;

    const assemblee = await client.query<{ id: string }>(
      `insert into assemblees (immeuble_id, date_seance) values ($1, now()) returning id`,
      [mamellesImmeubleId],
    );
    assembleeId = assemblee.rows[0]!.id;
    const resolution = await client.query<{ id: string }>(
      `insert into resolutions (assemblee_id, ordre, titre, type_majorite_id)
       values ($1, 1, 'Résolution de test', $2) returning id`,
      [assembleeId, mamellesTypeMajoriteOrdinaireId],
    );
    resolutionId = resolution.rows[0]!.id;
    await client.query(
      `insert into convocations (assemblee_id, proprietaire_id, canal) values ($1, $2, 'email')`,
      [assembleeId, unProprietaireId],
    );
    await client.query(`insert into presences (assemblee_id, proprietaire_id) values ($1, $2)`, [
      assembleeId,
      unProprietaireId,
    ]);
    await client.query(
      `insert into votes (resolution_id, proprietaire_id, sens, voix) values ($1, $2, 'pour', 1)`,
      [resolutionId, unProprietaireId],
    );

    const document = await client.query<{ id: string }>(
      `insert into documents (immeuble_id, categorie, titre, storage_path)
       values ($1, 'test', 'Document de test', 'test/audit-rls.pdf') returning id`,
      [mamellesImmeubleId],
    );
    documentId = document.rows[0]!.id;

    const annonce = await client.query<{ id: string }>(
      `insert into annonces (immeuble_id, titre, corps) values ($1, 'Annonce de test', 'Corps') returning id`,
      [mamellesImmeubleId],
    );
    annonceId = annonce.rows[0]!.id;

    const incident = await client.query<{ id: string }>(
      `insert into incidents (immeuble_id, titre) values ($1, 'Incident de test') returning id`,
      [mamellesImmeubleId],
    );
    incidentId = incident.rows[0]!.id;

    const notification = await client.query<{ id: string }>(
      `insert into notifications (immeuble_id, canal, gabarit) values ($1, 'email', 'test') returning id`,
      [mamellesImmeubleId],
    );
    notificationId = notification.rows[0]!.id;

    const journal = await client.query<{ id: string }>(
      `insert into journal (organisation_id, entite, action) values ($1, 'test', 'test') returning id`,
      [mamellesOrganisationId],
    );
    journalId = journal.rows[0]!.id;

    // Version « refusée » : n'entre pas dans l'index d'une seule version en attente
    // par immeuble, que l'usage réel de la base de dev peut occuper.
    const versionPaiement = await client.query<{ id: string }>(
      `insert into coordonnees_paiement_versions (immeuble_id, statut, compte_titulaire, decide_le)
       values ($1, 'refusee', 'Test audit RLS', now()) returning id`,
      [mamellesImmeubleId],
    );
    versionPaiementId = versionPaiement.rows[0]!.id;

    const occupant = await client.query<{ id: string }>(
      `insert into occupants (lot_id, nom) values ($1, 'Occupant de test') returning id`,
      [unLotId],
    );
    occupantId = occupant.rows[0]!.id;

    const accesPersonne = await client.query<{ id: string }>(
      `insert into acces_personnes (user_id, proprietaire_id) values ($1, $2) returning id`,
      [userGestionnaireMamelles, unProprietaireId],
    );
    accesPersonneId = accesPersonne.rows[0]!.id;

    void appelId;
    void paiementId;
    void assembleeId;
    void documentId;
    void annonceId;
    void incidentId;
    void notificationId;
    void journalId;
    void versionPaiementId;
    void occupantId;
    void accesPersonneId;
  });

  afterAll(async () => {
    // paiements.appel_id est "on delete set null", pas cascade : à
    // supprimer explicitement avant l'appel, sinon la ligne reste orpheline.
    await client.query(`delete from paiements where id = $1`, [paiementId]);
    await client.query(`delete from appels where id = $1`, [appelId]);
    await client.query(`delete from exercices where id = $1`, [exerciceAuditId]);
    await client.query(`delete from assemblees where id = $1`, [assembleeId]);
    await client.query(`delete from documents where id = $1`, [documentId]);
    await client.query(`delete from annonces where id = $1`, [annonceId]);
    await client.query(`delete from incidents where id = $1`, [incidentId]);
    await client.query(`delete from notifications where id = $1`, [notificationId]);
    await client.query(`delete from journal where id = $1`, [journalId]);
    await client.query(`delete from coordonnees_paiement_versions where id = $1`, [versionPaiementId]);
    await client.query(`delete from occupants where id = $1`, [occupantId]);
    await client.query(`delete from acces_personnes where id = $1`, [accesPersonneId]);
    await client.query(`delete from immeubles where id = $1`, [autreImmeubleId]);
    await client.query(`delete from organisations where id = $1`, [autreOrganisationId]);
    await client.query(`delete from auth.users where id = any($1)`, [
      [userGestionnaireMamelles, userLecteurMamelles, userGestionnaireAutreCabinet],
    ]);
    await client.end();
  });

  it("sème au moins une ligne dans chaque table du schéma public", async () => {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    for (const { tablename } of tables) {
      const { rows } = await client.query<{ n: string }>(
        `select count(*) as n from ${tablename}`,
      );
      expect(Number(rows[0]!.n), `${tablename} est vide : le balayage serait un passage à vide`).toBeGreaterThan(
        0,
      );
    }
    // Garantit qu'on a bien balayé un ensemble non trivial de tables : si
    // ce nombre baisse fortement, une table a probablement disparu du schéma.
    expect(tables.length).toBeGreaterThanOrEqual(30);
  });

  it("un gestionnaire d'un autre cabinet ne lit aucune ligne hors les siennes, table par table", async () => {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );

    const echecs: string[] = [];

    for (const { tablename } of tables) {
      if (TABLES_HORS_BALAYAGE.has(tablename)) continue;

      const attendu = TABLES_PROPRES_AU_CABINET.has(tablename) ? 1 : 0;

      const { rows } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
        client.query<{ n: string }>(`select count(*) as n from ${tablename}`),
      );
      const visible = Number(rows[0]!.n);

      if (visible !== attendu) {
        echecs.push(`${tablename} : attendu ${attendu}, vu ${visible}`);
      }
    }

    expect(echecs, echecs.join("\n")).toEqual([]);
  });

  it("le gestionnaire d'un autre cabinet ne voit ni le nom d'ENIGMA AFRICA ni Mamelles Tower", async () => {
    const { rows: organisations } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
      client.query<{ nom: string }>(`select nom from organisations`),
    );
    expect(organisations.map((o) => o.nom)).not.toContain("ENIGMA AFRICA SARL");

    const { rows: immeubles } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
      client.query<{ nom: string }>(`select nom from immeubles`),
    );
    expect(immeubles.map((i) => i.nom)).not.toContain("Mamelles Tower");
  });

  describe("insertions ciblées — with check corrigés par 20260919040000", () => {
    const casInsertion: Array<{
      table: string;
      construireSql: () => { sql: string; params: unknown[] };
    }> = [
      {
        table: "motifs_delai_renforce",
        construireSql: () => ({
          sql: `insert into motifs_delai_renforce (reglement_id, code, libelle) values ($1, 'attaque', 'Tentative depuis un autre cabinet')`,
          params: [mamellesReglementId],
        }),
      },
      {
        table: "types_majorite",
        construireSql: () => ({
          sql: `insert into types_majorite (reglement_id, code, libelle) values ($1, 'attaque', 'Tentative depuis un autre cabinet')`,
          params: [mamellesReglementId],
        }),
      },
      {
        table: "appel_lignes",
        construireSql: () => ({
          sql: `insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant) values ($1, $2, $3, 1, 100)`,
          params: [appelId, unLotId, unPosteChargeId],
        }),
      },
      {
        table: "penalites",
        construireSql: () => ({
          sql: `insert into penalites (appel_id, base_calcul, taux_applique, periodes_retard, montant) values ($1, 100, 0.1, 1, 10)`,
          params: [appelId],
        }),
      },
      {
        table: "mises_en_demeure",
        construireSql: () => ({
          sql: `insert into mises_en_demeure (appel_id, envoyee_le) values ($1, current_date)`,
          params: [appelId],
        }),
      },
      {
        table: "lot_proprietaires",
        construireSql: () => ({
          sql: `insert into lot_proprietaires (lot_id, proprietaire_id) values ($1, $2)`,
          params: [unLotId, unProprietaireId],
        }),
      },
      {
        table: "occupants",
        construireSql: () => ({
          sql: `insert into occupants (lot_id, nom) values ($1, 'Occupant intrus')`,
          params: [unLotId],
        }),
      },
      {
        table: "resolutions",
        construireSql: () => ({
          sql: `insert into resolutions (assemblee_id, ordre, titre, type_majorite_id) values ($1, 2, 'Résolution intruse', $2)`,
          params: [assembleeId, mamellesTypeMajoriteOrdinaireId],
        }),
      },
      {
        // proprietaire différent de celui du fixture (assemblee_id, unProprietaireId,
        // 'email') déjà semé dans beforeAll, pour ne pas confondre un rejet RLS
        // avec un banal conflit de contrainte unique.
        table: "convocations",
        construireSql: () => ({
          sql: `insert into convocations (assemblee_id, proprietaire_id, canal) values ($1, $2, 'email')`,
          params: [assembleeId, unAutreProprietaireId],
        }),
      },
      {
        table: "presences",
        construireSql: () => ({
          sql: `insert into presences (assemblee_id, proprietaire_id) values ($1, $2)`,
          params: [assembleeId, unAutreProprietaireId],
        }),
      },
      {
        table: "votes",
        construireSql: () => ({
          sql: `insert into votes (resolution_id, proprietaire_id, sens, voix) values ($1, $2, 'pour', 1)`,
          params: [resolutionId, unAutreProprietaireId],
        }),
      },
    ];

    it.each(casInsertion)(
      "un gestionnaire d'un autre cabinet ne peut pas insérer dans $table en visant Mamelles Tower",
      async ({ construireSql }) => {
        const { sql, params } = construireSql();
        await expect(
          commeUtilisateur(client, userGestionnaireAutreCabinet, () => client.query(sql, params)),
        ).rejects.toThrow();
      },
    );

    it.each(casInsertion)(
      "le gestionnaire de Mamelles Tower, lui, peut insérer dans $table",
      async ({ construireSql }) => {
        const { sql, params } = construireSql();
        const resultat = await commeUtilisateur(client, userGestionnaireMamelles, () =>
          client.query(sql, params),
        );
        expect(resultat.rowCount).toBe(1);
      },
    );
  });

  describe("le lecteur est en lecture seule sur TOUTES les tables", () => {
    // Refus attendu : la sécurité par ligne ou un droit de colonne. Toute autre
    // erreur (clé dupliquée, NOT NULL, clé étrangère, déclencheur) signifie que la
    // sécurité par ligne a LAISSÉ PASSER l'opération jusqu'à la contrainte.
    const REFUS = /row-level security|permission denied/;

    const tablesDuSchema = async () =>
      (
        await client.query<{ tablename: string }>(
          `select tablename from pg_tables where schemaname = 'public' order by tablename`,
        )
      ).rows.map((r) => r.tablename);

    it("aucune politique d'écriture n'est ouverte à tout membre : toutes exigent un rôle habilité", async () => {
      const { rows } = await client.query<{ tablename: string; policyname: string; cmd: string; texte: string }>(
        `select tablename, policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as texte
         from pg_policies where schemaname = 'public' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')`,
      );
      expect(rows.length).toBeGreaterThan(20);
      const ouvertes = rows.filter(
        (p) => !/immeubles_habilites|est_gestionnaire|est_proprietaire_org/.test(p.texte),
      );
      expect(
        ouvertes.map((p) => `${p.tablename}.${p.policyname} (${p.cmd})`),
        "politiques d'écriture sans condition de rôle",
      ).toEqual([]);
      // Plus aucune politique « for all » fondée sur l'appartenance au cabinet.
      expect(rows.filter((p) => /immeubles_de_lutilisateur/.test(p.texte))).toEqual([]);
    });

    it("chaque table : un lecteur ne peut ni insérer, ni modifier, ni supprimer", async () => {
      const tables = await tablesDuSchema();
      expect(tables.length).toBeGreaterThanOrEqual(30);

      // Une colonne que « authenticated » a le droit de modifier (appels : statut),
      // cherchée en tant que propriétaire de la base, une fois pour toutes.
      const colonneModifiable = new Map<string, string>();
      for (const t of tables) {
        const { rows } = await client.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1
             and has_column_privilege('authenticated', format('public.%I', $1::text), column_name, 'UPDATE')
           order by ordinal_position limit 1`,
          [t],
        );
        if (rows[0]) colonneModifiable.set(t, rows[0].column_name);
      }

      const echecs: string[] = [];
      const refuse = (r: { erreur: string | null; lignes: number }) =>
        r.erreur === null ? r.lignes === 0 : REFUS.test(r.erreur);
      const decrire = (r: { erreur: string | null; lignes: number }) =>
        r.erreur ?? `${r.lignes} ligne(s)`;

      // UNE session simulée pour toutes les tables (une transaction par table
      // dépasserait le délai sur une base distante) ; chaque essai est isolé par
      // un point de sauvegarde, et l'ensemble est annulé à la fin.
      await commeUtilisateur(client, userLecteurMamelles, async () => {
        for (const t of tables) {
          // INSERT d'une copie d'une ligne visible : la sécurité par ligne se
          // prononce AVANT les contraintes ; « rien à copier » n'est pas concluant.
          const insertion = await essayer(client, `insert into public."${t}" select * from public."${t}" limit 1`);
          if (!refuse(insertion)) echecs.push(`${t} : INSERT non refusé (${decrire(insertion)})`);

          const col = colonneModifiable.get(t);
          if (col) {
            const modification = await essayer(client, `update public."${t}" set "${col}" = "${col}"`);
            if (!refuse(modification)) echecs.push(`${t} : UPDATE non refusé (${decrire(modification)})`);
          }

          const suppression = await essayer(client, `delete from public."${t}"`);
          if (!refuse(suppression)) echecs.push(`${t} : DELETE non refusé (${decrire(suppression)})`);
        }
      });

      expect(echecs, echecs.join("\n")).toEqual([]);
    }, 120_000);

    // Témoin : la règle ne se réduit pas à « personne n'écrit ». Le gestionnaire,
    // sur les mêmes lignes, peut modifier.
    const TABLES_TEMOINS = [
      "lots",
      "reglements",
      "proprietaires",
      "postes_charges",
      "exercices",
      "periodes",
      "cles_repartition",
      "lot_proprietaires",
      "occupants",
      "assemblees",
      "resolutions",
      "documents",
      "annonces",
      "incidents",
      "paiements",
    ];

    it.each(TABLES_TEMOINS)("témoin : sur %s, le gestionnaire modifie ce que le lecteur ne peut pas", async (t) => {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1
           and has_column_privilege('authenticated', format('public.%I', $1::text), column_name, 'UPDATE')
         order by ordinal_position limit 1`,
        [t],
      );
      const col = rows[0]!.column_name;
      const sql = `update public."${t}" set "${col}" = "${col}"`;

      const gestionnaire = await commeUtilisateur(client, userGestionnaireMamelles, () => client.query(sql));
      expect(gestionnaire.rowCount, `${t} : le gestionnaire doit pouvoir modifier`).toBeGreaterThan(0);

      const lecteur = await commeUtilisateur(client, userLecteurMamelles, () => client.query(sql));
      expect(lecteur.rowCount, `${t} : le lecteur ne doit rien pouvoir modifier`).toBe(0);
    });

    it("le lecteur lit toujours : la lecture seule ne ferme pas la lecture", async () => {
      for (const t of ["lots", "reglements", "proprietaires", "postes_charges", "exercices", "appels", "paiements", "journal"]) {
        const { rows } = await commeUtilisateur(client, userLecteurMamelles, () =>
          client.query<{ n: string }>(`select count(*) as n from public."${t}"`),
        );
        expect(Number(rows[0]!.n), `${t} : le lecteur doit pouvoir lire`).toBeGreaterThan(0);
      }
    });

    it("le règlement de copropriété — les paramètres juridiques — n'est modifiable ni par un lecteur, ni par un autre cabinet", async () => {
      for (const utilisateur of [userLecteurMamelles, userGestionnaireAutreCabinet]) {
        const r = await commeUtilisateur(client, utilisateur, () =>
          client.query(`update reglements set taux_penalite = 0.5, quorum_tantiemes_ratio = 0.01`),
        );
        expect(r.rowCount).toBe(0);
      }
    });
  });
});
