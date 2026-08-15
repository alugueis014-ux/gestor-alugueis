"use client";

import "../ui-standard.css";

import { useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

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
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError || !auth?.user) {
    throw new Error("Sessão inválida. Entre novamente no sistema.");
  }

  // Primeiro tenta a estrutura nova (multiempresa).
  let consulta = await supabase
    .from("empresa_usuarios")
    .select("empresa_id")
    .eq("usuario_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  if (
    consulta.error &&
    /usuario_id|column|schema cache/i.test(consulta.error.message || "") &&
    !/empresa_usuarios/i.test(consulta.error.message || "")
  ) {
    consulta = await supabase
      .from("empresa_usuarios")
      .select("empresa_id")
      .eq("user_id", auth.user.id)
      .limit(1)
      .maybeSingle();
  }

  if (!consulta.error && consulta.data?.empresa_id) {
    return {
      modo: "multiempresa",
      campo: "empresa_id",
      id: consulta.data.empresa_id,
      userId: auth.user.id
    };
  }

  // Banco antigo: não existe empresa_usuarios e os registros pertencem
  // diretamente ao usuário por proprietario_id.
  if (
    consulta.error &&
    /empresa_usuarios|schema cache|could not find the table|relation .* does not exist/i.test(
      consulta.error.message || ""
    )
  ) {
    return {
      modo: "legado",
      campo: "proprietario_id",
      id: auth.user.id,
      userId: auth.user.id
    };
  }

  if (consulta.error) throw consulta.error;

  // Compatibilidade adicional: se não houver vínculo, tenta o formato legado.
  return {
    modo: "legado",
    campo: "proprietario_id",
    id: auth.user.id,
    userId: auth.user.id
  };
}

async function buscarTabelaNoEscopo(tabela, escopo) {
  let consulta = await supabase
    .from(tabela)
    .select("*")
    .eq(escopo.campo, escopo.id);

  if (!consulta.error) return consulta.data || [];

  // Algumas tabelas antigas podem não ter proprietario_id.
  // Nesses casos, a própria RLS do projeto antigo limita os dados do usuário.
  if (
    escopo.modo === "legado" &&
    /proprietario_id|column|schema cache/i.test(consulta.error.message || "")
  ) {
    consulta = await supabase
      .from(tabela)
      .select("*");

    if (!consulta.error) return consulta.data || [];
  }

  throw new Error(`Erro ao ler ${tabela}: ${consulta.error.message}`);
}

async function obterEmpresaId() {
  const escopo = await obterEscopoDados();
  if (escopo.modo !== "multiempresa") {
    throw new Error(
      "A importação nesta versão deve ser feita no banco multiempresa. Use apenas 'Baixar backup' neste banco antigo."
    );
  }
  return escopo.id;
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

export default function Backup() {
  const inputArquivo = useRef(null);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [historico, setHistorico] = useState([]);

  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("historico_backups") || "[]");
      setHistorico(Array.isArray(salvo) ? salvo : []);
    } catch {
      setHistorico([]);
    }
  }, []);

  function salvarHistorico(novo) {
    const atualizado = [novo, ...historico].slice(0, 20);
    setHistorico(atualizado);
    localStorage.setItem("historico_backups", JSON.stringify(atualizado));
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
      origem: escopo.modo,
      empresa_id_original: escopo.modo === "multiempresa" ? escopo.id : null,
      proprietario_id_original: escopo.modo === "legado" ? escopo.id : null,
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

    if (!confirm(
      "Restaurar este backup? Os dados atuais desta empresa serão apagados " +
      "e substituídos pelos dados do arquivo selecionado."
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

      const empresaId = await obterEmpresaId();

      // A restauração deve reproduzir exatamente o estado do backup.
      // Por isso, remove primeiro os dados atuais da empresa.
      await limparDadosDaEmpresa(empresaId);

      for (const tabela of ORDEM_IMPORTACAO) {
        const registrosOriginais = backup.dados[tabela];
        if (!Array.isArray(registrosOriginais) || registrosOriginais.length === 0) {
          continue;
        }

        let registros = registrosOriginais.map(item => ({
          ...item,
          empresa_id: empresaId
        }));

        // Backups antigos não possuíam predio_id em contratos.
        // Recupera automaticamente o prédio através do apartamento.
        if (tabela === "contratos") {
          const apartamentosBackup = Array.isArray(backup.dados.apartamentos)
            ? backup.dados.apartamentos
            : [];

          const predioPorApartamento = new Map(
            apartamentosBackup
              .filter(ap => ap?.id && ap?.predio_id)
              .map(ap => [ap.id, ap.predio_id])
          );

          const idsPendentes = [...new Set(
            registros
              .filter(item => !item.predio_id && item.apartamento_id)
              .map(item => item.apartamento_id)
              .filter(id => !predioPorApartamento.has(id))
          )];

          if (idsPendentes.length) {
            const { data: apartamentosBanco, error: apartamentosError } = await supabase
              .from("apartamentos")
              .select("id,predio_id")
              .eq("empresa_id", empresaId)
              .in("id", idsPendentes);

            if (apartamentosError) throw apartamentosError;

            (apartamentosBanco || []).forEach(ap => {
              if (ap?.id && ap?.predio_id) {
                predioPorApartamento.set(ap.id, ap.predio_id);
              }
            });
          }

          registros = registros.map(item => {
            if (item.predio_id || !item.apartamento_id) return item;

            const predioId = predioPorApartamento.get(item.apartamento_id);
            if (!predioId) {
              throw new Error(
                `Não foi possível identificar o prédio do contrato ${item.id || ""}.`
              );
            }

            return { ...item, predio_id: predioId };
          });
        }

        try {
          await upsertCompativel(tabela, registros);
        } catch (error) {
          throw new Error(`Erro ao importar ${tabela}: ${error.message}`);
        }
      }

      salvarHistorico({
        id: crypto.randomUUID(),
        data: new Date().toISOString(),
        tipo: "Importado",
        tamanho: arquivo.size,
        nome: arquivo.name
      });

      setMensagem("Backup importado com sucesso. Atualize as telas do sistema.");
    } catch (e) {
      setErro(e.message || "Não foi possível importar o backup.");
    } finally {
      setProcessando(false);
    }
  }

  async function apagarTudo() {
    const primeira = confirm(
      "ATENÇÃO: todos os prédios, apartamentos, inquilinos, contratos, " +
      "recebimentos e históricos serão apagados. Deseja continuar?"
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
      const empresaId = await obterEmpresaId();

      for (const tabela of ORDEM_EXCLUSAO) {
        const { error } = await supabase
          .from(tabela)
          .delete()
          .eq("empresa_id", empresaId);

        if (error) {
          throw new Error(`Erro ao apagar ${tabela}: ${error.message}`);
        }
      }

      setMensagem("Todos os registros do sistema foram apagados.");
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
            <span>Prédios</span>
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
          <h3>Histórico neste navegador</h3>

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
