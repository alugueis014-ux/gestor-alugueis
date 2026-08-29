-- Aluguel Fácil - cadastro completo da empresa
-- Adiciona informações usadas em contratos, relatórios, documentos e comunicações.

alter table public.empresas
  add column if not exists razao_social text,
  add column if not exists documento text,
  add column if not exists telefone text,
  add column if not exists email text,
  add column if not exists cep text,
  add column if not exists endereco text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cidade text,
  add column if not exists estado text;

comment on column public.empresas.documento is 'CPF ou CNPJ armazenado somente com dígitos';
comment on column public.empresas.telefone is 'Telefone principal da empresa armazenado somente com dígitos';
comment on column public.empresas.cep is 'CEP armazenado somente com dígitos';
