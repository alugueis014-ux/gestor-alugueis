-- Aluguel Fácil
-- Corrige cobranças já existentes após encerramento de contrato,
-- considerando que o aluguel é pago antecipadamente.
--
-- Mantém pagamentos realizados e todo o histórico.
-- Cancela somente cobranças sem nenhum valor recebido, com vencimento
-- na data da saída ou depois dela. Pagamentos parciais são preservados.

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
  and coalesce(r.status, '') <> 'pago'
  and coalesce(r.valor_recebido, 0) = 0;
