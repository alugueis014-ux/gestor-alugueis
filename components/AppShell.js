"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/dashboard", "Dashboard"],
  ["/predios", "Prédios"],
  ["/apartamentos", "Apartamentos"],
  ["/disponiveis", "Disponíveis para Aluguel"],
  ["/inquilinos", "Inquilinos"],
  ["/contratos", "Contratos"],
  ["/acompanhamento", "Acompanhamento"],
  ["/recebimentos", "Recebimentos"],
  ["/relatorios", "Relatórios"],
  ["/backup", "Backup"]
];

const futuros = [];

export default function AppShell({ children }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Gestão de<br />Aluguéis</h1>
          <p>Residencial Armando de<br />Gino</p>
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
          {futuros.map(label => <div className="menu-futuro" key={label}>{label}</div>)}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
