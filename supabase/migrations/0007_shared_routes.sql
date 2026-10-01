-- "Here is the walk I planned — open it on your phone."
--
-- ⚠️ THE ONLY ROW IN THIS SCHEMA MEANT TO BE READ BY A STRANGER. Everything
-- else here is either the author's own (reports, submissions) or published only
-- after a moderator approves it (photos, reviews). A shared route is neither:
-- it is private by default and becomes readable to exactly the people its
-- author hands the code to. That is a different shape of access, and it is why
-- this table has NO public select policy at all.
--
-- ⚠️ A SELECT POLICY WOULD HAVE BEEN THE WRONG TOOL. `using (true)` makes the
-- code pointless — anyone can list every route anybody has ever shared, with
-- the author's id beside it. `using (code = ...)` cannot be written, because a
-- policy cannot see what the client searched for. So reading goes through
-- open_shared_route() below, which is security definer and will only ever hand
-- back one row, by its full code.
--
-- ⚠️ AND THE CODE IS THE SECRET, SO IT HAS TO BE WORTH GUESSING AT. Eight
-- characters from a 31-letter alphabet is about 8.5 x 10^11 codes; the
-- alphabet drops 0/O/1/I so nobody mistypes one they read off a screen.
-- Revoking sets `revoked`, which the reader checks — a shared route can be
-- taken back, which a plain public URL could not be.

create table if not exists public.shared_routes (
  code        text primary key,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(trim(title)) between 1 and 120),
  /** The whole trip: ordered huts, scenic flag, rides, and the routed geometry
      when it fits. Opaque to the server on purpose — the app owns this shape,
      and a route saved by an older version has to keep opening. */
  payload     jsonb not null,
  revoked     boolean not null default false,
  opened      integer not null default 0,
  created_at  timestamptz not null default now(),
  -- Roughly a megabyte. A long trip with full leg geometry lands near 200 KB;
  -- the app drops the geometry before it gets close, and this is the backstop
  -- that stops one phone pushing an arbitrary blob into the table.
  constraint shared_route_not_huge check (octet_length(payload::text) <= 1000000)
);

create index if not exists shared_routes_by_author
  on public.shared_routes (author_id, created_at desc);

alter table public.shared_routes enable row level security;

-- Authors manage their own shares and nothing else. No select policy for
-- anyone else: see the header.
create policy read_own_share on public.shared_routes
  for select using (author_id = auth.uid());
create policy insert_own_share on public.shared_routes
  for insert with check (auth.uid() is not null and author_id = auth.uid());
create policy update_own_share on public.shared_routes
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy delete_own_share on public.shared_routes
  for delete using (author_id = auth.uid());

-- An unguessable, unmistypeable code. Loops rather than trusting one draw: the
-- column is the primary key, so a collision would surface as a failed save for
-- somebody who did nothing wrong.
create or replace function public.gen_share_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.shared_routes where code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public.shared_routes alter column code set default public.gen_share_code();

/**
 * Open a route somebody shared with you.
 *
 * ⚠️ SECURITY DEFINER, AND DELIBERATELY NARROW. It takes a complete code and
 * returns at most one row; it cannot list, cannot search by prefix, and never
 * returns the author's id. That is the whole reason it exists instead of a
 * select policy.
 *
 * ⚠️ `authenticated` ONLY, NOT `anon`. The app signs every phone in before it
 * asks — anonymously, if that is all the person has — so this costs a recipient
 * nothing, while leaving a bare anon key unable to grind through codes.
 */
create or replace function public.open_shared_route(p_code text)
returns table (code text, title text, payload jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text := upper(trim(p_code));
begin
  -- A code is exactly eight characters. Refusing anything else costs nothing
  -- and keeps a malformed guess from touching the table at all.
  if wanted !~ '^[2-9A-HJ-NP-Z]{8}$' then
    return;
  end if;

  update public.shared_routes s
     set opened = s.opened + 1
   where s.code = wanted and not s.revoked;

  return query
    select s.code, s.title, s.payload, s.created_at
      from public.shared_routes s
     where s.code = wanted and not s.revoked;
end;
$$;

revoke execute on function public.open_shared_route(text) from public, anon;
grant  execute on function public.open_shared_route(text) to authenticated;

/**
 * Delete the account itself, not just what it sent.
 *
 * ⚠️ APPLE REQUIRES THIS IN THE APP, AND IT BECAME UNAVOIDABLE THE MOMENT AN
 * ACCOUNT STOPPED BEING OPTIONAL. Guideline 5.1.1(v) is explicit that an app
 * offering account creation must offer account deletion inside the app, and an
 * email address to write to is not enough. `delete_my_content()` emptied the
 * tables and left the account standing, which satisfied the privacy policy's
 * wording and not the rule.
 *
 * ⚠️ SECURITY DEFINER, BECAUSE `auth.users` IS NOT THE CLIENT'S TO TOUCH — and
 * narrow for the same reason: it takes no arguments and can only ever delete
 * the caller. Every table here references that row with `on delete cascade`, so
 * one delete takes the contributions, the reports and the shared routes with
 * it. Stored photographs are not in Postgres and are removed by the app first.
 */
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;

-- Erasure must reach this table too, or "delete everything I have sent"
-- becomes a false statement in the privacy policy.
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
  delete from public.shared_routes         where author_id = auth.uid();
$$;
