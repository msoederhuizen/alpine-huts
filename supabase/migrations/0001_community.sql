-- Community content: photos people send in, photos they flag as wrong, and
-- hut reviews. Run once against a fresh Supabase project.
--
-- ⚠️ NOTHING HERE REACHES ANOTHER USER UNTIL IT IS APPROVED. Every table has a
-- `status` that starts at 'pending', and the read policies only ever expose
-- 'approved'. That is not a nicety: Apple treats user-generated content as its
-- own review category (Guideline 1.2) and expects filtering, a way to report,
-- and a way to block someone. Moderating before publication satisfies the hard
-- part of that by construction — there is no window in which something
-- offensive is visible while waiting to be caught.
--
-- ⚠️ ONLY THE SERVICE ROLE CAN CHANGE `status`. The app ships the anon key,
-- which is public by design — anyone can read it out of the bundle. So the
-- policies below assume the anon key is in hostile hands and grant it only
-- what a stranger may safely do: insert their own row, read approved rows,
-- and edit or delete their own. Approval happens from the moderation tool
-- with the service key, which never leaves your machine.

-- ── identity ────────────────────────────────────────────────────────────────
-- Anonymous sign-in gives every install a durable id without an email or a
-- password. It is still an account for Apple's purposes, so the app must offer
-- deletion — see delete_my_content() at the bottom.

-- ── photos people send in ───────────────────────────────────────────────────
create table if not exists public.photo_submissions (
  id            uuid primary key default gen_random_uuid(),
  hut_id        text not null,                     -- OSM id, e.g. 'way/353640451'
  storage_path  text not null,                     -- object in the hut-photos bucket
  caption       text check (char_length(caption) <= 280),
  author_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderator_note text,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index if not exists photo_submissions_hut_approved
  on public.photo_submissions (hut_id) where status = 'approved';
create index if not exists photo_submissions_pending
  on public.photo_submissions (created_at) where status = 'pending';

-- ── photos flagged as wrong ─────────────────────────────────────────────────
-- Deliberately NOT tied to a submission: the photos most likely to be wrong are
-- the 1,575 machine-found ones, which live in the app bundle and have no row
-- here. The URL is the only thing that identifies them.
create table if not exists public.photo_reports (
  id          uuid primary key default gen_random_uuid(),
  hut_id      text not null,
  photo_url   text not null,
  reason      text not null check (reason in ('wrong_place','not_a_building','offensive','other')),
  detail      text check (char_length(detail) <= 280),
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (photo_url, author_id)                    -- one report per person per photo
);
create index if not exists photo_reports_open on public.photo_reports (created_at) where not resolved;

-- ── reviews ─────────────────────────────────────────────────────────────────
create table if not exists public.hut_reviews (
  id          uuid primary key default gen_random_uuid(),
  hut_id      text not null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 2000),
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderator_note text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (hut_id, author_id)                       -- one review per person per hut
);
create index if not exists hut_reviews_hut_approved
  on public.hut_reviews (hut_id) where status = 'approved';
create index if not exists hut_reviews_pending
  on public.hut_reviews (created_at) where status = 'pending';

-- ── row level security ──────────────────────────────────────────────────────
alter table public.photo_submissions enable row level security;
alter table public.photo_reports     enable row level security;
alter table public.hut_reviews       enable row level security;

-- Read: approved rows are public; you can always see your own, whatever its
-- status, so the app can show "waiting to be checked" rather than swallowing it.
create policy read_approved_photos on public.photo_submissions
  for select using (status = 'approved' or author_id = auth.uid());
create policy read_approved_reviews on public.hut_reviews
  for select using (status = 'approved' or author_id = auth.uid());
-- Reports are never public: they are a message to the moderator, and showing
-- them would turn "this photo is wrong" into a thing other users argue with.
create policy read_own_reports on public.photo_reports
  for select using (author_id = auth.uid());

-- Insert: signed-in (including anonymous) users, as themselves only.
create policy insert_own_photo on public.photo_submissions
  for insert with check (auth.uid() is not null and author_id = auth.uid() and status = 'pending');
create policy insert_own_review on public.hut_reviews
  for insert with check (auth.uid() is not null and author_id = auth.uid() and status = 'pending');
create policy insert_own_report on public.photo_reports
  for insert with check (auth.uid() is not null and author_id = auth.uid());

-- Update: your own row, and you may not approve yourself. `status` is pinned
-- back to 'pending' so an edited review is re-checked rather than inheriting
-- an approval given to different words.
create policy update_own_review on public.hut_reviews
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid() and status = 'pending');

-- Delete: your own, always. This is what makes the deletion requirement real.
create policy delete_own_photo  on public.photo_submissions for delete using (author_id = auth.uid());
create policy delete_own_review on public.hut_reviews       for delete using (author_id = auth.uid());
create policy delete_own_report on public.photo_reports     for delete using (author_id = auth.uid());

-- ── what the app reads ──────────────────────────────────────────────────────
-- A view rather than a table so the rating average is never stale, and so the
-- app cannot accidentally select a pending row by forgetting a filter.
create or replace view public.hut_ratings as
  select hut_id,
         round(avg(rating)::numeric, 2) as average,
         count(*)                       as count
  from public.hut_reviews
  where status = 'approved'
  group by hut_id;

-- ⚠️ security_invoker so the view is subject to the caller's RLS rather than
-- the definer's. Without it a view silently becomes a hole around the policies
-- above.
alter view public.hut_ratings set (security_invoker = on);

-- ── deletion ────────────────────────────────────────────────────────────────
-- Apple REQUIRES an in-app way to delete the account once you offer sign-up,
-- anonymous or not. Cascading from auth.users covers the rows; this exists so
-- the app can offer "delete everything I have sent" without deleting the
-- identity, which is the softer thing most people actually mean.
create or replace function public.delete_my_content()
returns void
language sql
security invoker
as $$
  delete from public.photo_submissions where author_id = auth.uid();
  delete from public.hut_reviews       where author_id = auth.uid();
  delete from public.photo_reports     where author_id = auth.uid();
$$;
