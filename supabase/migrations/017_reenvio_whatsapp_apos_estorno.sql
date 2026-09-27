-- ALUGUE FACIL - PERMITE NOVA CONFIRMACAO APOS ESTORNO

begin;

alter table public.whatsapp_disparos
  drop constraint if exists whatsapp_disparos_status_check;

alter table public.whatsapp_disparos
  add constraint whatsapp_disparos_status_check
  check (status in ('enviado', 'erro', 'cancelado'));

create or replace function public.cancelar_confirmacao_whatsapp_ao_estornar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pago'
     and new.status = 'pendente'
     and coalesce(new.valor_recebido, 0) = 0 then
    update public.whatsapp_disparos
       set status = 'cancelado',
           erro = coalesce(erro, 'Confirmação invalidada após estorno do pagamento.')
     where recebimento_id = new.id
       and tipo = 'pagamento'
       and status = 'enviado';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cancelar_confirmacao_whatsapp_ao_estornar
on public.recebimentos;

create trigger trg_cancelar_confirmacao_whatsapp_ao_estornar
after update of status, valor_recebido
on public.recebimentos
for each row
execute function public.cancelar_confirmacao_whatsapp_ao_estornar();

commit;

