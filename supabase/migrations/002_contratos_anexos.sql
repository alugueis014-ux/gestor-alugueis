-- Execute no Supabase: Editor SQL > Nova consulta > Executar

create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  proprietario_id uuid not null references auth.users(id) on delete cascade,
  inquilino_id uuid not null references public.inquilinos(id) on delete restrict,
  apartamento_id uuid not null references public.apartamentos(id) on delete restrict,
  valor_aluguel numeric(12,2) not null check (valor_aluguel >= 0),
  dia_vencimento integer not null check (dia_vencimento between 1 and 31),
  data_inicio date not null,
  data_fim date,
  status text not null default 'ativo' check (status in ('ativo','encerrado')),
  criado_em timestamptz not null default now(),
  check (data_fim is null or data_fim >= data_inicio)
);

create unique index if not exists contrato_ativo_por_apartamento_idx
on public.contratos(apartamento_id) where status = 'ativo';

create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  proprietario_id uuid not null references auth.users(id) on delete cascade,
  inquilino_id uuid references public.inquilinos(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete cascade,
  nome_arquivo text not null,
  caminho_arquivo text not null,
  tipo_arquivo text,
  tamanho_bytes bigint,
  criado_em timestamptz not null default now()
);

alter table public.contratos enable row level security;
alter table public.anexos enable row level security;

drop policy if exists "contratos_do_usuario" on public.contratos;
create policy "contratos_do_usuario" on public.contratos
for all to authenticated
using (auth.uid() = proprietario_id)
with check (auth.uid() = proprietario_id);

drop policy if exists "anexos_do_usuario" on public.anexos;
create policy "anexos_do_usuario" on public.anexos
for all to authenticated
using (auth.uid() = proprietario_id)
with check (auth.uid() = proprietario_id);

grant select, insert, update, delete on public.contratos, public.anexos to authenticated;

insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do nothing;

drop policy if exists "arquivos_contratos_do_usuario" on storage.objects;
create policy "arquivos_contratos_do_usuario" on storage.objects
for all to authenticated
using (bucket_id = 'contratos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'contratos' and (storage.foldername(name))[1] = auth.uid()::text);
