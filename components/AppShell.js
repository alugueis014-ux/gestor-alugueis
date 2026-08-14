"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const links = [
  ["/dashboard", "Dashboard"],
  ["/predios", "Prédios"],
  ["/apartamentos", "Apartamentos"],
  ["/disponiveis", "Disponíveis para Aluguel"],
  ["/inquilinos", "Inquilinos"],
  ["/contratos", "Contratos"],
  ["/acompanhamento", "Acompanhamento"],
  ["/recebimentos", "Recebimentos"],
  ["/controle-mensal", "Controle Mensal"],
  ["/relatorios", "Relatórios"],
  ["/backup", "Backup"]
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

      const dados = {};

      for (const tabela of TABELAS_BACKUP) {
        const { data, error } = await supabase
          .from(tabela)
          .select("*")
          .eq("proprietario_id", auth.user.id);

        if (error) {
          throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
        }

        dados[tabela] = data || [];
      }

      const backup = {
        sistema: "Gestão de Aluguéis",
        versao_backup: 1,
        criado_em: new Date().toISOString(),
        proprietario_id_original: auth.user.id,
        observacao:
          "Backup gerado automaticamente antes de sair do sistema. Arquivos físicos do Supabase Storage não estão incluídos.",
        dados
      };

      const conteudo = JSON.stringify(backup, null, 2);
      const blob = new Blob([conteudo], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const agora = new Date();
      const nome = `backup_gestao_alugueis_${agora
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
        <div className="brand">
          <h1>
            Gestão de
            <br />
            Aluguéis
          </h1>
          <p>
            Residencial Armando de
            <br />
            Gino
          </p>
        </div>

        <nav>
          {links.map(([href, label]) => (
            <Link
              href={href}
              key={href}
              className={pathname === href.split("?")[0] ? "active" : ""}
            >
              {label}
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
            Sair
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
