"use client";

import "../ui-standard.css";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";
import { obterEmpresaId } from "../../lib/empresa";

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
  const [comandoRecebimento, setComandoRecebimento] = useState("");
  const [ouvindoRecebimento, setOuvindoRecebimento] = useState(false);
  const [modalRecebimento, setModalRecebimento] = useState(null);
  const [candidatosRecebimento, setCandidatosRecebimento] = useState([]);
  const [salvandoRecebimento, setSalvandoRecebimento] = useState(false);

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

    try {
      const empresaId = await obterEmpresaId();

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeIso = hoje.toISOString().slice(0, 10);

      const [p, a, i, r, atraso] = await Promise.all([
        supabase
          .from("predios")
          .select("id,nome,endereco")
          .eq("empresa_id", empresaId)
          .eq("arquivado", false)
          .order("nome"),

        supabase
          .from("apartamentos")
          .select(`
            id,
            empresa_id,
            predio_id,
            numero,
            situacao,
            contratos(
              status,
              empresa_id,
              inquilinos(nome)
            )
          `)
          .eq("empresa_id", empresaId)
          .order("numero"),

        supabase
          .from("inquilinos")
          .select("id,status")
          .eq("empresa_id", empresaId),

        supabase
          .from("recebimentos")
          .select(`
            id,
            empresa_id,
            competencia,
            data_vencimento,
            valor_previsto,
            valor_recebido,
            status,
            contratos!inner(
              id,
              empresa_id,
              apartamento_id,
              status,
              data_inicio,
              inquilinos(id,nome),
              apartamentos(
                id,
                numero,
                predio_id,
                predios(id,nome,endereco)
              )
            )
          `)
          .eq("empresa_id", empresaId)
          .eq("contratos.empresa_id", empresaId)
          .eq("competencia", `${mes}-01`),

        supabase
          .from("recebimentos")
          .select(`
            id,
            competencia,
            status,
            data_vencimento,
            contratos!inner(id,empresa_id,apartamento_id)
          `)
          .eq("empresa_id", empresaId)
          .eq("contratos.empresa_id", empresaId)
          .lt("data_vencimento", hojeIso)
          .neq("status", "pago")
          .neq("status", "cancelado")
      ]);

      const falha = p.error || a.error || i.error || r.error || atraso.error;
      if (falha) throw falha;

      const deduplicarRecebimentos = (lista = []) => {
        const mapa = new Map();

        const pontuar = item => {
          const status = String(item.status || "").toLowerCase();
          const previsto = Number(item.valor_previsto || 0);
          const recebido = Number(item.valor_recebido || 0);

          const pago =
            status === "pago" || (previsto > 0 && recebido >= previsto)
              ? 1000000000
              : 0;

          const ativo =
            String(item.contratos?.status || "").toLowerCase() === "ativo"
              ? 100000000
              : 0;

          const valorRecebido = recebido * 1000;

          const inicio =
            Number(
              String(item.contratos?.data_inicio || "")
                .replace(/-/g, "")
            ) || 0;

          return pago + ativo + valorRecebido + inicio;
        };

        for (const item of lista) {
          const apartamentoId =
            item.contratos?.apartamento_id ||
            item.contratos?.apartamentos?.id ||
            item.id;

          const chave = `${apartamentoId}|${item.competencia || ""}`;
          const atual = mapa.get(chave);

          if (!atual || pontuar(item) > pontuar(atual)) {
            mapa.set(chave, item);
          }
        }

        return Array.from(mapa.values());
      };

      const recebimentosUnicos = deduplicarRecebimentos(r.data || []);

      const atrasadosUnicos = Array.from(
        (atraso.data || []).reduce((mapa, item) => {
          const apartamentoId = item.contratos?.apartamento_id || item.id;
          const chave = `${apartamentoId}|${item.competencia || item.data_vencimento || ""}`;
          if (!mapa.has(chave)) mapa.set(chave, item);
          return mapa;
        }, new Map()).values()
      );

      setPredios(p.data || []);
      setApartamentos(a.data || []);
      setInquilinos(i.data || []);
      setRecebimentos(recebimentosUnicos);
      setAtrasados(atrasadosUnicos.length);
    } catch (e) {
      setErro(e.message || "Não foi possível carregar a tela inicial.");
      setPredios([]);
      setApartamentos([]);
      setInquilinos([]);
      setRecebimentos([]);
      setAtrasados(0);
    }
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
          nome: predio?.nome || "Imóvel não identificado",
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

  function normalizarTexto(valor = "") {
    return valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hojeISO() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function extrairNomeDoComando(frase) {
    let nome = normalizarTexto(frase);
    const expressoes = [
      "recebi o pagamento do aluguel de",
      "recebi pagamento do aluguel de",
      "recebi o aluguel de",
      "recebi aluguel de",
      "receber o aluguel de",
      "receber aluguel de",
      "pagamento do aluguel de",
      "aluguel de",
      "recebi de",
      "receber de"
    ];
    for (const inicio of expressoes) {
      if (nome.includes(inicio)) {
        nome = nome.split(inicio).pop().trim();
        break;
      }
    }
    return nome.replace(/\b(hoje|agora|via pix|no pix|em dinheiro|dinheiro)\b/g, " ").replace(/\s+/g, " ").trim();
  }

  function buscarRecebimentoRapido(frase) {
    setErro("");
    setCandidatosRecebimento([]);

    const nomeFalado = extrairNomeDoComando(frase);
    if (!nomeFalado) {
      setErro('Digite ou fale o nome do inquilino. Ex.: "Recebi o aluguel de João Carlos".');
      return;
    }

    const palavras = nomeFalado.split(" ").filter(p => p.length > 1);
    // No recebimento rápido aparecem SOMENTE cobranças realmente em aberto.
    // Se já recebeu o valor total, não mostra novamente mesmo que o status
    // antigo do registro esteja inconsistente.
    // Regra global do Recebimento Rápido:
    // para cada apartamento + competência, se existir QUALQUER cobrança já paga,
    // nenhuma cobrança pendente duplicada desse mesmo apartamento/mês pode aparecer.
    const chavesPagas = new Set(
      recebimentos
        .filter(r => {
          const status = String(r.status || "").toLowerCase();
          const previsto = Number(r.valor_previsto || 0);
          const recebido = Number(r.valor_recebido || 0);
          return status === "pago" || (previsto > 0 && recebido >= previsto);
        })
        .map(r => {
          const apartamentoId =
            r.contratos?.apartamentos?.id ||
            r.contratos?.apartamento_id ||
            "";
          return `${apartamentoId}|${r.competencia}`;
        })
    );

    const pendentes = recebimentos.filter(r => {
      const status = String(r.status || "").toLowerCase();
      const previsto = Number(r.valor_previsto || 0);
      const recebido = Number(r.valor_recebido || 0);
      const apartamentoId =
        r.contratos?.apartamentos?.id ||
        r.contratos?.apartamento_id ||
        "";
      const chave = `${apartamentoId}|${r.competencia}`;

      return (
        status !== "pago" &&
        status !== "cancelado" &&
        recebido < previsto &&
        !chavesPagas.has(chave)
      );
    });

    let candidatos = pendentes.filter(r => {
      const nome = normalizarTexto(r.contratos?.inquilinos?.nome || "");
      if (!nome) return false;
      if (nome.includes(nomeFalado) || nomeFalado.includes(nome)) return true;
      return palavras.length > 0 && palavras.every(p => nome.includes(p));
    });

    if (!candidatos.length && palavras.length) {
      candidatos = pendentes.filter(r => {
        const nome = normalizarTexto(r.contratos?.inquilinos?.nome || "");
        return palavras.some(p => nome.split(" ").includes(p));
      });
    }

    // Remove duplicidades VISUAIS. Se dois registros diferentes do banco
    // representam a mesma cobrança para o usuário, mostramos apenas um.
    candidatos = Array.from(
      new Map(
        candidatos.map(r => {
          const nome = normalizarTexto(r.contratos?.inquilinos?.nome || "");
          const predio = normalizarTexto(r.contratos?.apartamentos?.predios?.nome || "");
          const apto = String(r.contratos?.apartamentos?.numero || "");
          const competencia = String(r.competencia || `${mes}-01`);
          const valor = Number(r.valor_previsto || 0).toFixed(2);

          const chaveVisual = [nome, predio, apto, competencia, valor].join("|");
          return [chaveVisual, r];
        })
      ).values()
    );

    if (!candidatos.length) {
      setErro(`Não encontrei cobrança pendente para "${nomeFalado}" em ${mes}.`);
      return;
    }

    if (candidatos.length === 1) {
      setModalRecebimento(candidatos[0]);
      return;
    }

    setCandidatosRecebimento(candidatos);
  }

  function iniciarVozRecebimento() {
    setErro("");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErro("O reconhecimento de voz não está disponível neste navegador. Use o Google Chrome.");
      return;
    }

    const reconhecimento = new SpeechRecognition();
    reconhecimento.lang = "pt-BR";
    reconhecimento.interimResults = false;
    reconhecimento.maxAlternatives = 1;
    reconhecimento.continuous = false;

    reconhecimento.onstart = () => setOuvindoRecebimento(true);
    reconhecimento.onend = () => setOuvindoRecebimento(false);
    reconhecimento.onerror = evento => {
      setOuvindoRecebimento(false);
      if (evento.error === "no-speech") setErro("Nenhuma fala foi detectada. Tente novamente.");
      else if (evento.error === "not-allowed" || evento.error === "service-not-allowed") setErro("Permita o uso do microfone no Chrome e tente novamente.");
      else setErro(`Não foi possível reconhecer a voz (${evento.error || "erro"}).`);
    };
    reconhecimento.onresult = evento => {
      const frase = evento.results?.[0]?.[0]?.transcript || "";
      setComandoRecebimento(frase);
      buscarRecebimentoRapido(frase);
    };

    try {
      reconhecimento.start();
    } catch (e) {
      setOuvindoRecebimento(false);
      setErro("Não foi possível iniciar o microfone.");
    }
  }

  async function confirmarRecebimentoRapido() {
    if (!modalRecebimento) return;
    setSalvandoRecebimento(true);
    setErro("");

    const valor = Number(modalRecebimento.valor_previsto || 0);
    const { error } = await supabase
      .from("recebimentos")
      .update({
        valor_recebido: valor,
        data_pagamento: hojeISO(),
        forma_pagamento: "pix",
        status: "pago",
        atualizado_em: new Date().toISOString()
      })
      .eq("id", modalRecebimento.id);

    setSalvandoRecebimento(false);

    if (error) {
      setErro(error.message);
      return;
    }

    setModalRecebimento(null);
    setCandidatosRecebimento([]);
    setComandoRecebimento("");
    await carregar();
  }

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

        <section className="quick-receipt">
          <div className="quick-receipt-title">
            <div>
              <h3>Acusar recebimento</h3>
              <p>Digite ou fale: “Recebi o aluguel de João Carlos”.</p>
            </div>
            <button
              type="button"
              className={`quick-mic ${ouvindoRecebimento ? "listening" : ""}`}
              onClick={iniciarVozRecebimento}
              title="Falar recebimento"
            >
              <span aria-hidden="true">🎙</span>
              {ouvindoRecebimento ? "Ouvindo..." : "Falar"}
            </button>
          </div>

          <div className="quick-receipt-form">
            <input
              type="text"
              value={comandoRecebimento}
              onChange={e => setComandoRecebimento(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") buscarRecebimentoRapido(comandoRecebimento);
              }}
              placeholder='Ex.: Recebi o aluguel de João Carlos'
            />
            <button
              type="button"
              className="quick-confirm"
              onClick={() => buscarRecebimentoRapido(comandoRecebimento)}
            >
              Localizar
            </button>
          </div>

          {candidatosRecebimento.length > 1 && (
            <div className="quick-candidates">
              <strong>Encontrei mais de uma cobrança. Selecione:</strong>
              {candidatosRecebimento.map(r => (
                <button type="button" key={r.id} onClick={() => setModalRecebimento(r)}>
                  <span>
                    <b>{r.contratos?.inquilinos?.nome || "Inquilino"}</b>
                    <small>
                      {r.contratos?.apartamentos?.predios?.nome || "Imóvel"} — Apto {r.contratos?.apartamentos?.numero || "-"}
                    </small>
                  </span>
                  <b>{dinheiro(r.valor_previsto)}</b>
                </button>
              ))}
            </div>
          )}
        </section>

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
            <span>Imóveis</span>
            <strong>{valorPrivado(predios.length)}</strong>
            <small>Ver imóveis →</small>
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
          <h3>Resumo mensal por imóvel</h3>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Imóvel</th>
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
                  <tr><td colSpan="7" className="empty-row">Nenhum imóvel cadastrado.</td></tr>
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
                                Nenhum apartamento cadastrado neste imóvel.
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
        {modalRecebimento && (
          <div className="quick-modal-backdrop" onMouseDown={() => setModalRecebimento(null)}>
            <div className="quick-modal" onMouseDown={e => e.stopPropagation()}>
              <div className="quick-modal-head">
                <div>
                  <h3>Confirmar recebimento</h3>
                  <p>Confira antes de dar baixa.</p>
                </div>
                <button type="button" onClick={() => setModalRecebimento(null)}>×</button>
              </div>
              <div className="quick-modal-body">
                <div><span>Inquilino</span><b>{modalRecebimento.contratos?.inquilinos?.nome || "-"}</b></div>
                <div><span>Imóvel</span><b>{modalRecebimento.contratos?.apartamentos?.predios?.nome || "-"}</b></div>
                <div><span>Apartamento</span><b>{modalRecebimento.contratos?.apartamentos?.numero || "-"}</b></div>
                <div><span>Competência</span><b>{mes}</b></div>
                <div><span>Valor</span><b>{dinheiro(modalRecebimento.valor_previsto)}</b></div>
                <div><span>Data do pagamento</span><b>{new Date().toLocaleDateString("pt-BR")}</b></div>
              </div>
              <div className="quick-modal-actions">
                <button type="button" className="secondary" onClick={() => setModalRecebimento(null)}>Cancelar</button>
                <button type="button" className="quick-confirm" disabled={salvandoRecebimento} onClick={confirmarRecebimentoRapido}>
                  {salvandoRecebimento ? "Salvando..." : "Confirmar e dar baixa"}
                </button>
              </div>
            </div>
          </div>
        )}

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

          :global(.quick-receipt){
            margin:16px 0 18px;
            padding:18px;
            border:1px solid #dbe7f3;
            border-radius:14px;
            background:#fff;
            box-shadow:0 5px 18px rgba(30,60,90,.06);
          }
          :global(.quick-receipt-title){display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
          :global(.quick-receipt-title h3){margin:0 0 4px;color:#173b5f}
          :global(.quick-receipt-title p){margin:0;color:#64748b;font-size:13px}
          :global(.quick-receipt-form){display:flex;gap:10px}
          :global(.quick-receipt-form input){flex:1;min-width:0;padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:14px}
          :global(.quick-confirm), :global(.quick-mic){border:0;border-radius:9px;padding:10px 15px;font-weight:700;cursor:pointer}
          :global(.quick-confirm){background:#1677d2;color:#fff}
          :global(.quick-mic){background:#eef6ff;color:#1769aa;border:1px solid #b9d9f5;display:flex;align-items:center;gap:7px}
          :global(.quick-mic.listening){background:#fff1f2;color:#be123c;border-color:#fecdd3}
          :global(.quick-candidates){display:grid;gap:8px;margin-top:14px}
          :global(.quick-candidates>button){display:flex;justify-content:space-between;align-items:center;text-align:left;padding:11px 12px;border:1px solid #dbe7f3;background:#fff;border-radius:9px;cursor:pointer}
          :global(.quick-candidates span){display:grid;gap:3px}
          :global(.quick-candidates small){color:#64748b}
          :global(.quick-modal-backdrop){position:fixed;inset:0;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:20px;z-index:9999}
          :global(.quick-modal){width:min(560px,100%);background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.22);overflow:hidden}
          :global(.quick-modal-head){display:flex;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid #e2e8f0}
          :global(.quick-modal-head h3){margin:0 0 3px;color:#173b5f}
          :global(.quick-modal-head p){margin:0;color:#64748b;font-size:13px}
          :global(.quick-modal-head>button){border:0;background:transparent;font-size:26px;color:#64748b;cursor:pointer}
          :global(.quick-modal-body){padding:16px 20px;display:grid;gap:9px}
          :global(.quick-modal-body>div){display:flex;justify-content:space-between;gap:20px;padding:8px 0;border-bottom:1px solid #f1f5f9}
          :global(.quick-modal-body span){color:#64748b}
          :global(.quick-modal-actions){display:flex;justify-content:flex-end;gap:10px;padding:14px 20px 18px}

        `}</style>

      </AppShell>
    </AuthGuard>
  );
}
