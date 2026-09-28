-- Who may approve things, and what approving is allowed to touch.
--
-- ⚠️ THE MODERATION SCREEN LIVES IN THE APP, WHICH SHIPS THE PUBLIC ANON KEY.
-- So "only the service role can approve" is no longer enough — the app has no
-- service key and must never have one. Instead a moderator is an ordinary
-- signed-in user whose id appears in this table, and the policies below grant
-- that user, and only that user, the right to change `status`.
--
-- ⚠️ THE TABLE IS READABLE BY NOBODY AND WRITABLE BY NOBODY. There is no
-- policy granting insert or update on `moderators`, and RLS is on — so with
-- the anon key it is invisible and unmodifiable, even to a moderator. The only
-- way in is the SQL editor or the service key, which is exactly the point: a
-- compromised phone cannot promote itself.

create table if not exists public.moderators (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now(),
  note       text
);

alter table public.moderators enable row level security;
-- Deliberately no policies. See the note above.

/**
 * Is the caller a moderator?
 *
 * ⚠️ security definer, so it can read `moderators` despite that table being
 * closed to everyone. It takes no arguments and reads only auth.uid(), so
 * there is nothing a caller can pass to make it answer about someone else.
 * search_path is pinned because a security-definer function that resolves
 * names through a caller-controlled path is the classic way to subvert one.
 */
create or replace function public.is_moderator()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to authenticated;

-- ── what a moderator may see and do ─────────────────────────────────────────
-- Read everything, including rows still pending, which is the whole job.
create policy moderator_reads_photos on public.photo_submissions
  for select using (public.is_moderator());
create policy moderator_reads_reviews on public.hut_reviews
  for select using (public.is_moderator());
create policy moderator_reads_reports on public.photo_reports
  for select using (public.is_moderator());

-- Change status. The `with check` deliberately allows only the three valid
-- states, so a bug in the app cannot write a status nothing understands.
create policy moderator_judges_photos on public.photo_submissions
  for update using (public.is_moderator())
  with check (public.is_moderator() and status in ('pending','approved','rejected'));
create policy moderator_judges_reviews on public.hut_reviews
  for update using (public.is_moderator())
  with check (public.is_moderator() and status in ('pending','approved','rejected'));
create policy moderator_resolves_reports on public.photo_reports
  for update using (public.is_moderator())
  with check (public.is_moderator());

-- Remove something outright — needed for content that should not merely be
-- unpublished, and part of what Apple expects a moderator to be able to do.
create policy moderator_deletes_photos on public.photo_submissions
  for delete using (public.is_moderator());
create policy moderator_deletes_reviews on public.hut_reviews
  for delete using (public.is_moderator());

-- A moderator also has to be able to look at a photo BEFORE approving it, which
-- means reading another person's folder in a private bucket.
create policy moderator_reads_uploads on storage.objects
  for select to authenticated
  using (bucket_id = 'hut-photos' and public.is_moderator());
create policy moderator_deletes_uploads on storage.objects
  for delete to authenticated
  using (bucket_id = 'hut-photos' and public.is_moderator());

-- ── making yourself the moderator ───────────────────────────────────────────
-- Chicken and egg: your user id does not exist until the app has signed in
-- anonymously at least once. So:
--
--   1. finish wiring the app, open it, and leave a review or tap the debug
--      line on the About screen — that creates the account
--   2. find the id:   select id, created_at from auth.users order by created_at desc limit 5;
--   3. claim it:      insert into public.moderators (user_id, note)
--                     values ('<paste-the-uuid>', 'me, first device');
--
-- ⚠️ A MODERATOR IS A DEVICE, NOT A PERSON. An anonymous session belongs to one
-- install: reinstall the app, or pick up a second phone, and it is a different
-- id that needs adding again. If that becomes annoying, the fix is real sign-in
-- (email) for your account only — not loosening anything here.
