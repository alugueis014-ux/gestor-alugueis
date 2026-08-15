"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import Icon from "./Icon";

const links = [
  ["/dashboard", "Início", "home"],
  ["/predios", "Prédios", "building"],
  ["/apartamentos", "Apartamentos", "door"],
  ["/disponiveis", "Disponíveis para Aluguel", "key"],
  ["/inquilinos", "Inquilinos", "users"],
  ["/contratos", "Contratos", "file"],
  ["/acompanhamento", "Acompanhamento", "chart"],
  ["/recebimentos", "Recebimentos", "wallet"],
  ["/controle-mensal", "Controle Mensal", "calendar"],
  ["/relatorios", "Relatórios", "trending"],
  ["/backup", "Backup", "cloud"],
  ["/configuracoes", "Configurações", "settings"]
];

const futuros = [];


const TABELAS_BACKUP = [
  "predios",
  "apartamentos",
  "inquilinos",
  "contratos",
  "recebimentos",
  "anexos",
  "historico"
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [fazendoBackup, setFazendoBackup] = useState(false);
  const [erroSaida, setErroSaida] = useState("");
  const [empresaNome, setEmpresaNome] = useState("Minha empresa");
  const [empresaId, setEmpresaId] = useState(null);

  async function obterVinculoEmpresa(userId, incluirNome = false) {
    const campos = incluirNome
      ? "empresa_id, empresas(nome)"
      : "empresa_id";

    // Estrutura atual do projeto: usuario_id.
    let consulta = await supabase
      .from("empresa_usuarios")
      .select(campos)
      .eq("usuario_id", userId)
      .limit(1)
      .maybeSingle();

    // Compatibilidade com instalações que usem user_id.
    if (
      consulta.error &&
      /usuario_id|column|schema cache/i.test(consulta.error.message || "")
    ) {
      consulta = await supabase
        .from("empresa_usuarios")
        .select(campos)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
    }

    if (consulta.error) throw consulta.error;
    if (!consulta.data?.empresa_id) {
      throw new Error("Não foi possível identificar a empresa do usuário.");
    }

    return consulta.data;
  }

  useEffect(() => {
    let ativo = true;

    async function carregarEmpresa() {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user || !ativo) return;

      let vinculo;
      try {
        vinculo = await obterVinculoEmpresa(auth.user.id, true);
      } catch (_) {
        return;
      }

      if (!ativo) return;

      setEmpresaId(vinculo.empresa_id);

      const nome = Array.isArray(vinculo.empresas)
        ? vinculo.empresas[0]?.nome
        : vinculo.empresas?.nome;

      if (nome) setEmpresaNome(nome);
    }

    carregarEmpresa();
    return () => { ativo = false; };
  }, []);

  function handleLogout() {
    setErroSaida("");
    setConfirmarSaida(true);
  }

  async function sairSemBackup() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      setConfirmarSaida(false);
      router.replace("/login");
      router.refresh();
    }
  }

  async function gerarBackupAntesDeSair() {
    setFazendoBackup(true);
    setErroSaida("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        throw new Error("Sessão inválida. Não foi possível gerar o backup.");
      }

      let idEmpresa = empresaId;

      if (!idEmpresa) {
        const vinculo = await obterVinculoEmpresa(auth.user.id);
        idEmpresa = vinculo.empresa_id;
      }

      const dados = {};

      for (const tabela of TABELAS_BACKUP) {
        const { data, error } = await supabase
          .from(tabela)
          .select("*")
          .eq("empresa_id", idEmpresa);

        if (error) {
          throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
        }

        dados[tabela] = data || [];
      }

      const backup = {
        sistema: "Alugue Fácil",
        versao_backup: 1,
        criado_em: new Date().toISOString(),
        usuario_id_original: auth.user.id,
        empresa_id_original: idEmpresa,
        observacao:
          "Backup gerado automaticamente antes de sair do sistema. Arquivos físicos do Supabase Storage não estão incluídos.",
        dados
      };

      const conteudo = JSON.stringify(backup, null, 2);
      const blob = new Blob([conteudo], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const agora = new Date();
      const nome = `backup_alugue_facil_${agora
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;

      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      await supabase.auth.signOut({ scope: "local" });
      setConfirmarSaida(false);
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setErroSaida(e.message || "Não foi possível gerar o backup.");
    } finally {
      setFazendoBackup(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand brand-alugue-facil">
          <img
            src="/alugue-facil-logo.svg"
            alt="Alugue Fácil"
            className="brand-logo"
          />
          <p className="brand-company">{empresaNome}</p>
        </div>

        <nav>
          {links.map(([href, label, icon]) => (
            <Link
              href={href}
              key={href}
              className={pathname === href.split("?")[0] ? "active" : ""}
            >
              <Icon name={icon} size={19} className="menu-icon" />
              <span>{label}</span>
            </Link>
          ))}

          {futuros.map((label) => (
            <div className="menu-futuro" key={label}>
              {label}
            </div>
          ))}

          <button
            type="button"
            onClick={handleLogout}
            className="logout-button"
          >
            <Icon name="logout" size={19} className="menu-icon" />
            <span>Sair</span>
          </button>
        </nav>
      </aside>

      <main className="content">{children}</main>

      {confirmarSaida && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.48)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 9999
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !fazendoBackup) {
              setConfirmarSaida(false);
            }
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 25px 70px rgba(0,0,0,.28)",
              overflow: "hidden"
            }}
          >
            <div style={{ padding: "22px 24px 10px" }}>
              <h3 style={{ margin: 0, fontSize: 24 }}>
                Deseja fazer backup antes de sair?
              </h3>
              <p style={{ margin: "10px 0 0", color: "#64748b", lineHeight: 1.5 }}>
                O sistema pode baixar uma cópia dos seus dados antes de encerrar a sessão.
              </p>
            </div>

            {erroSaida && (
              <div className="error" style={{ margin: "10px 24px 0" }}>
                {erroSaida}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexWrap: "wrap",
                padding: "18px 24px 22px"
              }}
            >
              <button
                type="button"
                className="secondary"
                onClick={() => setConfirmarSaida(false)}
                disabled={fazendoBackup}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="secondary"
                onClick={sairSemBackup}
                disabled={fazendoBackup}
              >
                Sair sem backup
              </button>

              <button
                type="button"
                className="primary"
                onClick={gerarBackupAntesDeSair}
                disabled={fazendoBackup}
              >
                {fazendoBackup ? "Gerando backup..." : "Fazer backup e sair"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
