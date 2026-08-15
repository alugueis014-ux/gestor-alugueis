-- ALUGUE FÁCIL — TRANSFERÊNCIA SEM DUPLICIDADE
-- Regra GLOBAL para todas as empresas.
--
-- Um mesmo inquilino pode possuir vários imóveis ao mesmo tempo.
-- Esta migration reconhece TRANSFERÊNCIA somente quando:
--   contrato antigo foi encerrado;
--   novo contrato é do mesmo inquilino e empresa;
--   novo contrato começa EXATAMENTE na data em que o antigo termina;
--   apartamentos são diferentes.
--
-- Nesse cenário, a cobrança da competência acompanha o novo contrato
-- e não fica duplicada nos dois imóveis.

-- ============================================================
-- FUNÇÃO AUXILIAR
-- ============================================================
create or replace function public.migrar_recebimento_transferencia(
  p_empresa_id uuid,
  p_contrato_origem uuid,
  p_contrato_destino uuid,
  p_data_transferencia date
)
returns void
language plpgsql
as $$
declare
  v_competencia date := date_trunc('month', p_data_transferencia)::date;
  v_origem public.recebimentos%rowtype;
  v_destino public.recebimentos%rowtype;
  v_origem_pago boolean := false;
begin
  select *
    into v_origem
    from public.recebimentos
   where empresa_id = p_empresa_id
     and contrato_id = p_contrato_origem
     and competencia = v_competencia
   order by
     case when status = 'pago' then 0 else 1 end,
     valor_recebido desc nulls last
   limit 1;

  if not found then
    return;
  end if;

  select *
    into v_destino
    from public.recebimentos
   where empresa_id = p_empresa_id
     and contrato_id = p_contrato_destino
     and competencia = v_competencia
   order by id
   limit 1;

  -- Se ainda não existe cobrança do destino, move a cobrança antiga.
  if not found then
    update public.recebimentos
       set contrato_id = p_contrato_destino,
           atualizado_em = now()
     where id = v_origem.id
       and empresa_id = p_empresa_id;

    return;
  end if;

  v_origem_pago :=
    v_origem.status = 'pago'
    or (
      coalesce(v_origem.valor_previsto,0) > 0
      and coalesce(v_origem.valor_recebido,0) >=
          coalesce(v_origem.valor_previsto,0)
    );

  -- Se a origem contém o pagamento mais relevante,
  -- consolida os dados financeiros no contrato de destino.
  if v_origem_pago
     or coalesce(v_origem.valor_recebido,0) >
        coalesce(v_destino.valor_recebido,0) then

    update public.recebimentos
       set valor_previsto = v_origem.valor_previsto,
           valor_recebido = v_origem.valor_recebido,
           data_pagamento = v_origem.data_pagamento,
           forma_pagamento = v_origem.forma_pagamento,
           multa = v_origem.multa,
           juros = v_origem.juros,
           desconto = v_origem.desconto,
           observacoes = coalesce(v_destino.observacoes, v_origem.observacoes),
           status = case
             when v_origem_pago then 'pago'
             else v_destino.status
           end,
           atualizado_em = now()
     where id = v_destino.id
       and empresa_id = p_empresa_id;
  end if;

  -- Remove somente a cobrança duplicada da origem.
  delete from public.recebimentos
   where id = v_origem.id
     and empresa_id = p_empresa_id;
end;
$$;


-- ============================================================
-- LIMPEZA DE TRANSFERÊNCIAS JÁ EXISTENTES
-- ============================================================
do $$
declare
  par record;
begin
  for par in
    select
      antigo.empresa_id,
      antigo.id as contrato_origem,
      novo.id as contrato_destino,
      novo.data_inicio as data_transferencia
    from public.contratos antigo
    join public.contratos novo
      on novo.empresa_id = antigo.empresa_id
     and novo.inquilino_id = antigo.inquilino_id
     and novo.id <> antigo.id
     and novo.apartamento_id <> antigo.apartamento_id
     and antigo.data_fim is not null
     and novo.data_inicio = antigo.data_fim
    where antigo.status <> 'ativo'
  loop
    perform public.migrar_recebimento_transferencia(
      par.empresa_id,
      par.contrato_origem,
      par.contrato_destino,
      par.data_transferencia
    );
  end loop;
end;
$$;


-- ============================================================
-- TRIGGER PARA TRANSFERÊNCIAS FUTURAS
-- ============================================================
create or replace function public.trg_migrar_recebimento_ao_criar_contrato()
returns trigger
language plpgsql
as $$
declare
  v_origem uuid;
begin
  if new.status <> 'ativo' or new.data_inicio is null then
    return new;
  end if;

  select antigo.id
    into v_origem
    from public.contratos antigo
   where antigo.empresa_id = new.empresa_id
     and antigo.inquilino_id = new.inquilino_id
     and antigo.id <> new.id
     and antigo.apartamento_id <> new.apartamento_id
     and antigo.status <> 'ativo'
     and antigo.data_fim = new.data_inicio
   order by antigo.data_fim desc, antigo.id
   limit 1;

  if v_origem is not null then
    perform public.migrar_recebimento_transferencia(
      new.empresa_id,
      v_origem,
      new.id,
      new.data_inicio
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_migrar_recebimento_transferencia
on public.contratos;

create trigger trg_migrar_recebimento_transferencia
after insert
on public.contratos
for each row
execute function public.trg_migrar_recebimento_ao_criar_contrato();
