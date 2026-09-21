-- ALUGUE FÁCIL — FINANCEIRO CONSISTENTE PARA ALUGUEL ANTECIPADO
-- Execute uma única vez no SQL Editor do Supabase.

-- 1) Contratos diferentes podem gerar cobranças no mesmo apartamento e mês.
-- A unicidade correta já existe em (contrato_id, competencia).
drop trigger if exists trg_validar_recebimento_unico_apartamento_mes
on public.recebimentos;

drop function if exists public.validar_recebimento_unico_apartamento_mes();

-- 2) Primeira mensalidade vence na entrada; demais vencem no dia contratado.
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
  if date_trunc('month', p_data_inicio)::date = date_trunc('month', p_competencia)::date then
    return p_data_inicio;
  end if;

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

-- 3) Todo contrato ativo iniciado hoje ou antes recebe a primeira cobrança.
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
    empresa_id,
    contrato_id,
    competencia,
    data_vencimento,
    valor_previsto,
    valor_recebido,
    multa,
    juros,
    desconto,
    status
  ) values (
    new.empresa_id,
    new.id,
    v_competencia,
    new.data_inicio,
    new.valor_aluguel,
    0,
    0,
    0,
    0,
    'pendente'
  )
  on conflict (contrato_id, competencia) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_criar_primeira_cobranca_aluguel
on public.contratos;

create trigger trg_criar_primeira_cobranca_aluguel
after insert
on public.contratos
for each row
execute function public.criar_primeira_cobranca_aluguel_antecipado();

-- 4) Gera com segurança as mensalidades do mês corrente.
create or replace function public.gerar_cobrancas_mes_atual()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competencia date := date_trunc('month', current_date)::date;
  v_quantidade integer := 0;
begin
  insert into public.recebimentos (
    empresa_id,
    contrato_id,
    competencia,
    data_vencimento,
    valor_previsto,
    valor_recebido,
    multa,
    juros,
    desconto,
    status
  )
  select
    c.empresa_id,
    c.id,
    v_competencia,
    public.data_vencimento_aluguel_antecipado(
      v_competencia,
      c.dia_vencimento,
      c.data_inicio
    ),
    c.valor_aluguel,
    0,
    0,
    0,
    0,
    'pendente'
  from public.contratos c
  where c.status = 'ativo'
    and c.data_inicio <= current_date
    and (c.data_fim is null or c.data_fim > current_date)
  on conflict (contrato_id, competencia) do nothing;

  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end;
$$;

revoke all on function public.gerar_cobrancas_mes_atual() from public;
revoke all on function public.gerar_cobrancas_mes_atual() from anon;
revoke all on function public.gerar_cobrancas_mes_atual() from authenticated;
grant execute on function public.gerar_cobrancas_mes_atual() to service_role;

-- 5) Encerramento: preserva pagos e cancela o que vencer na saída ou depois.
create or replace function public.sincronizar_recebimentos_ao_alterar_contrato()
returns trigger
language plpgsql
as $$
declare
  v_mes_atual date := date_trunc('month', current_date)::date;
begin
  if new.valor_aluguel is distinct from old.valor_aluguel then
    update public.recebimentos
       set valor_previsto = new.valor_aluguel,
           atualizado_em = now()
     where empresa_id = new.empresa_id
       and contrato_id = new.id
       and competencia >= v_mes_atual
       and status not in ('pago', 'cancelado');
  end if;

  if new.status = 'encerrado'
     and new.data_fim is not null
     and (old.status is distinct from new.status or old.data_fim is distinct from new.data_fim) then
    update public.recebimentos
       set status = 'cancelado',
           atualizado_em = now()
     where empresa_id = new.empresa_id
       and contrato_id = new.id
       and data_vencimento >= new.data_fim
       and status <> 'pago'
       and coalesce(valor_recebido, 0) = 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sincronizar_recebimentos_contrato
on public.contratos;

create trigger trg_sincronizar_recebimentos_contrato
after update of valor_aluguel, status, data_fim
on public.contratos
for each row
execute function public.sincronizar_recebimentos_ao_alterar_contrato();

-- 6) Corrige cobranças já existentes sem apagar pagamentos históricos.
update public.recebimentos r
set
  data_vencimento = c.data_inicio,
  atualizado_em = now()
from public.contratos c
where c.id = r.contrato_id
  and c.empresa_id = r.empresa_id
  and date_trunc('month', r.competencia) = date_trunc('month', c.data_inicio)
  and r.data_vencimento is distinct from c.data_inicio;

update public.recebimentos r
set
  status = 'cancelado',
  atualizado_em = now()
from public.contratos c
where c.id = r.contrato_id
  and c.empresa_id = r.empresa_id
  and c.status = 'encerrado'
  and c.data_fim is not null
  and r.data_vencimento >= c.data_fim
  and r.status <> 'pago'
  and coalesce(r.valor_recebido, 0) = 0;

select public.gerar_cobrancas_mes_atual();
