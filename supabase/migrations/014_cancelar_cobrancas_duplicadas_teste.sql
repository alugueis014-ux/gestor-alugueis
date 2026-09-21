-- ALUGUE FACIL - REMOVE COBRANCA EXTRA DE TESTE SEM DUPLICAR RECEITA
-- Se ja existe pagamento para o mesmo inquilino, apartamento e competencia,
-- cancela apenas outra cobranca totalmente em aberto.

update public.recebimentos extra
set
  status = 'cancelado',
  atualizado_em = now()
from public.contratos contrato_extra
where contrato_extra.id = extra.contrato_id
  and contrato_extra.empresa_id = extra.empresa_id
  and extra.status <> 'pago'
  and coalesce(extra.valor_recebido, 0) = 0
  and exists (
    select 1
    from public.recebimentos pago
    join public.contratos contrato_pago
      on contrato_pago.id = pago.contrato_id
     and contrato_pago.empresa_id = pago.empresa_id
    where pago.empresa_id = extra.empresa_id
      and pago.competencia = extra.competencia
      and pago.id <> extra.id
      and contrato_pago.inquilino_id = contrato_extra.inquilino_id
      and contrato_pago.apartamento_id = contrato_extra.apartamento_id
      and (
        pago.status = 'pago'
        or coalesce(pago.valor_recebido, 0) >= coalesce(pago.valor_previsto, 0)
      )
  );
