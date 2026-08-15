# Gestor de Aluguéis — MVP Online

Primeira versão online com login, dashboard, imóveis, apartamentos e inquilinos.

## Próximo passo
1. No Supabase, abra **Editor SQL**.
2. Abra `supabase/migrations/001_mvp.sql`.
3. Copie e execute o conteúdo.
4. Em **Autenticação > Usuários**, crie seu primeiro usuário.
5. Em **Configurações do projeto > Chaves da API**, copie a chave pública.
6. Renomeie `.env.local.example` para `.env.local` e cole a chave pública.
7. Rode `npm install` e `npm run dev`.

Depois, o projeto poderá ser enviado ao GitHub e importado na Vercel.


## Projeto já configurado

Este pacote já contém o arquivo `.env.local` com:

- URL pública do projeto Supabase
- Chave publicável do Supabase

A chave secreta/service_role não foi utilizada.

## Próximo passo

1. Envie esta pasta para um repositório no GitHub.
2. Importe o repositório na Vercel.
3. Na Vercel, cadastre também as variáveis:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
4. Publique o projeto.


## Nova interface do Dashboard

Esta versão aplica o novo visual solicitado:
- menu lateral azul-escuro;
- cartões financeiros;
- indicadores de imóveis;
- gráfico de ocupação por imóvel;
- gráfico em formato de rosca;
- resumo por imóvel;
- responsividade para computador e celular.

Os cartões financeiros ficarão em zero até a criação das tabelas de contratos e recebimentos.

## Dashboard fiel ao modelo simples

Esta versão remove gráficos e mantém exatamente a organização solicitada:
- quatro cartões na primeira linha;
- três cartões na segunda linha;
- tabela de resumo mensal por imóvel;
- menu lateral simples, sem ícones;
- valores financeiros prontos para o futuro módulo de recebimentos.

## Tela Disponíveis para Aluguel

Nova rota: `/disponiveis`

Recursos:
- total de apartamentos disponíveis;
- total de reservados;
- total em manutenção;
- filtro por imóvel;
- filtro por situação;
- busca por número, imóvel ou observação;
- listagem ligada ao Supabase;
- atalho para cadastrar inquilino.

## Cadastro de inquilino em modal

A tela Inquilinos agora abre o formulário em uma janela com:
- nome, CPF, telefone e e-mail;
- imóvel e apartamento;
- valor, vencimento e vigência;
- status e data de saída;
- contrato/anexo;
- observações.

Antes de testar essa tela, execute no Supabase o arquivo:
`supabase/migrations/002_contratos_anexos.sql`


## Edição de inquilinos

- Adicionado botão **Editar** na tabela de inquilinos.
- O formulário abre preenchido com os dados existentes.
- Permite alterar dados pessoais, imóvel, apartamento, valor, vencimento, datas, status e observações.
- Se o apartamento for trocado, o anterior volta a ficar disponível.
- É possível anexar um novo documento ao contrato durante a edição.


## Módulo de Contratos

A tela de contratos foi adicionada ao menu e permite:

- listar contratos ativos e encerrados;
- pesquisar por inquilino, imóvel ou apartamento;
- filtrar pelo status;
- visualizar e imprimir o contrato residencial de uma página;
- anexar contrato assinado em PDF ou imagem;
- visualizar anexos com link temporário protegido;
- encerrar contrato;
- liberar o apartamento e desativar o inquilino ao encerrar.

O SQL `002_contratos_anexos.sql` já executado no Supabase é suficiente para esta versão.


## Acompanhamento de Aluguéis

Execute `supabase/migrations/003_recebimentos.sql` no Editor SQL do Supabase antes de testar.

A tela gera automaticamente as cobranças mensais dos contratos ativos e permite registrar pagamento, calcular atraso, abrir cobrança no WhatsApp e imprimir recibo.


## Tela de Recebimentos

A tela foi criada no modelo aprovado e inclui:

- seletor de mês;
- botão Gerar cobranças;
- geração automática a partir dos contratos ativos;
- bloqueio de cobranças duplicadas;
- tabela com mês, imóvel, apartamento, inquilino, previsto, recebido, data, status e ações;
- edição do recebimento;
- estorno;
- recibo;
- exclusão;
- status Pago, Pendente e Atrasado.

A migração `003_recebimentos.sql` deve estar executada no Supabase.


## Tela de Relatórios

A tela foi criada no padrão visual aprovado e utiliza os dados da tabela de recebimentos:

- filtro por ano;
- previsto no ano;
- recebido no ano;
- pendente no ano;
- taxa anual de recebimento;
- resumo de janeiro a dezembro;
- resumo por imóvel;
- atualização automática conforme os recebimentos registrados.

Não é necessário executar novo SQL no Supabase.


## Tela de Backup

A área de backup permite:

- baixar os dados do usuário em arquivo JSON;
- importar um backup, atualizando registros pelo ID;
- apagar todos os registros após dupla confirmação;
- visualizar o histórico de backups realizados neste navegador.

O backup inclui registros de imóveis, apartamentos, inquilinos, contratos,
recebimentos, anexos e histórico.

Importante: os arquivos físicos do Supabase Storage, como PDFs e imagens,
não entram no arquivo JSON. Apenas os registros dos anexos são exportados.

Não é necessário executar novo SQL.

## Cobrança por WhatsApp no Acompanhamento

- O botão WhatsApp aparece somente para aluguéis com status **Atrasado**.
- A mensagem é preenchida automaticamente com nome do inquilino, imóvel, apartamento, valor, vencimento e dias de atraso.
- O número cadastrado é normalizado para o formato brasileiro com código 55.
- Caso não exista telefone cadastrado, o sistema mostra um aviso para editar o inquilino.
