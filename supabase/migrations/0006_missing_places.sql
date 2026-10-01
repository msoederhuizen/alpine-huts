-- "There is a hut here and your app does not have it."
--
-- ⚠️ THE ONLY REPORT IN THIS APP THAT IS NOT ABOUT AN EXISTING RECORD, which is
-- why it needs its own table rather than a nullable hut_id on place_reports.
-- Every other report starts from a row and says something is wrong with it; a
-- missing hut has no row, so the report itself has to carry the name, the
-- position and the picture. Sharing a table would mean hut_id null everywhere
-- and a constraint nobody can read.
--
-- ⚠️ IT EXISTS BECAUSE THE DATA PROVABLY HAS HOLES. This session found 87 huts
-- that OpenStreetMap carried and the app did not, and a further 45 that OSM
-- itself lacks. Both were found by cross-checking outside lists — which only
-- works for regions somebody has a list for. A walker standing in front of an
-- unlisted hut is the only source that covers everywhere.
--
-- ⚠️ THE FIX IS UPSTREAM, LIKE place_reports. Adding a hut here does not put it
-- on the map: it goes to OpenStreetMap, or into the reviewed-import files, and
-- arrives on the next generation. `fixed_upstream` records that the durable
-- step has actually been taken, because resolving without it just means
-- somebody read the report.

create table if not exists public.missing_place_reports (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 120),
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  /** Which of the app's regions the point falls in, when it falls in one at
      all — a hut outside every region is still worth hearing about, so this is
      nullable rather than a foreign key. */
  region_id   text,
  kind        text not null default 'unknown'
              check (kind in ('alpine_hut','wilderness_hut','shelter','guesthouse','unknown')),
  detail      text check (char_length(detail) <= 500),
  /** Optional photo, in the same private bucket as photo_submissions. */
  storage_path text,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resolved    boolean not null default false,
  fixed_upstream boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists missing_places_open
  on public.missing_place_reports (created_at) where not resolved;

alter table public.missing_place_reports enable row level security;

-- Never public. An unverified "there is a hut here" shown to other walkers
-- would be a claim the app cannot stand behind, and in bad weather that is
-- exactly the claim somebody might act on.
create policy read_own_missing_place on public.missing_place_reports
  for select using (author_id = auth.uid());
create policy insert_own_missing_place on public.missing_place_reports
  for insert with check (auth.uid() is not null and author_id = auth.uid());
create policy delete_own_missing_place on public.missing_place_reports
  for delete using (author_id = auth.uid());

create policy moderator_reads_missing_places on public.missing_place_reports
  for select using (public.is_moderator());
create policy moderator_resolves_missing_places on public.missing_place_reports
  for update using (public.is_moderator()) with check (public.is_moderator());

-- Erasure must reach this table too, or "delete everything I have sent" becomes
-- a false statement in the privacy policy.
create or replace function public.delete_my_content()
returns void
language sql
security invoker
as $$
  delete from public.photo_submissions     where author_id = auth.uid();
  delete from public.hut_reviews           where author_id = auth.uid();
  delete from public.photo_reports         where author_id = auth.uid();
  delete from public.place_reports         where author_id = auth.uid();
  delete from public.missing_place_reports where author_id = auth.uid();
$$;
