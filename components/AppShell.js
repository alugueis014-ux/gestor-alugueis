"use client";

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

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      router.replace("/login");
      router.refresh();
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
    </div>
  );
}
