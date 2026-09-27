-- ALUGUE FACIL - ESTORNO AUTOMATICO E ATOMICO
-- Ao estornar, reabre a cobranca no contrato ativo da ocupacao.
-- A interface calcula Pendente/Atrasado pela data de vencimento.

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
  v_recebimento_destino_id uuid;
  v_autorizado boolean := false;
begin
  select *
    into v_origem
    from public.recebimentos
   where id = p_recebimento_id
   for update;

  if not found then
    raise exception 'Recebimento não encontrado.';
  end if;

  select *
    into v_contrato_origem
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

  -- O destino precisa ser o contrato ativo da mesma ocupação. Isso corrige
  -- cobranças que ficaram ligadas a um contrato antigo após reativação.
  select *
    into v_contrato_destino
    from public.contratos
   where empresa_id = v_origem.empresa_id
     and inquilino_id = v_contrato_origem.inquilino_id
     and apartamento_id = v_contrato_origem.apartamento_id
     and status = 'ativo'
   order by data_inicio desc, criado_em desc, id
   limit 1
   for update;

  if not found then
    raise exception 'Não existe contrato ativo para reabrir esta cobrança.';
  end if;

  -- Cancela cópias da mesma ocupação/competência antes de reabrir somente
  -- a cobrança canônica. Assim não há duplicidade nem estado intermediário.
  update public.recebimentos r
     set valor_recebido = 0,
         data_pagamento = null,
         forma_pagamento = null,
         multa = 0,
         juros = 0,
         desconto = 0,
         status = 'cancelado',
         atualizado_em = now()
    from public.contratos c
   where c.id = r.contrato_id
     and c.empresa_id = v_origem.empresa_id
     and c.inquilino_id = v_contrato_origem.inquilino_id
     and c.apartamento_id = v_contrato_origem.apartamento_id
     and r.empresa_id = v_origem.empresa_id
     and r.competencia = v_origem.competencia;

  select id
    into v_recebimento_destino_id
    from public.recebimentos
   where empresa_id = v_origem.empresa_id
     and contrato_id = v_contrato_destino.id
     and competencia = v_origem.competencia
   order by id
   limit 1
   for update;

  if v_recebimento_destino_id is null then
    insert into public.recebimentos (
      proprietario_id,
      empresa_id,
      contrato_id,
      competencia,
      data_vencimento,
      valor_previsto,
      valor_recebido,
      multa,
      juros,
      desconto,
      status,
      atualizado_em
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
      0, 0, 0, 0,
      'pendente',
      now()
    )
    returning id into v_recebimento_destino_id;
  else
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
           atualizado_em = now()
     where id = v_recebimento_destino_id;
  end if;

  return v_recebimento_destino_id;
end;
$$;

revoke all on function public.estornar_recebimento_automatico(uuid) from public, anon;
grant execute on function public.estornar_recebimento_automatico(uuid) to authenticated;

