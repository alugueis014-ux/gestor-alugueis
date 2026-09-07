-- Aluguel Fácil
-- Exclusão lógica de apartamentos: remove da operação sem apagar o histórico.

alter table public.apartamentos
  add column if not exists arquivado boolean not null default false;

create index if not exists idx_apartamentos_empresa_arquivado
  on public.apartamentos (empresa_id, arquivado);

comment on column public.apartamentos.arquivado is
  'Quando true, a unidade deixa de aparecer no cadastro operacional, mas permanece no banco para preservar contratos, recebimentos e relatórios históricos.';
