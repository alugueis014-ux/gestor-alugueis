"use client";

import "../ui-standard.css";

import { useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { obterEmpresaAtual, obterEmpresaId } from "../../lib/empresa";
import { assinarAtualizacoes, notificarAtualizacao } from "../../lib/sincronizacao";

const TABELAS_EXPORTACAO = [
  "predios",
  "apartamentos",
  "inquilinos",
  "contratos",
  "recebimentos",
  "anexos",
  "historico"
];

const ORDEM_IMPORTACAO = [
  "predios",
  "apartamentos",
  "inquilinos",
  "contratos",
  "recebimentos",
  "anexos",
  "historico"
];

const ORDEM_EXCLUSAO = [
  "historico",
  "anexos",
  "recebimentos",
  "contratos",
  "inquilinos",
  "apartamentos",
  "predios"
];



async function obterEscopoDados() {
  const contexto = await obterEmpresaAtual({ incluirNome: true });

  return {
    modo: "multiempresa",
    campo: "empresa_id",
    id: contexto.empresaId,
    userId: contexto.userId,
    email: contexto.email,
    empresaNome: contexto.empresaNome || "Empresa"
  };
}

async function buscarTabelaNoEscopo(tabela, escopo) {
  const { data, error } = await supabase
    .from(tabela)
    .select("*")
    .eq("empresa_id", escopo.id);

  if (error) {
    throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
  }

  return data || [];
}

async function obterContextoImportacao() {
  const contexto = await obterEmpresaAtual({ incluirNome: true });

  return {
    empresaId: contexto.empresaId,
    empresaNome: contexto.empresaNome || "Empresa",
    userId: contexto.userId,
    email: contexto.email
  };
}

function dataHoraBR(data) {
  return new Date(data).toLocaleString("pt-BR");
}

function tamanhoArquivo(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


async function limparDadosDaEmpresa(empresaId) {
  // Ordem reversa das dependências para respeitar as chaves estrangeiras.
  const ordemExclusao = [
    "recebimentos",
    "anexos",
    "historico",
    "contratos",
    "inquilinos",
    "apartamentos",
    "predios"
  ];

  for (const tabela of ordemExclusao) {
    const { error } = await supabase
      .from(tabela)
      .delete()
      .eq("empresa_id", empresaId);

    if (error) {
      throw new Error(`Erro ao limpar ${tabela}: ${error.message}`);
    }
  }
}

async function upsertCompativel(tabela, registros) {
  let atuais = registros.map(item => ({ ...item }));
  const colunasIgnoradas = [];

  // Recebimentos possuem chave única por contrato + competência.
  // Backups antigos podem ter IDs diferentes para a mesma cobrança,
  // então usamos a chave de negócio para atualizar sem duplicar.
  const onConflict =
    tabela === "recebimentos"
      ? "contrato_id,competencia"
      : "id";

  // Backups antigos podem conter colunas que já foram removidas do banco.
  // Se o Supabase informar exatamente qual coluna não existe, removemos
  // somente essa coluna do lote e tentamos novamente.
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const { error } = await supabase
      .from(tabela)
      .upsert(atuais, { onConflict });

    if (!error) return colunasIgnoradas;

    const mensagem = error.message || "";
    const match =
      mensagem.match(/Could not find the '([^']+)' column/i) ||
      mensagem.match(/column ["']?([^"' ]+)["']? .* does not exist/i);

    const coluna = match?.[1];

    if (!coluna || !atuais.some(item => Object.prototype.hasOwnProperty.call(item, coluna))) {
      throw error;
    }

    atuais = atuais.map(item => {
      const copia = { ...item };
      delete copia[coluna];
      return copia;
    });

    colunasIgnoradas.push(coluna);
  }

  throw new Error(`Muitas incompatibilidades de colunas ao importar ${tabela}.`);
}


function novoId() {
  return crypto.randomUUID();
}

function criarMapaIds(registros) {
  const mapa = new Map();

  for (const item of Array.isArray(registros) ? registros : []) {
    if (item?.id) mapa.set(item.id, novoId());
  }

  return mapa;
}

function remap(mapa, valor) {
  if (!valor) return valor;
  return mapa.get(valor) || valor;
}

function prepararBackupComNovosIds(dados, empresaId, userId) {
  const predios = Array.isArray(dados?.predios) ? dados.predios : [];
  const apartamentos = Array.isArray(dados?.apartamentos) ? dados.apartamentos : [];
  const inquilinos = Array.isArray(dados?.inquilinos) ? dados.inquilinos : [];
  const contratos = Array.isArray(dados?.contratos) ? dados.contratos : [];
  const recebimentos = Array.isArray(dados?.recebimentos) ? dados.recebimentos : [];
  const anexos = Array.isArray(dados?.anexos) ? dados.anexos : [];
  const historico = Array.isArray(dados?.historico) ? dados.historico : [];

  // IDs novos evitam colisões com registros pertencentes a outras empresas.
  const ids = {
    predios: criarMapaIds(predios),
    apartamentos: criarMapaIds(apartamentos),
    inquilinos: criarMapaIds(inquilinos),
    contratos: criarMapaIds(contratos),
    recebimentos: criarMapaIds(recebimentos),
    anexos: criarMapaIds(anexos),
    historico: criarMapaIds(historico)
  };

  const predioPorApartamentoAntigo = new Map(
    apartamentos
      .filter(ap => ap?.id && ap?.predio_id)
      .map(ap => [ap.id, ap.predio_id])
  );

  return {
    predios: predios.map(item => ({
      ...item,
      id: remap(ids.predios, item.id),
      empresa_id: empresaId,
      proprietario_id: userId
    })),

    apartamentos: apartamentos.map(item => ({
      ...item,
      id: remap(ids.apartamentos, item.id),
      predio_id: remap(ids.predios, item.predio_id),
      empresa_id: empresaId,
      proprietario_id: userId
    })),

    inquilinos: inquilinos.map(item => {
      const copia = {
        ...item,
        id: remap(ids.inquilinos, item.id),
        empresa_id: empresaId,
        proprietario_id: userId
      };

      // Compatibilidade caso algum backup possua vínculos extras.
      if (copia.predio_id) copia.predio_id = remap(ids.predios, copia.predio_id);
      if (copia.apartamento_id) copia.apartamento_id = remap(ids.apartamentos, copia.apartamento_id);

      return copia;
    }),

    contratos: contratos.map(item => {
      const predioAntigo =
        item.predio_id ||
        predioPorApartamentoAntigo.get(item.apartamento_id) ||
        null;

      return {
        ...item,
        id: remap(ids.contratos, item.id),
        inquilino_id: remap(ids.inquilinos, item.inquilino_id),
        apartamento_id: remap(ids.apartamentos, item.apartamento_id),
        predio_id: predioAntigo ? remap(ids.predios, predioAntigo) : predioAntigo,
        empresa_id: empresaId,
        proprietario_id: userId
      };
    }),

    recebimentos: recebimentos.map(item => ({
      ...item,
      id: remap(ids.recebimentos, item.id),
      contrato_id: remap(ids.contratos, item.contrato_id),
      inquilino_id: remap(ids.inquilinos, item.inquilino_id),
      apartamento_id: remap(ids.apartamentos, item.apartamento_id),
      predio_id: remap(ids.predios, item.predio_id),
      empresa_id: empresaId,
      proprietario_id: userId
    })),

    anexos: anexos.map(item => ({
      ...item,
      id: remap(ids.anexos, item.id),
      contrato_id: remap(ids.contratos, item.contrato_id),
      inquilino_id: remap(ids.inquilinos, item.inquilino_id),
      apartamento_id: remap(ids.apartamentos, item.apartamento_id),
      predio_id: remap(ids.predios, item.predio_id),
      empresa_id: empresaId,
      proprietario_id: userId
    })),

    historico: historico.map(item => ({
      ...item,
      id: remap(ids.historico, item.id),
      predio_id: remap(ids.predios, item.predio_id),
      apartamento_id: remap(ids.apartamentos, item.apartamento_id),
      inquilino_id: remap(ids.inquilinos, item.inquilino_id),
      contrato_id: remap(ids.contratos, item.contrato_id),
      recebimento_id: remap(ids.recebimentos, item.recebimento_id),
      anexo_id: remap(ids.anexos, item.anexo_id),
      empresa_id: empresaId,
      proprietario_id: userId
    }))
  };
}

async function importarDadosNoEscopo(dados, empresaId, userId, { remapearIds = true } = {}) {
  const dadosPreparados = remapearIds
    ? prepararBackupComNovosIds(dados, empresaId, userId)
    : dados;

  for (const tabela of ORDEM_IMPORTACAO) {
    const registrosOriginais = dadosPreparados?.[tabela];

    if (!Array.isArray(registrosOriginais) || registrosOriginais.length === 0) {
      continue;
    }

    let registros = registrosOriginais.map(item => ({
      ...item,
      empresa_id: empresaId,
      proprietario_id: userId
    }));

    try {
      await upsertCompativel(tabela, registros);
    } catch (error) {
      throw new Error(`Erro ao importar ${tabela}: ${error.message}`);
    }
  }
}

async function capturarDadosAtuais(empresaId) {
  const dados = {};

  for (const tabela of TABELAS_EXPORTACAO) {
    const { data, error } = await supabase
      .from(tabela)
      .select("*")
      .eq("empresa_id", empresaId);

    if (error) {
      throw new Error(`Erro ao preparar cópia de segurança de ${tabela}: ${error.message}`);
    }

    dados[tabela] = data || [];
  }

  return dados;
}

export default function Backup() {
  const inputArquivo = useRef(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [historico, setHistorico] = useState([]);
  const [empresaAtualId, setEmpresaAtualId] = useState(null);
  const [empresaAtualNome, setEmpresaAtualNome] = useState("Empresa");

  useEffect(() => {
    let ativo = true;

    async function carregarContextoEHistorico() {
      try {
        const contexto = await obterEmpresaAtual({ incluirNome: true });
        if (!ativo) return;

        setEmpresaAtualId(contexto.empresaId);
        setEmpresaAtualNome(contexto.empresaNome || "Empresa");

        const chave = `historico_backups_${contexto.empresaId}`;
        const salvo = JSON.parse(localStorage.getItem(chave) || "[]");
        setHistorico(Array.isArray(salvo) ? salvo : []);
      } catch {
        if (ativo) {
          setHistorico([]);
          setEmpresaAtualId(null);
        }
      }
    }

    carregarContextoEHistorico();
    return () => { ativo = false; };
  }, []);

  function salvarHistorico(novo) {
    const atualizado = [novo, ...historico].slice(0, 20);
    setHistorico(atualizado);

    if (empresaAtualId) {
      const chave = `historico_backups_${empresaAtualId}`;
      localStorage.setItem(chave, JSON.stringify(atualizado));
    }
  }

  async function buscarDados() {
    const escopo = await obterEscopoDados();
    const dados = {};

    for (const tabela of TABELAS_EXPORTACAO) {
      dados[tabela] = await buscarTabelaNoEscopo(tabela, escopo);
    }

    return {
      sistema: "Gestão de Aluguéis",
      versao_backup: 2,
      criado_em: new Date().toISOString(),
      origem: "multiempresa",
      empresa_id_original: escopo.id,
      empresa_nome_original: escopo.empresaNome || "",
      proprietario_id_original: null,
      observacao:
        "O JSON contém os registros do banco. Arquivos físicos do Supabase Storage não estão incluídos.",
      dados
    };
  }

  async function baixarBackup() {
    setProcessando(true);
    setMensagem("");
    setErro("");

    try {
      const backup = await buscarDados();
      const conteudo = JSON.stringify(backup, null, 2);
      const blob = new Blob([conteudo], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const agora = new Date();
      const nome =
        `backup_gestao_alugueis_${agora.toISOString().replace(/[:.]/g, "-")}.json`;

      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      salvarHistorico({
        id: crypto.randomUUID(),
        data: backup.criado_em,
        tipo: "Completo",
        tamanho: blob.size,
        nome
      });

      setMensagem("Backup baixado com sucesso.");
    } catch (e) {
      setErro(e.message || "Não foi possível gerar o backup.");
    } finally {
      setProcessando(false);
    }
  }

  function escolherArquivo() {
    inputArquivo.current?.click();
  }

  async function importarBackup(event) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;

    const contexto = await obterEmpresaAtual({ incluirNome: true });

    if (!confirm(
      `Restaurar este backup em ${contexto.empresaNome || "esta empresa"}? ` +
      "Os dados atuais desta empresa serão apagados e substituídos pelos dados do arquivo selecionado."
    )) return;

    setProcessando(true);
    setMensagem("");
    setErro("");

    try {
      const texto = await arquivo.text();
      const backup = JSON.parse(texto);

      if (!backup?.dados || typeof backup.dados !== "object") {
        throw new Error("Arquivo de backup inválido.");
      }

      const { empresaId, empresaNome, userId } = await obterContextoImportacao();

      // Antes de apagar qualquer coisa, guarda em memória uma cópia completa
      // dos dados atuais da empresa. Se a importação falhar no meio,
      // o sistema tenta restaurar automaticamente essa cópia.
      const dadosAntesDaImportacao = await capturarDadosAtuais(empresaId);
      let dadosAtuaisForamApagados = false;

      try {
        // A restauração deve reproduzir exatamente o estado do backup.
        await limparDadosDaEmpresa(empresaId);
        dadosAtuaisForamApagados = true;

        await importarDadosNoEscopo(
          backup.dados,
          empresaId,
          userId,
          { remapearIds: true }
        );
      } catch (importError) {
        if (dadosAtuaisForamApagados) {
          try {
            await limparDadosDaEmpresa(empresaId);
            await importarDadosNoEscopo(
              dadosAntesDaImportacao,
              empresaId,
              userId,
              { remapearIds: false }
            );
          } catch (rollbackError) {
            throw new Error(
              `${importError.message} | ATENÇÃO: também não foi possível restaurar automaticamente os dados anteriores: ${rollbackError.message}`
            );
          }
        }

        throw importError;
      }

      salvarHistorico({
        id: crypto.randomUUID(),
        data: new Date().toISOString(),
        tipo: "Importado",
        tamanho: arquivo.size,
        nome: arquivo.name
      });

      setMensagem(
        `Backup importado com sucesso em ${empresaNome}. As telas serão atualizadas automaticamente.`
      );
      notificarAtualizacao("backup-importado");
    } catch (e) {
      const msg = e.message || "Não foi possível importar o backup.";
      setErro(
        /row-level security|rls/i.test(msg)
          ? `${msg} — A restauração foi interrompida por uma política de segurança do Supabase. Os dados anteriores foram preservados/restaurados automaticamente quando possível.`
          : msg
      );
    } finally {
      setProcessando(false);
    }
  }

  async function apagarTudo() {
    const contexto = await obterEmpresaAtual({ incluirNome: true });

    const primeira = confirm(
      `ATENÇÃO: todos os dados de ${contexto.empresaNome || "esta empresa"} serão apagados. ` +
      "Isso inclui imóveis, apartamentos, inquilinos, contratos, recebimentos e históricos. Deseja continuar?"
    );
    if (!primeira) return;

    const confirmacao = prompt(
      'Digite APAGAR TUDO para confirmar a exclusão permanente:'
    );
    if (confirmacao !== "APAGAR TUDO") {
      alert("Exclusão cancelada.");
      return;
    }

    setProcessando(true);
    setMensagem("");
    setErro("");

    try {
      const empresaId = contexto.empresaId;

      for (const tabela of ORDEM_EXCLUSAO) {
        const { error } = await supabase
          .from(tabela)
          .delete()
          .eq("empresa_id", empresaId);

        if (error) {
          throw new Error(`Erro ao apagar ${tabela}: ${error.message}`);
        }
      }

      setMensagem("Todos os registros desta empresa foram apagados.");
      notificarAtualizacao("backup-apagar-tudo");
    } catch (e) {
      setErro(e.message || "Não foi possível apagar os dados.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <section className="backup-panel">
          <h2>Backup</h2>

          <p className="backup-description">
            Os dados são armazenados no Supabase e podem ser exportados ou
            restaurados através de um arquivo de backup.
          </p>

          <div className="backup-includes">
            <strong>O backup inclui:</strong>
            <span>Imóveis</span>
            <span>Apartamentos</span>
            <span>Inquilinos</span>
            <span>Contratos</span>
            <span>Recebimentos</span>
            <span>Histórico</span>
            <span>Registros dos anexos</span>
          </div>

          <input
            ref={inputArquivo}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={importarBackup}
          />

          <div className="backup-actions">
            <button
              className="primary"
              onClick={baixarBackup}
              disabled={processando}
            >
              {processando ? "Processando..." : "Baixar backup"}
            </button>

            <button
              className="secondary"
              onClick={escolherArquivo}
              disabled={processando}
            >
              Importar backup
            </button>

            <button
              className="danger"
              onClick={apagarTudo}
              disabled={processando}
            >
              Apagar tudo
            </button>
          </div>

          <p className="backup-storage-note">
            Os arquivos físicos enviados ao armazenamento, como PDFs e imagens,
            não são incluídos no JSON. Os registros dos anexos são exportados.
          </p>

          {mensagem && <div className="backup-success">{mensagem}</div>}
          {erro && <div className="error">{erro}</div>}
        </section>

        <section className="backup-history-panel">
          <h3>Histórico neste navegador — {empresaAtualNome}</h3>

          <div className="backup-history-table-wrap">
            <table className="backup-history-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Arquivo</th>
                  <th>Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {historico.length === 0 && (
                  <tr>
                    <td colSpan="4" className="backup-empty">
                      Nenhum backup realizado neste navegador.
                    </td>
                  </tr>
                )}

                {historico.map(item => (
                  <tr key={item.id}>
                    <td>{dataHoraBR(item.data)}</td>
                    <td>{item.tipo}</td>
                    <td>{item.nome}</td>
                    <td>{tamanhoArquivo(item.tamanho || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </AppShell>
    </AuthGuard>
  );
}
