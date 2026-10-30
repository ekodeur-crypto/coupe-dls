-- =====================================================================
-- COUPE DLS — à coller dans Supabase > SQL Editor > New query > Run
-- Les tables ont des noms français (joueurs, coupes, ...) : aucun conflit
-- avec tes anciennes tables (players, cups, matches, dls_players...).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. TON E-MAIL D'ADMIN  (seule ligne à modifier dans ce fichier)
--    C'est l'e-mail du compte que tu crées dans Authentication > Users.
-- ---------------------------------------------------------------------
create table if not exists admins (email text primary key);
insert into admins (email) values ('koffilaeledoh77@gmail.com') on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists joueurs (
  id uuid primary key default gen_random_uuid(),
  pseudo text not null,
  whatsapp text not null,
  secret uuid not null default gen_random_uuid(),   -- clé privée du joueur (jamais affichée)
  created_at timestamptz not null default now()
);
create unique index if not exists joueurs_pseudo_unique on joueurs (lower(pseudo));

create table if not exists coupes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  etape_depart text not null default 'poules',      -- poules | quarts | demis | finale
  places int not null default 16,
  phase text not null default 'inscriptions',       -- inscriptions | poules | 32es | 16es | 8es | quarts | demis | finale | terminee
  champion_id uuid references joueurs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists inscriptions (
  id uuid primary key default gen_random_uuid(),
  coupe_id uuid not null references coupes(id) on delete cascade,
  joueur_id uuid not null references joueurs(id) on delete cascade,
  groupe text,                                       -- A, B, C... (phase de poules)
  rang_force int not null default 1,                 -- 0 = l'admin départage en faveur de ce joueur
  created_at timestamptz not null default now(),
  unique (coupe_id, joueur_id)
);

create table if not exists confrontations (
  id uuid primary key default gen_random_uuid(),
  coupe_id uuid not null references coupes(id) on delete cascade,
  phase text not null,                               -- poules | quarts | demis | finale ...
  groupe text,
  j1_id uuid not null references joueurs(id) on delete cascade,
  j2_id uuid references joueurs(id) on delete cascade,   -- null = joueur exempté
  vainqueur_id uuid references joueurs(id) on delete set null,
  statut text not null default 'en_cours',           -- en_cours | termine | annule
  aller_retour boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists matchs (
  id uuid primary key default gen_random_uuid(),
  confrontation_id uuid not null references confrontations(id) on delete cascade,
  manche int not null default 1,                     -- 1 aller, 2 retour, 3 match d'appui
  score1 int,                                        -- buts de j1
  score2 int,                                        -- buts de j2
  statut text not null default 'a_jouer',            -- a_jouer | joue | forfait | double_forfait
  created_at timestamptz not null default now()
);

create table if not exists declarations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matchs(id) on delete cascade,
  joueur_id uuid not null references joueurs(id) on delete cascade,
  score_moi int not null,
  score_adv int not null,
  created_at timestamptz not null default now(),
  unique (match_id, joueur_id)
);

create table if not exists plaintes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matchs(id) on delete cascade,
  joueur_id uuid not null references joueurs(id) on delete cascade,
  type text not null,                                -- absent | score | autre
  message text not null,
  statut text not null default 'ouverte',            -- ouverte | traitee
  note_admin text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ADMIN : reconnu par son e-mail (table admins)
-- ---------------------------------------------------------------------
create or replace function est_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ---------------------------------------------------------------------
-- 3. SÉCURITÉ DES TABLES
--    - tout le monde LIT les coupes, groupes, matchs (pas les numéros WhatsApp)
--    - seul l'admin ÉCRIT
--    - les joueurs n'écrivent QUE via les fonctions de la section 4
-- ---------------------------------------------------------------------
alter table admins enable row level security;
alter table joueurs enable row level security;
alter table coupes enable row level security;
alter table inscriptions enable row level security;
alter table confrontations enable row level security;
alter table matchs enable row level security;
alter table declarations enable row level security;
alter table plaintes enable row level security;

revoke all on admins, joueurs, coupes, inscriptions, confrontations, matchs, declarations, plaintes from anon, authenticated;

-- joueurs : on ne voit que id et pseudo (jamais whatsapp ni secret)
grant select (id, pseudo, created_at) on joueurs to anon, authenticated;
drop policy if exists "lecture joueurs" on joueurs;
create policy "lecture joueurs" on joueurs for select to anon, authenticated using (true);

grant select on coupes, inscriptions, confrontations, matchs to anon, authenticated;
grant insert, update, delete on coupes, inscriptions, confrontations, matchs to authenticated;
grant select, update, delete on declarations, plaintes to authenticated;

drop policy if exists "lecture coupes" on coupes;
drop policy if exists "admin coupes" on coupes;
create policy "lecture coupes" on coupes for select to anon, authenticated using (true);
create policy "admin coupes" on coupes for all to authenticated using (est_admin()) with check (est_admin());

drop policy if exists "lecture inscriptions" on inscriptions;
drop policy if exists "admin inscriptions" on inscriptions;
create policy "lecture inscriptions" on inscriptions for select to anon, authenticated using (true);
create policy "admin inscriptions" on inscriptions for all to authenticated using (est_admin()) with check (est_admin());

drop policy if exists "lecture confrontations" on confrontations;
drop policy if exists "admin confrontations" on confrontations;
create policy "lecture confrontations" on confrontations for select to anon, authenticated using (true);
create policy "admin confrontations" on confrontations for all to authenticated using (est_admin()) with check (est_admin());

drop policy if exists "lecture matchs" on matchs;
drop policy if exists "admin matchs" on matchs;
create policy "lecture matchs" on matchs for select to anon, authenticated using (true);
create policy "admin matchs" on matchs for all to authenticated using (est_admin()) with check (est_admin());

drop policy if exists "admin declarations" on declarations;
create policy "admin declarations" on declarations for all to authenticated using (est_admin()) with check (est_admin());

drop policy if exists "admin plaintes" on plaintes;
create policy "admin plaintes" on plaintes for all to authenticated using (est_admin()) with check (est_admin());

-- ---------------------------------------------------------------------
-- 4. FONCTIONS UTILISÉES PAR LES PAGES
-- ---------------------------------------------------------------------
create or replace function verifier_joueur(p_joueur uuid, p_secret uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from joueurs where id = p_joueur and secret = p_secret) then
    raise exception 'ACCES_REFUSE';
  end if;
end $$;

create or replace function inscrire_joueur(p_pseudo text, p_whatsapp text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_pseudo text := btrim(coalesce(p_pseudo, ''));
  v_num text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_id uuid; v_secret uuid;
begin
  if char_length(v_pseudo) < 3 or char_length(v_pseudo) > 20 then raise exception 'PSEUDO_INVALIDE'; end if;
  if char_length(v_num) < 8 or char_length(v_num) > 15 then raise exception 'NUMERO_INVALIDE'; end if;
  insert into joueurs (pseudo, whatsapp) values (v_pseudo, v_num) returning id, secret into v_id, v_secret;
  return json_build_object('id', v_id, 'secret', v_secret, 'pseudo', v_pseudo);
exception when unique_violation then
  raise exception 'PSEUDO_PRIS';
end $$;

create or replace function connexion_joueur(p_pseudo text, p_whatsapp text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_num text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  j joueurs%rowtype;
begin
  select * into j from joueurs where lower(pseudo) = lower(btrim(coalesce(p_pseudo, ''))) and whatsapp = v_num;
  if not found then raise exception 'IDENTIFIANTS_INCORRECTS'; end if;
  return json_build_object('id', j.id, 'secret', j.secret, 'pseudo', j.pseudo);
end $$;

create or replace function participer_coupe(p_joueur uuid, p_secret uuid, p_coupe uuid) returns json
language plpgsql security definer set search_path = public as $$
declare c coupes%rowtype;
begin
  perform verifier_joueur(p_joueur, p_secret);
  select * into c from coupes where id = p_coupe;
  if not found then raise exception 'COUPE_INTROUVABLE'; end if;
  if exists (select 1 from inscriptions where coupe_id = p_coupe and joueur_id = p_joueur) then
    return json_build_object('ok', true);
  end if;
  if c.phase <> 'inscriptions' then raise exception 'INSCRIPTIONS_FERMEES'; end if;
  if (select count(*) from inscriptions where coupe_id = p_coupe) >= c.places then raise exception 'COUPE_PLEINE'; end if;
  insert into inscriptions (coupe_id, joueur_id) values (p_coupe, p_joueur);
  return json_build_object('ok', true);
end $$;

create or replace function contact_adversaire(p_joueur uuid, p_secret uuid, p_confrontation uuid) returns json
language plpgsql security definer set search_path = public as $$
declare c confrontations%rowtype; v_opp uuid; j joueurs%rowtype;
begin
  perform verifier_joueur(p_joueur, p_secret);
  select * into c from confrontations where id = p_confrontation;
  if not found or p_joueur not in (c.j1_id, coalesce(c.j2_id, c.j1_id)) then raise exception 'INTERDIT'; end if;
  v_opp := case when c.j1_id = p_joueur then c.j2_id else c.j1_id end;
  if v_opp is null then raise exception 'PAS_ADVERSAIRE'; end if;
  select * into j from joueurs where id = v_opp;
  return json_build_object('pseudo', j.pseudo, 'whatsapp', j.whatsapp);
end $$;

create or replace function declarer_score(p_joueur uuid, p_secret uuid, p_match uuid, p_moi int, p_adv int) returns json
language plpgsql security definer set search_path = public as $$
declare m matchs%rowtype; c confrontations%rowtype;
begin
  perform verifier_joueur(p_joueur, p_secret);
  select * into m from matchs where id = p_match;
  if not found then raise exception 'INTERDIT'; end if;
  select * into c from confrontations where id = m.confrontation_id;
  if p_joueur not in (c.j1_id, coalesce(c.j2_id, c.j1_id)) then raise exception 'INTERDIT'; end if;
  if m.statut <> 'a_jouer' then raise exception 'MATCH_CLOS'; end if;
  if p_moi is null or p_adv is null or p_moi < 0 or p_adv < 0 or p_moi > 30 or p_adv > 30 then raise exception 'SCORE_INVALIDE'; end if;
  insert into declarations (match_id, joueur_id, score_moi, score_adv) values (p_match, p_joueur, p_moi, p_adv)
  on conflict (match_id, joueur_id) do update set score_moi = excluded.score_moi, score_adv = excluded.score_adv, created_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function signaler_probleme(p_joueur uuid, p_secret uuid, p_match uuid, p_type text, p_message text) returns json
language plpgsql security definer set search_path = public as $$
declare m matchs%rowtype; c confrontations%rowtype; v_msg text := btrim(coalesce(p_message, ''));
begin
  perform verifier_joueur(p_joueur, p_secret);
  select * into m from matchs where id = p_match;
  if not found then raise exception 'INTERDIT'; end if;
  select * into c from confrontations where id = m.confrontation_id;
  if p_joueur not in (c.j1_id, coalesce(c.j2_id, c.j1_id)) then raise exception 'INTERDIT'; end if;
  if p_type not in ('absent', 'score', 'autre') then raise exception 'TYPE_INVALIDE'; end if;
  if char_length(v_msg) < 3 or char_length(v_msg) > 500 then raise exception 'MESSAGE_INVALIDE'; end if;
  if (select count(*) from plaintes where joueur_id = p_joueur and statut = 'ouverte') >= 5 then raise exception 'TROP_DE_PLAINTES'; end if;
  insert into plaintes (match_id, joueur_id, type, message) values (p_match, p_joueur, p_type, v_msg);
  return json_build_object('ok', true);
end $$;

create or replace function mes_infos(p_joueur uuid, p_secret uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform verifier_joueur(p_joueur, p_secret);
  return json_build_object(
    'declarations', coalesce((select json_agg(json_build_object('match_id', match_id, 'score_moi', score_moi, 'score_adv', score_adv)) from declarations where joueur_id = p_joueur), '[]'::json),
    'plaintes', coalesce((select json_agg(json_build_object('match_id', match_id, 'statut', statut)) from plaintes where joueur_id = p_joueur), '[]'::json)
  );
end $$;

-- Réservé à l'admin : liste des inscrits avec leur WhatsApp
create or replace function admin_joueurs() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'ACCES_ADMIN'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'pseudo', pseudo, 'whatsapp', whatsapp)) from joueurs), '[]'::json);
end $$;

-- Droits d'exécution : fonctions internes fermées, fonctions des pages ouvertes
revoke all on function verifier_joueur(uuid, uuid) from public;
revoke all on function est_admin() from public;
revoke all on function inscrire_joueur(text, text) from public;
revoke all on function connexion_joueur(text, text) from public;
revoke all on function participer_coupe(uuid, uuid, uuid) from public;
revoke all on function contact_adversaire(uuid, uuid, uuid) from public;
revoke all on function declarer_score(uuid, uuid, uuid, int, int) from public;
revoke all on function signaler_probleme(uuid, uuid, uuid, text, text) from public;
revoke all on function mes_infos(uuid, uuid) from public;
revoke all on function admin_joueurs() from public;

grant execute on function est_admin() to anon, authenticated;
grant execute on function inscrire_joueur(text, text) to anon, authenticated;
grant execute on function connexion_joueur(text, text) to anon, authenticated;
grant execute on function participer_coupe(uuid, uuid, uuid) to anon, authenticated;
grant execute on function contact_adversaire(uuid, uuid, uuid) to anon, authenticated;
grant execute on function declarer_score(uuid, uuid, uuid, int, int) to anon, authenticated;
grant execute on function signaler_probleme(uuid, uuid, uuid, text, text) to anon, authenticated;
grant execute on function mes_infos(uuid, uuid) to anon, authenticated;
grant execute on function admin_joueurs() to authenticated;

notify pgrst, 'reload schema';
