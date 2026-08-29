-- Aluguel Fácil - conexão WhatsApp por empresa
create table if not exists public.whatsapp_conexoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  access_token text,
  numero_exibicao text,
  nome_conta text,
  status text not null default 'conectado' check (status in ('conectado','desconectado','erro')),
  origem text not null default 'embedded_signup',
  conectado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

alter table public.whatsapp_conexoes enable row level security;

-- Nenhuma credencial desta tabela é exposta diretamente pelo cliente.
-- O acesso é feito apenas pelas rotas do servidor usando a service_role.
revoke all on public.whatsapp_conexoes from anon, authenticated;

grant all on public.whatsapp_conexoes to service_role;

create index if not exists whatsapp_conexoes_status_idx
  on public.whatsapp_conexoes (empresa_id, status);

-- Completa o histórico de disparos criado durante a configuração inicial.
alter table public.whatsapp_disparos add column if not exists empresa_id uuid;
alter table public.whatsapp_disparos add column if not exists contrato_id uuid;
alter table public.whatsapp_disparos add column if not exists inquilino_id uuid;
alter table public.whatsapp_disparos add column if not exists meta_message_id text;

update public.whatsapp_disparos d
set empresa_id = r.empresa_id
from public.recebimentos r
where r.id = d.recebimento_id
  and d.empresa_id is null;

-- A leitura do histórico respeita o vínculo do usuário com a empresa.
drop policy if exists "whatsapp_disparos_da_empresa" on public.whatsapp_disparos;
create policy "whatsapp_disparos_da_empresa"
on public.whatsapp_disparos
for select
to authenticated
using (
  exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = whatsapp_disparos.empresa_id
      and (
        (to_jsonb(eu) ->> 'usuario_id')::uuid = auth.uid()
        or (to_jsonb(eu) ->> 'user_id')::uuid = auth.uid()
      )
  )
);
