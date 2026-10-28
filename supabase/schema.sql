-- Banco do Painel de Vagas. Aplicado pelo workflow "Configurar Supabase"; pode rodar de novo sem problema.

-- Quem pode entrar no painel (e-mail da conta Google)
create table if not exists public.permitidos (email text primary key);
alter table public.permitidos enable row level security;
insert into public.permitidos (email) values ('engerickgoncalves@gmail.com') on conflict do nothing;

create or replace function public.permitido() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.permitidos where email = lower(auth.jwt() ->> 'email'))
$$;
grant execute on function public.permitido() to authenticated;

-- Vagas: o robô grava (chave de serviço), quem está logado e permitido lê
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

grant select on public.vagas, public.buscas to authenticated;
grant select, insert, update, delete on public.marcacoes to authenticated;
