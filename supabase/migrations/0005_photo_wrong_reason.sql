-- Add "the photos are wrong" to the place-report reasons.
--
-- ⚠️ THE GALLERY ALREADY HAS A PER-PHOTO REPORT, AND THAT IS NOT ENOUGH. It
-- requires opening the gallery, swiping to the offending picture and finding a
-- small flag in the footer. Someone who simply notices the hut page is showing
-- the wrong building reaches for the obvious "something is wrong here" row on
-- the page itself — and until now that row offered no way to say what they had
-- actually spotted.
--
-- The two remain separate on purpose: the gallery report names ONE photo, which
-- is what the blocklist needs to remove a single image. This one says "the
-- pictures for this place are wrong" without requiring the reporter to work out
-- which of five is the problem, which is often all they know.
alter table public.place_reports
  drop constraint if exists place_reports_reason_check;

alter table public.place_reports
  add constraint place_reports_reason_check
  check (reason in ('closed','moved','wrong_details','no_longer_lodging','photos_wrong','other'));
