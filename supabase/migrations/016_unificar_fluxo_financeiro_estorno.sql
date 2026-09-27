-- ALUGUE FACIL - UNIFICA O FLUXO FINANCEIRO
-- Regra unica:
--   pago      = quitado
--   pendente  = cobranca aberta (a tela calcula se esta atrasada)
--   cancelado = cobranca que deixou de existir por encerramento/saida

begin;

-- 1) Nunca persiste "atrasado". Atraso e derivado da data de vencimento.
create or replace function public.normalizar_status_recebimento()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'atrasado' then
    new.status := 'pendente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalizar_status_recebimento
on public.recebimentos;

create trigger trg_normalizar_status_recebimento
before insert or update of status
on public.recebimentos
for each row
execute function public.normalizar_status_recebimento();

update public.recebimentos
   set status = 'pendente', atualizado_em = now()
 where status = 'atrasado';

-- 2) Corrige inquilinos ativos que ficaram sem contrato ativo por falha de
-- reativacao. Reabre somente o ultimo contrato quando o apartamento esta livre.
with por_inquilino as (
  select distinct on (i.id)
    c.id as contrato_id,
    c.apartamento_id,
    c.data_inicio,
    c.criado_em
  from public.inquilinos i
  join public.contratos c
    on c.empresa_id = i.empresa_id
   and c.inquilino_id = i.id
  where i.status = 'ativo'
    and c.status = 'encerrado'
    and not exists (
      select 1
      from public.contratos ativo
      where ativo.empresa_id = i.empresa_id
        and ativo.inquilino_id = i.id
        and ativo.status = 'ativo'
    )
    and not exists (
      select 1
      from public.contratos ocupante
      where ocupante.empresa_id = c.empresa_id
        and ocupante.apartamento_id = c.apartamento_id
        and ocupante.status = 'ativo'
        and ocupante.id <> c.id
  )
  order by i.id, c.data_inicio desc, c.criado_em desc, c.id
),
candidatos as (
  select contrato_id,
         row_number() over (
           partition by apartamento_id
           order by data_inicio desc, criado_em desc, contrato_id
         ) as posicao
  from por_inquilino
)
update public.contratos c
   set status = 'ativo', data_fim = null
  from candidatos x
 where c.id = x.contrato_id
   and x.posicao = 1;

-- 3) Move cobrancas abertas presas a um contrato encerrado para o contrato
-- ativo equivalente do mesmo inquilino e apartamento.
do $$
declare
  item record;
  v_destino_id uuid;
  v_destino_pago boolean;
begin
  for item in
    select
      r.*,
      novo.id as contrato_destino_id,
      novo.valor_aluguel as valor_destino,
      novo.dia_vencimento as dia_destino,
      novo.data_inicio as inicio_destino
    from public.recebimentos r
    join public.contratos antigo
      on antigo.id = r.contrato_id
     and antigo.empresa_id = r.empresa_id
    join lateral (
      select c.*
      from public.contratos c
      where c.empresa_id = antigo.empresa_id
        and c.inquilino_id = antigo.inquilino_id
        and c.apartamento_id = antigo.apartamento_id
        and c.status = 'ativo'
      order by c.data_inicio desc, c.criado_em desc, c.id
      limit 1
    ) novo on true
    where antigo.status <> 'ativo'
      and r.status not in ('pago', 'cancelado')
      and coalesce(r.valor_recebido, 0) = 0
  loop
    v_destino_id := null;
    v_destino_pago := false;

    select id,
           status = 'pago'
             or (
               coalesce(valor_previsto, 0) > 0
               and coalesce(valor_recebido, 0) >= coalesce(valor_previsto, 0)
             )
      into v_destino_id, v_destino_pago
      from public.recebimentos
     where empresa_id = item.empresa_id
       and contrato_id = item.contrato_destino_id
       and competencia = item.competencia
     limit 1;

    if v_destino_id is null then
      update public.recebimentos
         set contrato_id = item.contrato_destino_id,
             data_vencimento = public.data_vencimento_aluguel_antecipado(
               item.competencia,
               item.dia_destino,
               item.inicio_destino
             ),
             valor_previsto = item.valor_destino,
             status = 'pendente',
             atualizado_em = now()
       where id = item.id;
    elsif not v_destino_pago then
      update public.recebimentos
         set data_vencimento = public.data_vencimento_aluguel_antecipado(
               item.competencia,
               item.dia_destino,
               item.inicio_destino
             ),
             valor_previsto = item.valor_destino,
             valor_recebido = 0,
             data_pagamento = null,
             forma_pagamento = null,
             multa = 0,
             juros = 0,
             desconto = 0,
             status = 'pendente',
             atualizado_em = now()
       where id = v_destino_id;

    end if;

    if v_destino_id is not null then
      update public.recebimentos
         set status = 'cancelado', atualizado_em = now()
       where id = item.id;
    end if;
  end loop;
end;
$$;

-- Reabre cobrancas zeradas de contratos que estao ativos. Isso recupera os
-- estornos antigos sem reabrir dividas de inquilinos que realmente sairam.
update public.recebimentos r
   set status = 'pendente',
       data_vencimento = public.data_vencimento_aluguel_antecipado(
         r.competencia,
         c.dia_vencimento,
         c.data_inicio
       ),
       valor_previsto = c.valor_aluguel,
       atualizado_em = now()
  from public.contratos c
 where c.id = r.contrato_id
   and c.empresa_id = r.empresa_id
   and c.status = 'ativo'
   and r.status = 'cancelado'
   and coalesce(r.valor_recebido, 0) = 0
   and r.competencia >= date_trunc('month', c.data_inicio)::date;

-- 4) Estorno atomico: zera o pagamento e a cobranca ja termina aberta.
create or replace function public.estornar_recebimento_automatico(
  p_recebimento_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origem public.recebimentos%rowtype;
  v_contrato_origem public.contratos%rowtype;
  v_contrato_destino public.contratos%rowtype;
  v_destino_id uuid;
  v_autorizado boolean := false;
begin
  select * into v_origem
    from public.recebimentos
   where id = p_recebimento_id
   for update;

  if not found then
    raise exception 'Recebimento não encontrado.';
  end if;

  select * into v_contrato_origem
    from public.contratos
   where id = v_origem.contrato_id
     and empresa_id = v_origem.empresa_id;

  if not found then
    raise exception 'Contrato da cobrança não encontrado.';
  end if;

  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = v_origem.empresa_id
      and (
        nullif(to_jsonb(eu) ->> 'usuario_id', '')::uuid = auth.uid()
        or nullif(to_jsonb(eu) ->> 'user_id', '')::uuid = auth.uid()
      )
  ) into v_autorizado;

  if not v_autorizado then
    raise exception 'Usuário sem acesso a esta empresa.';
  end if;

  if v_contrato_origem.status = 'ativo' then
    v_contrato_destino := v_contrato_origem;
  else
    select * into v_contrato_destino
      from public.contratos
     where empresa_id = v_origem.empresa_id
       and inquilino_id = v_contrato_origem.inquilino_id
       and apartamento_id = v_contrato_origem.apartamento_id
       and status = 'ativo'
     order by data_inicio desc, criado_em desc, id
     limit 1
     for update;
  end if;

  if v_contrato_destino.id is null then
    raise exception 'O inquilino não possui contrato ativo neste apartamento.';
  end if;

  select id into v_destino_id
    from public.recebimentos
   where empresa_id = v_origem.empresa_id
     and contrato_id = v_contrato_destino.id
     and competencia = v_origem.competencia
   order by id
   limit 1
   for update;

  if v_destino_id is null then
    if v_contrato_destino.id = v_origem.contrato_id then
      v_destino_id := v_origem.id;
    else
      insert into public.recebimentos (
        proprietario_id, empresa_id, contrato_id, competencia,
        data_vencimento, valor_previsto, valor_recebido,
        multa, juros, desconto, status, atualizado_em
      ) values (
        v_origem.proprietario_id,
        v_origem.empresa_id,
        v_contrato_destino.id,
        v_origem.competencia,
        public.data_vencimento_aluguel_antecipado(
          v_origem.competencia,
          v_contrato_destino.dia_vencimento,
          v_contrato_destino.data_inicio
        ),
        v_contrato_destino.valor_aluguel,
        0, 0, 0, 0, 'pendente', now()
      ) returning id into v_destino_id;
    end if;
  end if;

  update public.recebimentos
     set data_vencimento = public.data_vencimento_aluguel_antecipado(
           v_origem.competencia,
           v_contrato_destino.dia_vencimento,
           v_contrato_destino.data_inicio
         ),
         valor_previsto = v_contrato_destino.valor_aluguel,
         valor_recebido = 0,
         data_pagamento = null,
         forma_pagamento = null,
         multa = 0,
         juros = 0,
         desconto = 0,
         status = 'pendente',
         observacoes = concat_ws(
           E'\n',
           nullif(observacoes, ''),
           'Pagamento estornado em ' || to_char(now(), 'DD/MM/YYYY HH24:MI')
         ),
         atualizado_em = now()
   where id = v_destino_id;

  if v_origem.id <> v_destino_id then
    update public.recebimentos
       set status = 'cancelado',
           valor_recebido = 0,
           data_pagamento = null,
           forma_pagamento = null,
           multa = 0,
           juros = 0,
           desconto = 0,
           atualizado_em = now()
     where id = v_origem.id;
  end if;

  return v_destino_id;
end;
$$;

revoke all on function public.estornar_recebimento_automatico(uuid)
from public, anon;
grant execute on function public.estornar_recebimento_automatico(uuid)
to authenticated;

commit;
