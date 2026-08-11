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
  const [recebimentos, setRecebimentos] = useState([]);
  const [atrasados, setAtrasados] = useState(0);
  const [erro, setErro] = useState("");

  useEffect(() => { carregar(); }, [mes]);

  async function carregar() {
    setErro("");

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeIso = hoje.toISOString().slice(0, 10);

    const [p, a, i, r, atraso] = await Promise.all([
      supabase.from("predios").select("id,nome").order("nome"),
      supabase.from("apartamentos").select("id,predio_id,situacao"),
      supabase.from("inquilinos").select("id,status"),
      supabase
        .from("recebimentos")
        .select(`
          id,
          valor_previsto,
          valor_recebido,
          status,
          contratos(
            id,
            apartamentos(
              id,
              predio_id,
              predios(id,nome)
            )
          )
        `)
        .eq("competencia", `${mes}-01`),
      supabase
        .from("recebimentos")
        .select("id,status,data_vencimento")
        .lt("data_vencimento", hojeIso)
        .neq("status", "pago")
        .neq("status", "cancelado")
    ]);

    const falha = p.error || a.error || i.error || r.error || atraso.error;
    if (falha) setErro(falha.message);

    setPredios(p.data || []);
    setApartamentos(a.data || []);
    setInquilinos(i.data || []);
    setRecebimentos(r.data || []);
    setAtrasados((atraso.data || []).length);
  }

  const disponiveis = apartamentos.filter(a => a.situacao === "disponivel").length;
  const inquilinosAtivos = inquilinos.filter(i => i.status === "ativo").length;

  const resumo = useMemo(() => {
    const porPredio = new Map(
      predios.map(predio => [predio.id, {
        id: predio.id,
        nome: predio.nome,
        previsto: 0,
        recebido: 0,
        pendente: 0,
        pagos: 0,
        emAberto: 0
      }])
    );

    for (const recebimento of recebimentos) {
      if (recebimento.status === "cancelado") continue;

      const predio = recebimento.contratos?.apartamentos?.predios;
      const predioId = predio?.id || recebimento.contratos?.apartamentos?.predio_id;
      if (!predioId) continue;

      if (!porPredio.has(predioId)) {
        porPredio.set(predioId, {
          id: predioId,
          nome: predio?.nome || "Prédio não identificado",
          previsto: 0,
          recebido: 0,
          pendente: 0,
          pagos: 0,
          emAberto: 0
        });
      }

      const item = porPredio.get(predioId);
      const previsto = Number(recebimento.valor_previsto || 0);
      const recebido = Number(recebimento.valor_recebido || 0);
      const pendente = Math.max(0, previsto - recebido);

      item.previsto += previsto;
      item.recebido += recebido;
      item.pendente += pendente;

      if (recebimento.status === "pago") item.pagos += 1;
      else item.emAberto += 1;
    }

    return Array.from(porPredio.values());
  }, [predios, recebimentos]);

  const totais = useMemo(() => resumo.reduce((acc, item) => ({
    previsto: acc.previsto + item.previsto,
    recebido: acc.recebido + item.recebido,
    pendente: acc.pendente + item.pendente,
    pagos: acc.pagos + item.pagos,
    emAberto: acc.emAberto + item.emAberto
  }), { previsto: 0, recebido: 0, pendente: 0, pagos: 0, emAberto: 0 }), [resumo]);

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

        <a
          href="/acompanhamento"
          style={{
            display: "block",
            margin: "18px 0",
            padding: "16px 18px",
            borderRadius: 12,
            textDecoration: "none",
            fontWeight: 700,
            border: atrasados > 0 ? "1px solid #fecaca" : "1px solid #bbf7d0",
            background: atrasados > 0 ? "#fef2f2" : "#f0fdf4",
            color: atrasados > 0 ? "#b91c1c" : "#166534"
          }}
        >
          {atrasados > 0
            ? `⚠ Atenção: existem ${atrasados} aluguel(is) em atraso`
            : "✓ Todos os aluguéis estão em dia"}
        </a>

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
                  <tr><td colSpan="6" className="empty-row">Nenhum prédio cadastrado.</td></tr>
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
