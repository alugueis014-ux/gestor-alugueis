"use client";

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

function dataHoraBR(data) {
  return new Date(data).toLocaleString("pt-BR");
}

function tamanhoArquivo(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      throw new Error("Sessão inválida. Entre novamente no sistema.");
    }

    const dados = {};

    for (const tabela of TABELAS_EXPORTACAO) {
      const { data, error } = await supabase
        .from(tabela)
        .select("*")
        .eq("proprietario_id", auth.user.id);

      if (error) throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
      dados[tabela] = data || [];
    }

    return {
      sistema: "Gestão de Aluguéis",
      versao_backup: 1,
      criado_em: new Date().toISOString(),
      proprietario_id_original: auth.user.id,
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
      "Importar este backup? Registros com o mesmo ID serão atualizados. " +
      "Os demais dados atuais serão mantidos."
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

      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        throw new Error("Sessão inválida.");
      }

      for (const tabela of ORDEM_IMPORTACAO) {
        const registrosOriginais = backup.dados[tabela];
        if (!Array.isArray(registrosOriginais) || registrosOriginais.length === 0) {
          continue;
        }

        const registros = registrosOriginais.map(item => ({
          ...item,
          proprietario_id: auth.user.id
        }));

        const { error } = await supabase
          .from(tabela)
          .upsert(registros, { onConflict: "id" });

        if (error) {
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
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        throw new Error("Sessão inválida.");
      }

      for (const tabela of ORDEM_EXCLUSAO) {
        const { error } = await supabase
          .from(tabela)
          .delete()
          .eq("proprietario_id", auth.user.id);

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
