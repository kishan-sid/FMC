-- One-off: mark the existing seed users as email-confirmed so they can sign in.
-- Run in Supabase Dashboard → SQL Editor.

set role postgres;

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email in (
  'admin@football.com',
  'admintest@football.com'
);

-- Verify
select id, email, email_confirmed_at
from auth.users
where email in ('admin@football.com', 'admintest@football.com');
