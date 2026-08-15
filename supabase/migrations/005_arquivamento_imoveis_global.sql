-- ALUGUE FÁCIL — ARQUIVAMENTO GLOBAL DE IMÓVEIS
-- Vale para todas as empresas e usuários.
-- Mantém histórico e evita exclusões que quebrariam chaves estrangeiras.

alter table public.predios
  add column if not exists arquivado boolean not null default false;

alter table public.predios
  add column if not exists arquivado_em timestamptz null;

create index if not exists idx_predios_empresa_arquivado
  on public.predios (empresa_id, arquivado);

-- Garante que registros antigos fiquem ativos por padrão.
update public.predios
set arquivado = false
where arquivado is null;
