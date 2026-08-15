-- ALUGUE FÁCIL — SINCRONIZAÇÃO GLOBAL DE DADOS
-- Vale para todas as empresas, sem IDs fixos.
-- Não apaga dados existentes.

create or replace function public.sincronizar_recebimentos_ao_alterar_contrato()
returns trigger
language plpgsql
as $$
declare
  mes_atual date := date_trunc('month', current_date)::date;
  mes_fim date;
begin
  if new.valor_aluguel is distinct from old.valor_aluguel then
    update public.recebimentos
       set valor_previsto = new.valor_aluguel,
           atualizado_em = now()
     where empresa_id = new.empresa_id
       and contrato_id = new.id
       and competencia >= mes_atual
       and status not in ('pago','cancelado');
  end if;

  if new.status = 'encerrado'
     and (old.status is distinct from new.status or old.data_fim is distinct from new.data_fim)
     and new.data_fim is not null then

    mes_fim := date_trunc('month', new.data_fim)::date;

    update public.recebimentos
       set status = 'cancelado',
           atualizado_em = now()
     where empresa_id = new.empresa_id
       and contrato_id = new.id
       and competencia > mes_fim
       and status <> 'pago';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sincronizar_recebimentos_contrato on public.contratos;

create trigger trg_sincronizar_recebimentos_contrato
after update of valor_aluguel, status, data_fim
on public.contratos
for each row
execute function public.sincronizar_recebimentos_ao_alterar_contrato();
