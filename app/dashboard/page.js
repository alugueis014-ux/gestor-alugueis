"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

const dinheiro = valor => Number(valor || 0).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});

export default function Dashboard() {
  const agora = new Date();
  const [mes, setMes] = useState(`${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
  const [predios, setPredios] = useState([]);
  const [apartamentos, setApartamentos] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [erro, setErro] = useState("");

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    setErro("");
    const [p, a, i] = await Promise.all([
      supabase.from("predios").select("id,nome").order("nome"),
      supabase.from("apartamentos").select("id,predio_id,situacao"),
      supabase.from("inquilinos").select("id,status")
    ]);

    const falha = p.error || a.error || i.error;
    if (falha) setErro(falha.message);
    setPredios(p.data || []);
    setApartamentos(a.data || []);
    setInquilinos(i.data || []);
  }

  const disponiveis = apartamentos.filter(a => a.situacao === "disponivel").length;
  const inquilinosAtivos = inquilinos.filter(i => i.status === "ativo").length;

  const resumo = useMemo(() => predios.map(predio => ({
    id: predio.id,
    nome: predio.nome,
    previsto: 0,
    recebido: 0,
    pendente: 0,
    pagos: 0,
    emAberto: 0
  })), [predios]);

  const totais = resumo.reduce((acc, item) => ({
    previsto: acc.previsto + item.previsto,
    recebido: acc.recebido + item.recebido,
    pendente: acc.pendente + item.pendente,
    pagos: acc.pagos + item.pagos,
    emAberto: acc.emAberto + item.emAberto
  }), { previsto: 0, recebido: 0, pendente: 0, pagos: 0, emAberto: 0 });

  return (
    <AuthGuard>
      <AppShell>
        <div className="dashboard-header">
          <h2>Dashboard</h2>
          <input type="month" className="month-picker" value={mes} onChange={e => setMes(e.target.value)} />
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="dashboard-cards first-row">
          <div className="dashboard-card"><span>Previsto</span><strong>{dinheiro(totais.previsto)}</strong></div>
          <div className="dashboard-card"><span>Recebido</span><strong>{dinheiro(totais.recebido)}</strong></div>
          <div className="dashboard-card"><span>Pendente</span><strong>{dinheiro(totais.pendente)}</strong></div>
          <div className="dashboard-card"><span>Prédios</span><strong>{predios.length}</strong></div>
        </div>

        <div className="dashboard-cards second-row">
          <div className="dashboard-card"><span>Apartamentos</span><strong>{apartamentos.length}</strong></div>
          <div className="dashboard-card"><span>Disponíveis</span><strong>{disponiveis}</strong></div>
          <div className="dashboard-card"><span>Inquilinos</span><strong>{inquilinosAtivos}</strong></div>
        </div>

        <section className="monthly-summary">
          <h3>Resumo mensal por prédio</h3>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Prédio</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Pendente</th>
                  <th>Pagos</th>
                  <th>Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {resumo.length === 0 ? (
                  <tr><td colSpan="6" className="empty-row">Nenhum recebimento gerado para este mês.</td></tr>
                ) : resumo.map(item => (
                  <tr key={item.id}>
                    <td>{item.nome}</td>
                    <td>{dinheiro(item.previsto)}</td>
                    <td>{dinheiro(item.recebido)}</td>
                    <td>{dinheiro(item.pendente)}</td>
                    <td>{item.pagos}</td>
                    <td>{item.emAberto}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL GERAL</td>
                  <td>{dinheiro(totais.previsto)}</td>
                  <td>{dinheiro(totais.recebido)}</td>
                  <td>{dinheiro(totais.pendente)}</td>
                  <td>{totais.pagos}</td>
                  <td>{totais.emAberto}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </AppShell>
    </AuthGuard>
  );
}
