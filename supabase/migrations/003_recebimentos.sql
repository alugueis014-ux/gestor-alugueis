-- Módulo de acompanhamento e recebimentos

create table if not exists public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  proprietario_id uuid not null references auth.users(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete restrict,
  competencia date not null,
  data_vencimento date not null,
  valor_previsto numeric(12,2) not null check (valor_previsto >= 0),
  valor_recebido numeric(12,2) not null default 0 check (valor_recebido >= 0),
  multa numeric(12,2) not null default 0 check (multa >= 0),
  juros numeric(12,2) not null default 0 check (juros >= 0),
  desconto numeric(12,2) not null default 0 check (desconto >= 0),
  data_pagamento date,
  forma_pagamento text check (
    forma_pagamento is null or forma_pagamento in (
      'pix','transferencia','dinheiro','boleto','cartao','outro'
    )
  ),
  status text not null default 'pendente' check (
    status in ('pendente','pago','cancelado')
  ),
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (contrato_id, competencia)
);

create index if not exists recebimentos_proprietario_idx
on public.recebimentos(proprietario_id);

create index if not exists recebimentos_competencia_idx
on public.recebimentos(competencia);

create index if not exists recebimentos_contrato_idx
on public.recebimentos(contrato_id);

alter table public.recebimentos enable row level security;

drop policy if exists "recebimentos_do_usuario" on public.recebimentos;
create policy "recebimentos_do_usuario"
on public.recebimentos
for all
to authenticated
using (auth.uid() = proprietario_id)
with check (auth.uid() = proprietario_id);

grant select, insert, update, delete
on public.recebimentos
to authenticated;
