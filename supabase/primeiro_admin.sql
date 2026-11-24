-- Primeiro admin do painel. Rode UMA vez no SQL Editor do Supabase, como dono do projeto,
-- depois de aplicar migracao_20261124_008_auth.sql e de a sua conta existir em Authentication → Users.
-- Troque <SEU_EMAIL> pelo e-mail da sua conta. No SQL Editor auth.uid() é nulo, então o gatilho aceita o papel.
insert into public.perfis (id, email, role)
select id, lower(email), 'admin' from auth.users where lower(email) = lower('<SEU_EMAIL>')
on conflict (id) do update set role = 'admin';

-- Conferir: deve mostrar 1 linha com role = admin
select id, email, role from public.perfis where role = 'admin';
