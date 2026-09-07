-- Aluguel Fácil
-- Permite vincular dois cadastros/entradas ao mesmo imóvel físico.
-- Ex.: frente do prédio em uma rua e fundos em outra rua.
-- Os cadastros continuam separados para endereço/apartamentos,
-- mas Dashboard e Relatórios passam a contar/agrupar como um único imóvel.

alter table public.predios
  add column if not exists imovel_principal_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'predios_imovel_principal_id_fkey'
  ) then
    alter table public.predios
      add constraint predios_imovel_principal_id_fkey
      foreign key (imovel_principal_id)
      references public.predios(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_predios_imovel_principal_id
  on public.predios(imovel_principal_id);

comment on column public.predios.imovel_principal_id is
  'Quando preenchido, indica que este cadastro é outra entrada/endereço do mesmo imóvel físico representado pelo prédio principal.';
