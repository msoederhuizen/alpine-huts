-- "This place is closed" — reports about the hut itself, not about a photo.
--
-- ⚠️ THIS IS THE ONLY MECHANISM IN THE APP THAT CAN CATCH A PLACE THAT NO
-- LONGER EXISTS, and it matters more than any photo. Every other check asks
-- whether a record's photograph is right. None asks whether the record still
-- describes somewhere you can walk to. Measured case: Gästehaus Ehrenberg in
-- Dobbiaco is permanently closed, and OpenStreetMap node 6754051402 — last
-- edited in August 2019 — still says `tourism=guest_house` with no closure
-- marker. The data is faithful to OSM; OSM is six years stale. Nothing
-- automatic reaches that. Someone standing in front of the building does.
--
-- ⚠️ SEPARATE FROM photo_reports ON PURPOSE. A wrong photograph is fixed by
-- deleting one row. A closed hut has to be fixed in OpenStreetMap, or the next
-- `generate-huts` run silently reinstates it — so these two reports lead to
-- completely different work and must not land in the same queue.

create table if not exists public.place_reports (
  id          uuid primary key default gen_random_uuid(),
  hut_id      text not null,
  reason      text not null check (reason in ('closed','moved','wrong_details','no_longer_lodging','other')),
  detail      text check (char_length(detail) <= 500),
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resolved    boolean not null default false,
  /** Set once the correction has been pushed to OpenStreetMap, which is what
      actually stops it coming back. Resolving without this is a note to self
      that the fix has not been made durable yet. */
  fixed_upstream boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (hut_id, author_id)                    -- one report per person per place
);
create index if not exists place_reports_open on public.place_reports (created_at) where not resolved;

alter table public.place_reports enable row level security;

-- Never public: this is a message to the moderator. Showing "3 people say this
-- is closed" would be a claim the app cannot stand behind, and a closed hut is
-- exactly the fact someone might act on in bad weather.
create policy read_own_place_reports on public.place_reports
  for select using (author_id = auth.uid());
create policy insert_own_place_report on public.place_reports
  for insert with check (auth.uid() is not null and author_id = auth.uid());
create policy delete_own_place_report on public.place_reports
  for delete using (author_id = auth.uid());

create policy moderator_reads_place_reports on public.place_reports
  for select using (public.is_moderator());
create policy moderator_resolves_place_reports on public.place_reports
  for update using (public.is_moderator()) with check (public.is_moderator());

-- Erasure has to cover this table too, or "delete everything I have sent"
-- becomes a false statement in the privacy policy.
create or replace function public.delete_my_content()
returns void
language sql
security invoker
as $$
  delete from public.photo_submissions where author_id = auth.uid();
  delete from public.hut_reviews       where author_id = auth.uid();
  delete from public.photo_reports     where author_id = auth.uid();
  delete from public.place_reports     where author_id = auth.uid();
$$;
