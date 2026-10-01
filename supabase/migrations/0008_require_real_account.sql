-- Contributing requires a real account, enforced by the server rather than
-- asked nicely by the app.
--
-- ⚠️ THE APP ALREADY REFUSED THIS, AND THAT TURNED OUT TO MEAN NOTHING. The
-- client gate is `contributorId()` in src/api/community.ts, which blocks an
-- anonymous account from sending anything. The server did not: every insert
-- policy only required `auth.uid() is not null`, and an anonymous user HAS a
-- uid. Measured against the live project before this migration was written —
-- an anonymous session inserted a row into shared_routes and got HTTP 201.
--
-- So the rule "a photo, a review, a report or a shared route comes from
-- somebody who can be asked about it" was a convention of one client, and
-- anyone with the public key and curl was outside it.
--
-- ⚠️ RESTRICTIVE, NOT A REWRITE OF THE EXISTING POLICIES. RLS policies are
-- PERMISSIVE by default and combine with OR, so folding this check into each
-- insert policy would last exactly until somebody adds another permissive one
-- and quietly ORs the hole back open. A restrictive policy is combined with
-- AND: it cannot be outvoted, it states the rule once, and it leaves the
-- working policies untouched. (A restrictive policy grants nothing on its own —
-- each table keeps its existing permissive insert policy, and both must pass.)
--
-- ⚠️ READING IS UNTOUCHED, AND THAT IS THE POINT OF DOING IT THIS WAY. Only
-- INSERT is restricted. An anonymous session still opens a shared route, still
-- reads approved reviews, and still deletes what it has already sent — so
-- receiving a route from a friend needs no account, and nobody is locked away
-- from their own past contributions.

/**
 * Is the caller a permanent account, rather than the automatic anonymous one?
 *
 * ⚠️ `coalesce(..., false)`, DELIBERATELY, WHERE SUPABASE'S OWN EXAMPLE WRITES
 * `is false`. The two differ only when the claim is ABSENT, and they differ in
 * the direction that matters: `is false` evaluates null to false and would
 * refuse the insert, so a permanent user whose token happened not to carry the
 * claim would be unable to contribute at all — the failure would look like the
 * feature being broken for real accounts, which is the worst outcome here.
 *
 * Treating "absent" as "not anonymous" is safe because the opposite was
 * measured: an anonymous session from this project carries
 * `is_anonymous: true` as a real boolean, verified before this was written. The
 * claim is present exactly when it needs to be, so the default only ever
 * applies to tokens that are not anonymous.
 *
 * ⚠️ NOT security definer. It reads the CALLER's token; running it as the owner
 * would answer about the wrong session.
 */
create or replace function public.is_real_account()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- `(select ...)` so Postgres evaluates this once per statement rather than once
-- per row — the documented pattern for calling a function from a policy.
create policy require_real_account_photo on public.photo_submissions
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

create policy require_real_account_review on public.hut_reviews
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

create policy require_real_account_photo_report on public.photo_reports
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

create policy require_real_account_place_report on public.place_reports
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

create policy require_real_account_missing_place on public.missing_place_reports
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

create policy require_real_account_share on public.shared_routes
  as restrictive for insert to authenticated
  with check ((select public.is_real_account()));

/**
 * The uploaded photographs themselves.
 *
 * ⚠️ SCOPED TO THIS BUCKET BY THE `bucket_id <> ...` ESCAPE. `storage.objects`
 * holds every bucket in the project, and a restrictive policy on that table
 * applies to all of them — an unqualified check here would silently impose this
 * app's account rule on any bucket added later for something else entirely.
 */
create policy require_real_account_upload on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'hut-photos' or (select public.is_real_account()));

-- Gives out codes, and only ever ones that are not in use, but `authenticated`
-- is the only role that needs it: the column default runs as the inserter.
revoke execute on function public.gen_share_code() from public, anon;
