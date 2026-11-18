-- Banco do Painel de Vagas + Radar Multiusuário.
-- Aplicado pelo workflow "Configurar Supabase"; pode rodar de novo sem problema (idempotente).

-- Quem pode entrar no painel: mantém a tabela por compatibilidade e libera acesso multiusuário para amigos autenticados
create table if not exists public.permitidos (email text primary key);
alter table public.permitidos enable row level security;
insert into public.permitidos (email) values ('engerickgoncalves@gmail.com'), ('*') on conflict do nothing;

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

-- Tabela de perfis e papéis (admin vs user)
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  role text not null default 'user' check (role in ('admin', 'user')),
  atualizado_em timestamptz not null default now()
);
alter table public.perfis add column if not exists role text not null default 'user' check (role in ('admin', 'user'));

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'engerickgoncalves@gmail.com'
    or exists (
      select 1 from public.perfis
      where id = auth.uid() and role = 'admin'
    )
  )
$$;
grant execute on function public.eh_admin() to authenticated;

create or replace function public.impedir_autopromocao_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  row_email text := lower(coalesce(new.email, ''));
begin
  if row_email = 'engerickgoncalves@gmail.com' or jwt_email = 'engerickgoncalves@gmail.com' then
    new.role := 'admin';
  elsif new.role = 'admin' and not public.eh_admin() then
    new.role := 'user';
  elsif new.role is null then
    new.role := 'user';
  end if;
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
  for each row execute function public.impedir_autopromocao_role();

alter table public.perfis enable row level security;
drop policy if exists "ler perfis proprio ou admin" on public.perfis;
create policy "ler perfis proprio ou admin" on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin());
drop policy if exists "inserir proprio perfil" on public.perfis;
create policy "inserir proprio perfil" on public.perfis for insert to authenticated
  with check (id = auth.uid() and (role = 'user' or lower(coalesce(email, auth.jwt() ->> 'email', '')) = 'engerickgoncalves@gmail.com'));
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
