-- ALUGUE FACIL - CORRECAO DO DIA DE VENCIMENTO
-- O dia informado no contrato controla todas as cobrancas, inclusive a primeira.

create or replace function public.data_vencimento_aluguel_antecipado(
  p_competencia date,
  p_dia_vencimento integer,
  p_data_inicio date
)
returns date
language plpgsql
immutable
as $$
declare
  v_ultimo_dia integer;
  v_dia integer;
begin
  v_ultimo_dia := extract(
    day from (date_trunc('month', p_competencia) + interval '1 month - 1 day')
  )::integer;
  v_dia := least(greatest(coalesce(p_dia_vencimento, 1), 1), v_ultimo_dia);

  return make_date(
    extract(year from p_competencia)::integer,
    extract(month from p_competencia)::integer,
    v_dia
  );
end;
$$;

create or replace function public.criar_primeira_cobranca_aluguel_antecipado()
returns trigger
language plpgsql
as $$
declare
  v_competencia date;
begin
  if new.status <> 'ativo' or new.data_inicio is null or new.data_inicio > current_date then
    return new;
  end if;

  v_competencia := date_trunc('month', new.data_inicio)::date;

  insert into public.recebimentos (
    empresa_id, contrato_id, competencia, data_vencimento,
    valor_previsto, valor_recebido, multa, juros, desconto, status
  ) values (
    new.empresa_id,
    new.id,
    v_competencia,
    public.data_vencimento_aluguel_antecipado(
      v_competencia,
      new.dia_vencimento,
      new.data_inicio
    ),
    new.valor_aluguel,
    0, 0, 0, 0,
    'pendente'
  )
  on conflict (contrato_id, competencia) do nothing;

  return new;
end;
$$;

-- Recalcula os vencimentos existentes conforme o dia informado no contrato.
update public.recebimentos r
set
  data_vencimento = public.data_vencimento_aluguel_antecipado(
    r.competencia,
    c.dia_vencimento,
    c.data_inicio
  ),
  atualizado_em = now()
from public.contratos c
where c.id = r.contrato_id
  and c.empresa_id = r.empresa_id
  and r.data_vencimento is distinct from public.data_vencimento_aluguel_antecipado(
    r.competencia,
    c.dia_vencimento,
    c.data_inicio
  );

-- Reabre somente cobrancas de contratos encerrados que foram canceladas pela
-- regra anterior e que, pelo vencimento correto, pertencem ao periodo ocupado.
update public.recebimentos r
set
  status = case
    when r.data_vencimento < current_date then 'atrasado'
    else 'pendente'
  end,
  atualizado_em = now()
from public.contratos c
where c.id = r.contrato_id
  and c.empresa_id = r.empresa_id
  and c.status = 'encerrado'
  and c.data_fim is not null
  and r.status = 'cancelado'
  and coalesce(r.valor_recebido, 0) = 0
  and r.data_vencimento < c.data_fim;

-- Mantem canceladas apenas as cobrancas sem pagamento que vencem na saida
-- ou depois dela.
update public.recebimentos r
set status = 'cancelado', atualizado_em = now()
from public.contratos c
where c.id = r.contrato_id
  and c.empresa_id = r.empresa_id
  and c.status = 'encerrado'
  and c.data_fim is not null
  and r.data_vencimento >= c.data_fim
  and r.status <> 'pago'
  and coalesce(r.valor_recebido, 0) = 0;
