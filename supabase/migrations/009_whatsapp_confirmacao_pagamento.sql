-- Permite registrar a confirmação automática de pagamento via WhatsApp.
alter table public.whatsapp_disparos
  drop constraint if exists whatsapp_disparos_tipo_check;

alter table public.whatsapp_disparos
  add constraint whatsapp_disparos_tipo_check
  check (tipo in ('lembrete','atraso','pagamento'));

-- Evita repetição no mesmo marco/data, mas permite uma nova confirmação
-- se um recebimento for estornado e pago novamente em outra data.
drop index if exists public.whatsapp_disparo_unico_enviado_idx;
create unique index whatsapp_disparo_unico_enviado_idx
  on public.whatsapp_disparos(recebimento_id, tipo, marco_dias, data_referencia)
  where status = 'enviado';
