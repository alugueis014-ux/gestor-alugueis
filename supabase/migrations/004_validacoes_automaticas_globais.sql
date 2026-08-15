-- ALUGUE FÁCIL — VALIDAÇÕES AUTOMÁTICAS GLOBAIS
-- Vale para todas as empresas e usuários, sem IDs fixos.
-- Não apaga dados antigos; protege novas inserções e alterações.

-- 1) Contrato, apartamento e inquilino devem pertencer à mesma empresa,
-- e não pode haver dois contratos ativos para o mesmo apartamento.
-- O mesmo inquilino PODE ter contratos ativos em apartamentos diferentes.
create or replace function public.validar_contrato_ativo_unico()
returns trigger
language plpgsql
as $$
declare
  apt_empresa uuid;
  inq_empresa uuid;
begin
  if new.status = 'ativo' then
    select empresa_id into apt_empresa
    from public.apartamentos
    where id = new.apartamento_id;

    select empresa_id into inq_empresa
    from public.inquilinos
    where id = new.inquilino_id;

    if apt_empresa is null or inq_empresa is null then
      raise exception 'Apartamento ou inquilino não encontrado.';
    end if;

    if apt_empresa <> new.empresa_id or inq_empresa <> new.empresa_id then
      raise exception 'Contrato, apartamento e inquilino devem pertencer à mesma empresa.';
    end if;

    if exists (
      select 1
      from public.contratos c
      where c.empresa_id = new.empresa_id
        and c.apartamento_id = new.apartamento_id
        and c.status = 'ativo'
        and c.id is distinct from new.id
    ) then
      raise exception 'Este apartamento já possui um contrato ativo.';
    end if;

  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_contrato_ativo_unico on public.contratos;
create trigger trg_validar_contrato_ativo_unico
before insert or update of status, apartamento_id, inquilino_id, empresa_id
on public.contratos
for each row
execute function public.validar_contrato_ativo_unico();


-- 2) Situação do apartamento acompanha o contrato.
create or replace function public.sincronizar_situacao_apartamento()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'ativo' then
      update public.apartamentos
      set situacao = 'disponivel'
      where id = old.apartamento_id
        and not exists (
          select 1
          from public.contratos c
          where c.apartamento_id = old.apartamento_id
            and c.status = 'ativo'
            and c.id <> old.id
        );
    end if;
    return old;
  end if;

  if new.status = 'ativo' then
    update public.apartamentos
    set situacao = 'ocupado'
    where id = new.apartamento_id;
  elsif old.status = 'ativo' and new.status <> 'ativo' then
    update public.apartamentos
    set situacao = 'disponivel'
    where id = old.apartamento_id
      and not exists (
        select 1
        from public.contratos c
        where c.apartamento_id = old.apartamento_id
          and c.status = 'ativo'
          and c.id <> new.id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sincronizar_situacao_apartamento on public.contratos;
create trigger trg_sincronizar_situacao_apartamento
after insert or update of status, apartamento_id or delete
on public.contratos
for each row
execute function public.sincronizar_situacao_apartamento();


-- 3) Não permite situação incompatível com contrato ativo.
create or replace function public.validar_situacao_apartamento()
returns trigger
language plpgsql
as $$
begin
  if new.situacao <> 'ocupado' and exists (
    select 1
    from public.contratos c
    where c.empresa_id = new.empresa_id
      and c.apartamento_id = new.id
      and c.status = 'ativo'
  ) then
    raise exception 'Apartamento com contrato ativo deve permanecer como ocupado.';
  end if;

  if new.situacao = 'ocupado' and not exists (
    select 1
    from public.contratos c
    where c.empresa_id = new.empresa_id
      and c.apartamento_id = new.id
      and c.status = 'ativo'
  ) then
    raise exception 'Apartamento não pode ficar ocupado sem contrato ativo.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_situacao_apartamento on public.apartamentos;
create trigger trg_validar_situacao_apartamento
before update of situacao
on public.apartamentos
for each row
execute function public.validar_situacao_apartamento();


-- 4) Uma única cobrança por apartamento + competência,
-- mesmo se existirem contratos diferentes.
create or replace function public.validar_recebimento_unico_apartamento_mes()
returns trigger
language plpgsql
as $$
declare
  apt_id uuid;
  contrato_empresa uuid;
begin
  select apartamento_id, empresa_id
  into apt_id, contrato_empresa
  from public.contratos
  where id = new.contrato_id;

  if apt_id is null then
    raise exception 'Contrato do recebimento não encontrado.';
  end if;

  if contrato_empresa <> new.empresa_id then
    raise exception 'Recebimento e contrato devem pertencer à mesma empresa.';
  end if;

  if exists (
    select 1
    from public.recebimentos r
    join public.contratos c on c.id = r.contrato_id
    where r.empresa_id = new.empresa_id
      and r.competencia = new.competencia
      and c.apartamento_id = apt_id
      and r.id is distinct from new.id
      and r.status <> 'cancelado'
  ) then
    raise exception 'Já existe uma cobrança para este apartamento nesta competência.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_recebimento_unico_apartamento_mes on public.recebimentos;
create trigger trg_validar_recebimento_unico_apartamento_mes
before insert or update of contrato_id, competencia, empresa_id, status
on public.recebimentos
for each row
execute function public.validar_recebimento_unico_apartamento_mes();


-- 5) Pagamento parcial não pode ser marcado como Pago.
create or replace function public.validar_status_recebimento()
returns trigger
language plpgsql
as $$
declare
  total_devido numeric(12,2);
begin
  total_devido :=
    coalesce(new.valor_previsto,0) +
    coalesce(new.multa,0) +
    coalesce(new.juros,0) -
    coalesce(new.desconto,0);

  if new.status = 'pago' and coalesce(new.valor_recebido,0) < total_devido then
    raise exception 'Recebimento parcial não pode ser marcado como pago.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_status_recebimento on public.recebimentos;
create trigger trg_validar_status_recebimento
before insert or update of status, valor_recebido, valor_previsto, multa, juros, desconto
on public.recebimentos
for each row
execute function public.validar_status_recebimento();
