"use client";

import "../ui-standard.css";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

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
  const [prediosAbertos, setPrediosAbertos] = useState({});
  const [ocultarInformacoes, setOcultarInformacoes] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    carregar();
  }, [mes]);

  useEffect(() => {
    try {
      setOcultarInformacoes(
        localStorage.getItem("gestor_ocultar_inicio") === "true"
      );
    } catch (_) {}
  }, []);

  function alternarPrivacidade() {
    setOcultarInformacoes(atual => {
      const novo = !atual;
      try {
        localStorage.setItem("gestor_ocultar_inicio", String(novo));
      } catch (_) {}
      return novo;
    });
  }

  function valorPrivado(valor) {
    return ocultarInformacoes ? "••••••" : valor;
  }

  async function carregar() {
    setErro("");

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeIso = hoje.toISOString().slice(0, 10);

    const [p, a, i, r, atraso] = await Promise.all([
      supabase.from("predios").select("id,nome,endereco").order("nome"),
      supabase
        .from("apartamentos")
        .select(`
          id,
          predio_id,
          numero,
          situacao,
          contratos(
            status,
            inquilinos(nome)
          )
        `)
        .order("numero"),
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
              predios(id,nome,endereco)
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
        endereco: predio.endereco || "",
        apartamentos: apartamentos.filter(a => a.predio_id === predio.id),
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
          endereco: predio?.endereco || "",
          apartamentos: apartamentos.filter(a => a.predio_id === predioId),
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
  }, [predios, recebimentos, apartamentos]);

  const totais = useMemo(() => resumo.reduce((acc, item) => ({
    previsto: acc.previsto + item.previsto,
    recebido: acc.recebido + item.recebido,
    pendente: acc.pendente + item.pendente,
    pagos: acc.pagos + item.pagos,
    emAberto: acc.emAberto + item.emAberto
  }), { previsto: 0, recebido: 0, pendente: 0, pagos: 0, emAberto: 0 }), [resumo]);

  function alternarPredio(predioId) {
    setPrediosAbertos(atual => ({
      ...atual,
      [predioId]: !atual[predioId]
    }));
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="dashboard-header">
          <h2>Início</h2>
          <div className="dashboard-header-actions">
            <button
              type="button"
              className="privacy-button"
              onClick={alternarPrivacidade}
              aria-label={ocultarInformacoes ? "Mostrar informações" : "Ocultar informações"}
              title={ocultarInformacoes ? "Mostrar informações" : "Ocultar informações"}
            >
              <Icon name={ocultarInformacoes ? "eyeOff" : "eye"} size={18} />
              <span>{ocultarInformacoes ? "Mostrar" : "Ocultar"}</span>
            </button>
            <input type="month" className="month-picker" value={mes} onChange={e => setMes(e.target.value)} />
          </div>
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="dashboard-cards first-row">
          <Link href="/recebimentos" className="dashboard-card dashboard-card-link">
            <span>Previsto</span>
            <strong>{valorPrivado(dinheiro(totais.previsto))}</strong>
            <small>Ver recebimentos →</small>
          </Link>

          <Link href="/recebimentos" className="dashboard-card dashboard-card-link">
            <span>Recebido</span>
            <strong>{valorPrivado(dinheiro(totais.recebido))}</strong>
            <small>Ver recebimentos →</small>
          </Link>

          <Link href="/recebimentos" className="dashboard-card dashboard-card-link">
            <span>Pendente</span>
            <strong>{valorPrivado(dinheiro(totais.pendente))}</strong>
            <small>Ver pendências →</small>
          </Link>

          <Link href="/predios" className="dashboard-card dashboard-card-link">
            <span>Prédios</span>
            <strong>{valorPrivado(predios.length)}</strong>
            <small>Ver prédios →</small>
          </Link>
        </div>

        <div className="dashboard-cards second-row">
          <Link href="/apartamentos" className="dashboard-card dashboard-card-link">
            <span>Apartamentos</span>
            <strong>{valorPrivado(apartamentos.length)}</strong>
            <small>Ver apartamentos →</small>
          </Link>

          <Link href="/disponiveis" className="dashboard-card dashboard-card-link">
            <span>Disponíveis</span>
            <strong>{valorPrivado(disponiveis)}</strong>
            <small>Ver disponíveis →</small>
          </Link>

          <Link href="/inquilinos" className="dashboard-card dashboard-card-link">
            <span>Inquilinos</span>
            <strong>{valorPrivado(inquilinosAtivos)}</strong>
            <small>Ver inquilinos →</small>
          </Link>
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
                  <th aria-label="Expandir"></th>
                </tr>
              </thead>
              <tbody>
                {resumo.length === 0 ? (
                  <tr><td colSpan="7" className="empty-row">Nenhum prédio cadastrado.</td></tr>
                ) : resumo.map(item => (
                  <Fragment key={item.id}>
                    <tr
                      key={item.id}
                      className="summary-building-row"
                      onClick={() => alternarPredio(item.id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={!!prediosAbertos[item.id]}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          alternarPredio(item.id);
                        }
                      }}
                    >
                      <td>
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>{item.nome}</strong>
                          {item.endereco && (
                            <span style={{ color: "#64748b", fontSize: 13 }}>
                              {item.endereco}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{valorPrivado(dinheiro(item.previsto))}</td>
                      <td>{valorPrivado(dinheiro(item.recebido))}</td>
                      <td>{valorPrivado(dinheiro(item.pendente))}</td>
                      <td>{valorPrivado(item.pagos)}</td>
                      <td>{valorPrivado(item.emAberto)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            alternarPredio(item.id);
                          }}
                          className="summary-toggle"
                          aria-expanded={!!prediosAbertos[item.id]}
                          aria-label={prediosAbertos[item.id] ? "Ocultar apartamentos" : "Mostrar apartamentos"}
                          title={prediosAbertos[item.id] ? "Ocultar apartamentos" : "Mostrar apartamentos"}
                        >
                          {prediosAbertos[item.id] ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>

                    {prediosAbertos[item.id] && (
                      <tr key={`${item.id}-apartamentos`}>
                        <td colSpan="7" style={{ padding: 0, background: "#f8fafc" }}>
                          <div style={{ padding: "12px 16px 16px 28px" }}>
                            {item.apartamentos.length === 0 ? (
                              <div style={{ color: "#64748b" }}>
                                Nenhum apartamento cadastrado neste prédio.
                              </div>
                            ) : (
                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                  background: "#fff"
                                }}
                              >
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", padding: "8px 10px" }}>
                                      Apartamento
                                    </th>
                                    <th style={{ textAlign: "left", padding: "8px 10px" }}>
                                      Situação
                                    </th>
                                    <th style={{ textAlign: "left", padding: "8px 10px" }}>
                                      Atual inquilino
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.apartamentos.map(apartamento => (
                                    <tr key={apartamento.id}>
                                      <td style={{ padding: "8px 10px", borderTop: "1px solid #e2e8f0" }}>
                                        {apartamento.numero || "-"}
                                      </td>
                                      <td style={{ padding: "8px 10px", borderTop: "1px solid #e2e8f0" }}>
                                        {apartamento.situacao || "-"}
                                      </td>
                                      <td style={{ padding: "8px 10px", borderTop: "1px solid #e2e8f0" }}>
                                        {apartamento.contratos?.find(contrato => contrato.status === "ativo")?.inquilinos?.nome || "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL GERAL</td>
                  <td>{valorPrivado(dinheiro(totais.previsto))}</td>
                  <td>{valorPrivado(dinheiro(totais.recebido))}</td>
                  <td>{valorPrivado(dinheiro(totais.pendente))}</td>
                  <td>{valorPrivado(totais.pagos)}</td>
                  <td>{valorPrivado(totais.emAberto)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        <style jsx>{`
          :global(.dashboard-card-link){
            display:block;
            color:inherit;
            text-decoration:none;
            cursor:pointer;
            transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;
          }

          :global(.dashboard-card-link:hover){
            transform:translateY(-2px);
            box-shadow:0 8px 22px rgba(30,60,90,.10);
            border-color:#b8cadc;
          }

          :global(.dashboard-card-link:focus-visible){
            outline:3px solid rgba(37,99,235,.22);
            outline-offset:2px;
          }

          :global(.dashboard-card-link small){
            display:block;
            margin-top:10px;
            color:#456786;
            font-size:13px;
            font-weight:700;
          }
        `}</style>

      </AppShell>
    </AuthGuard>
  );
}
