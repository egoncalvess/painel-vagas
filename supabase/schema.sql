-- Banco do Painel de Vagas + Radar Multiusuário.
-- Aplicado pelo workflow "Configurar Supabase"; pode rodar de novo sem problema (idempotente).

-- Quem pode entrar no painel: mantém a tabela por compatibilidade e libera acesso multiusuário para amigos autenticados
create table if not exists public.permitidos (email text primary key);
alter table public.permitidos enable row level security;
insert into public.permitidos (email) values ('*') on conflict do nothing;

create or replace function public.permitido() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.permitidos
      where email in ('*', 'todos', lower(coalesce(auth.jwt() ->> 'email', '')))
    )
    or not exists (select 1 from public.permitidos)
    or true
  )
$$;
grant execute on function public.permitido() to authenticated;

-- Vagas: o robô grava (chave de serviço), quem está logado lê
create table if not exists public.vagas (
  id text primary key,
  data date not null,
  titulo text not null,
  empresa text,
  local text,
  modalidade text,
  score int,
  motivo text,
  fonte text,
  area text,
  link text,
  publicada text,
  prazo text,
  curriculo text,
  retorno text,
  criada_em timestamptz not null default now()
);
-- Colunas acrescentadas depois: outros sites com a mesma vaga, último dia em que o robô a viu e se ela sumiu do site
alter table public.vagas add column if not exists tambem_em jsonb;
alter table public.vagas add column if not exists visto_em date;
alter table public.vagas add column if not exists sumiu boolean;
alter table public.vagas add column if not exists requisitos jsonb;
alter table public.vagas enable row level security;
drop policy if exists "ler vagas" on public.vagas;
create policy "ler vagas" on public.vagas for select to authenticated using (public.permitido());

-- Última busca do robô
create table if not exists public.buscas (
  id int primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  fontes jsonb
);
alter table public.buscas enable row level security;
drop policy if exists "ler buscas" on public.buscas;
create policy "ler buscas" on public.buscas for select to authenticated using (public.permitido());

-- Fila separada de erros do Vagas.com.br (visível no painel e reprocessada nas próximas coletas)
create table if not exists public.fila_erros_vagas (
  id text primary key,
  fonte text not null default 'Vagas.com.br',
  tipo text not null default 'vaga',
  termo text,
  titulo text,
  empresa text,
  local text,
  link text,
  erro text,
  codigo_http int,
  tentativas int not null default 1,
  primeira_falha_em timestamptz not null default now(),
  ultima_tentativa_em timestamptz not null default now(),
  status_fila text not null default 'pendente',
  extra jsonb default '{}'::jsonb
);
alter table public.fila_erros_vagas enable row level security;
drop policy if exists "ler fila erros vagas" on public.fila_erros_vagas;
create policy "ler fila erros vagas" on public.fila_erros_vagas for select to authenticated
  using (public.permitido());
drop policy if exists "atualizar fila erros vagas" on public.fila_erros_vagas;
create policy "atualizar fila erros vagas" on public.fila_erros_vagas for update to authenticated
  using (public.permitido())
  with check (public.permitido());

-- Marcações de cada usuário: "Me candidatei" e "Descartar"
create table if not exists public.marcacoes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  vaga_id text not null,
  candidatei_em date,
  descartada boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, vaga_id)
);
alter table public.marcacoes enable row level security;
drop policy if exists "minhas marcacoes" on public.marcacoes;
create policy "minhas marcacoes" on public.marcacoes for all to authenticated
  using (user_id = auth.uid() and public.permitido())
  with check (user_id = auth.uid() and public.permitido());

-- Perfis individuais de usuários (suporte multiusuário gratuito para amigos convidados)
create table if not exists public.perfis_usuarios (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email text,
  nome text,
  cargo_objetivo text,
  cidade text,
  uf text,
  cidades_proximas jsonb default '[]'::jsonb,
  modalidades jsonb default '["remoto","hibrido","presencial"]'::jsonb,
  max_dias int default 30,
  areas jsonb default '[]'::jsonb,
  competencias jsonb default '[]'::jsonb,
  historias jsonb default '{}'::jsonb,
  config jsonb default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.perfis_usuarios enable row level security;
drop policy if exists "meu perfil usuario" on public.perfis_usuarios;
create policy "meu perfil usuario" on public.perfis_usuarios for all to authenticated
  using (user_id = auth.uid() and public.permitido())
  with check (user_id = auth.uid() and public.permitido());

-- Módulo Clientes / Leads por usuário (espelhado do Radar)
create table if not exists public.clientes_leads (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  campanha_id text,
  nome text,
  nicho text,
  cidade text,
  uf text,
  telefone text,
  whatsapp text,
  email text,
  site text,
  endereco text,
  cnpj text,
  score int,
  status text not null default 'novo',
  sinais jsonb default '[]'::jsonb,
  mensagem text,
  notas text,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.clientes_leads enable row level security;
drop policy if exists "meus clientes leads" on public.clientes_leads;
create policy "meus clientes leads" on public.clientes_leads for all to authenticated
  using (user_id = auth.uid() and public.permitido())
  with check (user_id = auth.uid() and public.permitido());

-- Módulo Publicações / Posts LinkedIn por usuário (espelhado do Radar)
create table if not exists public.publicacoes_posts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  pilar text,
  titulo text,
  conteudo text,
  hashtags jsonb default '[]'::jsonb,
  midia_url text,
  status text not null default 'rascunho',
  agendado_para timestamptz,
  publicado_em timestamptz,
  linkedin_urn text,
  metricas jsonb default '{}'::jsonb,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.publicacoes_posts enable row level security;
drop policy if exists "minhas publicacoes posts" on public.publicacoes_posts;
create policy "minhas publicacoes posts" on public.publicacoes_posts for all to authenticated
  using (user_id = auth.uid() and public.permitido())
  with check (user_id = auth.uid() and public.permitido());

grant select on public.vagas, public.buscas, public.fila_erros_vagas to authenticated;
grant update on public.fila_erros_vagas to authenticated;
grant select, insert, update, delete on public.marcacoes, public.perfis_usuarios, public.clientes_leads, public.publicacoes_posts to authenticated;

-- Base dinâmica por conta (sincroniza progresso de cada pessoa sem precisar de token do GitHub)
-- account_key = id do usuário no Supabase (uuid em texto). Linhas antigas com outra chave podem ser
-- trazidas para a conta pela função reivindicar_conta_antiga (abaixo).
create table if not exists public.progresso_contas (
  account_key text primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  nome text,
  provider text not null default 'local',
  role text not null default 'user' check (role in ('admin', 'user')),
  perfil jsonb default '{}'::jsonb,
  estado jsonb default '{}'::jsonb,
  leads jsonb default '[]'::jsonb,
  posts jsonb default '[]'::jsonb,
  stories jsonb default '[]'::jsonb,
  vagas_manuais jsonb default '[]'::jsonb,
  fila_erros jsonb default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.progresso_contas add column if not exists role text not null default 'user' check (role in ('admin', 'user'));
alter table public.progresso_contas add column if not exists extra jsonb not null default '{}'::jsonb;

-- Tabela de perfis e papéis (admin vs user). O papel só muda por um admin ou pelo dono do projeto (SQL Editor).
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  role text not null default 'user' check (role in ('admin', 'user')),
  atualizado_em timestamptz not null default now()
);
alter table public.perfis add column if not exists role text not null default 'user' check (role in ('admin', 'user'));

-- Admin = quem tem role 'admin' na própria linha de perfis. Nenhum e-mail fixo.
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.perfis where id = auth.uid() and role = 'admin'
  )
$$;
grant execute on function public.eh_admin() to authenticated;

-- Gatilho de perfis: o papel NUNCA é decidido pelo e-mail gravado na linha.
-- Sem usuário final (auth.uid() nulo: SQL Editor, dono do projeto ou chave de serviço) o valor enviado é mantido.
create or replace function public.impedir_autopromocao_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if new.role is null then
      new.role := 'user';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'user';
  elsif new.role is distinct from old.role and not public.eh_admin() then
    new.role := old.role;
  end if;

  -- O e-mail da própria linha vem do token de login; um admin editando outra pessoa não troca o e-mail dela
  if new.id = auth.uid() then
    new.email := lower(auth.jwt() ->> 'email');
  elsif tg_op = 'UPDATE' then
    new.email := old.email;
  end if;
  return new;
end;
$$;

-- Gatilho de progresso_contas: a coluna role só espelha perfis; o navegador não decide
create or replace function public.progresso_contas_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if new.role is null then
      new.role := 'user';
    end if;
    return new;
  end if;
  new.role := coalesce((select p.role from public.perfis p where p.id = new.user_id), 'user');
  return new;
end;
$$;

drop trigger if exists trg_perfis_role on public.perfis;
create trigger trg_perfis_role
  before insert or update on public.perfis
  for each row execute function public.impedir_autopromocao_role();

drop trigger if exists trg_progresso_contas_role on public.progresso_contas;
create trigger trg_progresso_contas_role
  before insert or update on public.progresso_contas
  for each row execute function public.progresso_contas_role();

alter table public.perfis enable row level security;
drop policy if exists "ler perfis proprio ou admin" on public.perfis;
create policy "ler perfis proprio ou admin" on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin());
drop policy if exists "inserir proprio perfil" on public.perfis;
create policy "inserir proprio perfil" on public.perfis for insert to authenticated
  with check (id = auth.uid());
drop policy if exists "atualizar proprio perfil ou admin" on public.perfis;
create policy "atualizar proprio perfil ou admin" on public.perfis for update to authenticated
  using (id = auth.uid() or public.eh_admin())
  with check (id = auth.uid() or public.eh_admin());

alter table public.progresso_contas enable row level security;
drop policy if exists "acesso progresso_contas" on public.progresso_contas;
drop policy if exists "ler progresso_contas proprio ou admin" on public.progresso_contas;
create policy "ler progresso_contas proprio ou admin" on public.progresso_contas for select to authenticated
  using (user_id = auth.uid() or public.eh_admin());
drop policy if exists "gravar progresso_contas proprio ou admin" on public.progresso_contas;
create policy "gravar progresso_contas proprio ou admin" on public.progresso_contas for all to authenticated
  using (user_id = auth.uid() or public.eh_admin())
  with check (user_id = auth.uid() or public.eh_admin());

grant select, insert, update on public.perfis, public.progresso_contas to authenticated;

-- Une duas listas jsonb de objetos pelo campo id; em caso de repetição vence a lista b
create or replace function public.uniao_por_id(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(item order by ordem), '[]'::jsonb)
  from (
    select distinct on (chave) item, ordem
    from (
      select x.item, coalesce(x.item ->> 'id', x.item::text) as chave, x.ordem, x.prioridade
      from (
        select e.value as item, e.ordinality as ordem, 1 as prioridade
          from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) with ordinality e
        union all
        select e.value, 100000 + e.ordinality, 2
          from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) with ordinality e
      ) x
    ) y
    order by chave, prioridade
  ) z
$$;

create or replace function public.objeto_jsonb(j jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end
$$;

-- Fusão interna de uma conta antiga (account_key sem user_id) na conta uid. Não apaga nada: marca extra.migrada_para.
-- Não é chamável pelo navegador (sem grant): só pela RPC abaixo, que confere e-mail, ou pelo dono do projeto no SQL Editor.
create or replace function public.mesclar_conta_antiga(chave text, uid uuid, email_destino text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  antiga public.progresso_contas%rowtype;
  atual public.progresso_contas%rowtype;
begin
  if uid is null or chave is null or chave = '' or chave = uid::text then
    return false;
  end if;
  select * into antiga from public.progresso_contas
   where account_key = chave and user_id is null
   for update;
  if not found then
    return false;
  end if;
  if coalesce(antiga.extra ->> 'migrada_para', '') not in ('', uid::text) then
    return false;
  end if;

  select * into atual from public.progresso_contas where account_key = uid::text for update;
  if not found then
    insert into public.progresso_contas (account_key, user_id, email, nome, provider, perfil, estado, leads, posts,
                                         stories, vagas_manuais, fila_erros, atualizado_em)
    values (uid::text, uid, lower(email_destino), antiga.nome, 'supabase', antiga.perfil, antiga.estado, antiga.leads, antiga.posts,
            antiga.stories, antiga.vagas_manuais, antiga.fila_erros, now());
  else
    update public.progresso_contas set
      perfil = public.objeto_jsonb(antiga.perfil) || public.objeto_jsonb(atual.perfil),
      estado = public.objeto_jsonb(antiga.estado) || public.objeto_jsonb(atual.estado) || jsonb_build_object(
        'candidatei', public.objeto_jsonb(antiga.estado -> 'candidatei') || public.objeto_jsonb(atual.estado -> 'candidatei'),
        'salvas', public.objeto_jsonb(antiga.estado -> 'salvas') || public.objeto_jsonb(atual.estado -> 'salvas'),
        'candidaturas', public.objeto_jsonb(antiga.estado -> 'candidaturas') || public.objeto_jsonb(atual.estado -> 'candidaturas'),
        'descartadas', (
          select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
          from jsonb_array_elements(
            (case when jsonb_typeof(antiga.estado -> 'descartadas') = 'array' then antiga.estado -> 'descartadas' else '[]'::jsonb end) ||
            (case when jsonb_typeof(atual.estado -> 'descartadas') = 'array' then atual.estado -> 'descartadas' else '[]'::jsonb end)
          ) d
        )
      ),
      leads = public.uniao_por_id(antiga.leads, atual.leads),
      posts = public.uniao_por_id(antiga.posts, atual.posts),
      stories = public.uniao_por_id(antiga.stories, atual.stories),
      vagas_manuais = public.uniao_por_id(antiga.vagas_manuais, atual.vagas_manuais),
      fila_erros = public.uniao_por_id(antiga.fila_erros, atual.fila_erros),
      atualizado_em = now()
    where account_key = uid::text;
  end if;

  update public.progresso_contas
     set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('migrada_para', uid::text, 'migrada_em', now())
   where account_key = chave;
  return true;
end;
$$;
revoke all on function public.mesclar_conta_antiga(text, uuid, text) from public, anon, authenticated;

-- Traz para a conta logada os dados de uma conta antiga (account_key sem user_id) com o MESMO e-mail,
-- só se o e-mail da conta logada estiver confirmado. Conta antiga com outro e-mail: supabase/reatribuir_conta_antiga.sql.
create or replace function public.reivindicar_conta_antiga(chave text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  email_jwt text := lower(coalesce(auth.jwt() ->> 'email', ''));
  email_antiga text;
begin
  if uid is null or chave is null or chave = '' or chave = uid::text or email_jwt = '' then
    return false;
  end if;
  if not exists (select 1 from auth.users u where u.id = uid and u.email_confirmed_at is not null) then
    return false;
  end if;
  select lower(coalesce(p.email, '')) into email_antiga
    from public.progresso_contas p
   where p.account_key = chave and p.user_id is null;
  if email_antiga is null or email_antiga <> email_jwt then
    return false;
  end if;
  return public.mesclar_conta_antiga(chave, uid, email_jwt);
end;
$$;
revoke all on function public.reivindicar_conta_antiga(text) from public, anon;
grant execute on function public.reivindicar_conta_antiga(text) to authenticated;

-- Primeiro admin: NÃO roda aqui. Veja supabase/primeiro_admin.sql (o dono do projeto cola no SQL Editor uma vez).
