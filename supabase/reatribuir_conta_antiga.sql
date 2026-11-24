-- Reatribuir uma conta antiga (dados em progresso_contas sem dono) à sua conta atual do Supabase.
-- Use quando a conta antiga NÃO tem o mesmo e-mail (ex.: chave 'erick' ou e-mail erick@radar.local)
-- e por isso o painel não consegue trazê-la sozinho. Rode no SQL Editor, como dono do projeto,
-- DEPOIS de aplicar migracao_20261124_008_auth.sql. Não apaga nada: a linha antiga fica guardada
-- e recebe extra.migrada_para = <seu uid>.
--
-- 1) Antes, confira quais linhas antigas existem (escolha a chave certa):
select account_key, email, nome, atualizado_em, extra
  from public.progresso_contas
 where user_id is null
 order by atualizado_em desc;

-- 2) Troque <CHAVE_ANTIGA> (ex.: erick) e <SEU_EMAIL> (e-mail confirmado da sua conta) e rode:
do $$
declare
  chave_antiga text := '<CHAVE_ANTIGA>';
  email_destino text := lower('<SEU_EMAIL>');
  uid uuid;
begin
  select u.id into uid from auth.users u
   where lower(u.email) = email_destino and u.email_confirmed_at is not null;
  if uid is null then
    raise exception 'Conta % não encontrada ou e-mail ainda não confirmado.', email_destino;
  end if;
  if not exists (select 1 from public.progresso_contas where account_key = chave_antiga and user_id is null) then
    raise exception 'Linha antiga % não encontrada ou já tem dono.', chave_antiga;
  end if;
  if not public.mesclar_conta_antiga(chave_antiga, uid, email_destino) then
    raise exception 'Linha antiga % já foi trazida para outra conta. Nada foi alterado.', chave_antiga;
  end if;
  raise notice 'Dados de % trazidos para % (%). A linha antiga continua guardada.', chave_antiga, email_destino, uid;
end;
$$;

-- 3) Conferir: a sua linha e a marca na antiga
select account_key, user_id, email, extra from public.progresso_contas
 where account_key in ('<CHAVE_ANTIGA>', (select id::text from auth.users where lower(email) = lower('<SEU_EMAIL>')));
