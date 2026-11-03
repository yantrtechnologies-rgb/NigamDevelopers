-- Run after creating victory@nigamsturf.local in Authentication > Users.
insert into public.admin_users(user_id)
select id from auth.users where email='victory@nigamsturf.local'
on conflict(user_id) do nothing;

do $$
begin
  if not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id where u.email='victory@nigamsturf.local') then
    raise exception 'Create victory@nigamsturf.local in Authentication > Users first';
  end if;
end $$;
