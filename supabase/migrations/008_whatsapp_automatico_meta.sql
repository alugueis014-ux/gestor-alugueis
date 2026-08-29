-- Histórico dos disparos automáticos via WhatsApp Cloud API (Meta)
create table if not exists public.whatsapp_disparos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid,
  recebimento_id uuid not null references public.recebimentos(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete set null,
  inquilino_id uuid references public.inquilinos(id) on delete set null,
  telefone text,
  tipo text not null check (tipo in ('lembrete','atraso')),
  marco_dias integer not null check (marco_dias >= 0),
  data_referencia date not null,
  template_nome text not null,
  meta_message_id text,
  status text not null check (status in ('enviado','erro')),
  erro text,
  criado_em timestamptz not null default now()
);

create index if not exists whatsapp_disparos_recebimento_idx
  on public.whatsapp_disparos(recebimento_id);

create index if not exists whatsapp_disparos_empresa_idx
  on public.whatsapp_disparos(empresa_id);

drop index if exists public.whatsapp_disparo_unico_enviado_idx;
create unique index whatsapp_disparo_unico_enviado_idx
  on public.whatsapp_disparos(recebimento_id, tipo, marco_dias)
  where status = 'enviado';

alter table public.whatsapp_disparos enable row level security;

-- O disparo automático é executado somente no servidor com service role.
-- Para consulta no painel, o usuário só enxerga disparos ligados aos próprios recebimentos.
drop policy if exists "whatsapp_disparos_da_empresa" on public.whatsapp_disparos;
create policy "whatsapp_disparos_da_empresa"
on public.whatsapp_disparos
for select
to authenticated
using (
  exists (
    select 1
    from public.recebimentos r
    where r.id = whatsapp_disparos.recebimento_id
      and r.proprietario_id = auth.uid()
  )
);

grant select on public.whatsapp_disparos to authenticated;
