"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { obterEmpresaId } from "../../lib/empresa";
import { assinarAtualizacoes, normalizarTransferenciasRecebimentos } from "../../lib/sincronizacao";

const meses = [
  ["01", "Janeiro"], ["02", "Fevereiro"], ["03", "Março"], ["04", "Abril"],
  ["05", "Maio"], ["06", "Junho"], ["07", "Julho"], ["08", "Agosto"],
  ["09", "Setembro"], ["10", "Outubro"], ["11", "Novembro"], ["12", "Dezembro"]
];

const formasPagamento = [
  ["pix", "PIX"],
  ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"],
  ["cartao", "Cartão"],
  ["boleto", "Boleto"],
  ["outro", "Outro"],
  ["nao_informado", "Não informado"]
];

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numero(valor) {
  return Number(valor || 0);
}

function dataBR(valor) {
  if (!valor) return "—";
  return new Date(`${valor}T12:00:00`).toLocaleDateString("pt-BR");
}

function normalizarFormaPagamento(valor) {
  const forma = String(valor || "").trim().toLowerCase();

  if (!forma) return "nao_informado";
  if (forma === "pix") return "pix";
  if (["dinheiro", "cash"].includes(forma)) return "dinheiro";
  if (["transferencia", "transferência", "ted", "doc"].includes(forma)) return "transferencia";
  if (["cartao", "cartão", "credito", "crédito", "debito", "débito"].includes(forma)) return "cartao";
  if (forma === "boleto") return "boleto";
  return "outro";
}


function estaPago(r) {
  const previsto = numero(r.valor_previsto) + numero(r.multa) + numero(r.juros) - numero(r.desconto);
  const recebido = numero(r.valor_recebido);

  return (
    String(r.status || "").toLowerCase() === "pago" ||
    (previsto > 0 && recebido >= previsto)
  );
}

function estaCancelado(r) {
  return String(r.status || "").toLowerCase() === "cancelado";
}

function estaAtrasado(r) {
  if (estaPago(r) || estaCancelado(r) || !r.data_vencimento) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  return r.data_vencimento < hoje;
}

function totalPrevisto(r) {
  if (estaCancelado(r)) return 0;
  return Math.max(
    0,
    numero(r.valor_previsto) +
      numero(r.multa) +
      numero(r.juros) -
      numero(r.desconto)
  );
}

export default function Relatorios() {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();

  const [ano, setAno] = useState(String(anoAtual));
  const [mesFiltro, setMesFiltro] = useState("todos");
  const [predioFiltro, setPredioFiltro] = useState("todos");
  const [formaFiltro, setFormaFiltro] = useState("todos");
  const [recebimentos, setRecebimentos] = useState([]);
  const [predios, setPredios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const anos = useMemo(() => {
    const lista = [];
    for (let a = anoAtual + 1; a >= anoAtual - 8; a--) lista.push(String(a));
    if (!lista.includes(ano)) lista.push(ano);
    return lista.sort((a, b) => Number(b) - Number(a));
  }, [ano, anoAtual]);

  useEffect(() => {
    carregar();
  }, [ano]);

  useEffect(() => {
    return assinarAtualizacoes(() => carregar());
  }, [ano]);

  async function carregar() {
    setCarregando(true);
    setErro("");

    try {
      const empresaId = await obterEmpresaId();
      const inicio = `${ano}-01-01`;
      const fim = `${ano}-12-31`;

      const [rec, pre] = await Promise.all([
        supabase
          .from("recebimentos")
          .select(`
            id,
            empresa_id,
            contrato_id,
            competencia,
            data_vencimento,
            valor_previsto,
            valor_recebido,
            multa,
            juros,
            desconto,
            status,
            forma_pagamento,
            data_pagamento,
            contratos!inner(
              id,
              empresa_id,
              inquilino_id,
              apartamento_id,
              status,
              data_inicio,
              data_fim,
              inquilinos(id,nome),
              apartamentos(
                id,
                numero,
                predio_id,
                predios(id,nome,endereco,imovel_principal_id)
              )
            )
          `)
          .eq("empresa_id", empresaId)
          .eq("contratos.empresa_id", empresaId)
          .gte("competencia", inicio)
          .lte("competencia", fim),

        // Mantém imóveis arquivados para preservar a leitura histórica.
        supabase
          .from("predios")
          .select("id,nome,endereco,arquivado,imovel_principal_id")
          .eq("empresa_id", empresaId)
          .order("nome")
      ]);

      const falha = rec.error || pre.error;
      if (falha) throw falha;

      /*
        Evita duplicidade histórica:
        contabiliza apenas um recebimento por apartamento + competência.
        Pago tem prioridade, depois contrato ativo, maior valor recebido
        e, por último, contrato mais recente.
      */
      const mapa = new Map();

      const pontuar = item => {
        const pago = estaPago(item) ? 1000000000 : 0;
        const ativo =
          String(item.contratos?.status || "").toLowerCase() === "ativo"
            ? 100000000
            : 0;
        const valorRecebido = numero(item.valor_recebido) * 1000;
        const inicioContrato =
          Number(String(item.contratos?.data_inicio || "").replace(/-/g, "")) || 0;

        return pago + ativo + valorRecebido + inicioContrato;
      };

      const normalizados = normalizarTransferenciasRecebimentos(rec.data || []);

      for (const item of normalizados) {
        const apartamentoId =
          item.contratos?.apartamento_id ||
          item.contratos?.apartamentos?.id ||
          item.id;

        const chave = `${apartamentoId}|${item.competencia}`;
        const atual = mapa.get(chave);

        if (!atual || pontuar(item) > pontuar(atual)) {
          mapa.set(chave, item);
        }
      }

      setRecebimentos(Array.from(mapa.values()));
      setPredios(pre.data || []);
    } catch (e) {
      setErro(e.message || "Não foi possível atualizar os relatórios.");
      setRecebimentos([]);
      setPredios([]);
    } finally {
      setCarregando(false);
    }
  }

  const gruposImoveis = useMemo(() => {
    const porId = new Map(predios.map(p => [p.id, p]));
    const grupos = new Map();

    for (const p of predios) {
      const raizId = p.imovel_principal_id || p.id;
      const principal = porId.get(raizId) || p;

      if (!grupos.has(raizId)) {
        grupos.set(raizId, {
          id: raizId,
          nome: principal.nome,
          endereco: principal.endereco || "",
          arquivado: !!principal.arquivado,
          entradas: []
        });
      }

      grupos.get(raizId).entradas.push(p);
    }

    return Array.from(grupos.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    );
  }, [predios]);

  function grupoIdDoRecebimento(r) {
    const p = r.contratos?.apartamentos?.predios;
    return p?.imovel_principal_id || p?.id || null;
  }

  const recebimentosDoPredio = useMemo(() => {
    if (predioFiltro === "todos") return recebimentos;

    return recebimentos.filter(
      r => grupoIdDoRecebimento(r) === predioFiltro
    );
  }, [recebimentos, predioFiltro]);

  const recebimentosPeriodo = useMemo(() => {
    if (mesFiltro === "todos") return recebimentosDoPredio;

    return recebimentosDoPredio.filter(
      r => r.competencia?.slice(5, 7) === mesFiltro
    );
  }, [recebimentosDoPredio, mesFiltro]);

  const recebimentosFinanceiros = useMemo(
    () => recebimentosPeriodo.filter(r => !estaCancelado(r)),
    [recebimentosPeriodo]
  );

  const totais = useMemo(() => {
    const previsto = recebimentosFinanceiros.reduce(
      (soma, r) => soma + totalPrevisto(r),
      0
    );
    const recebido = recebimentosFinanceiros.reduce(
      (soma, r) => soma + numero(r.valor_recebido),
      0
    );
    const pendente = Math.max(0, previsto - recebido);
    const taxa = previsto > 0 ? Math.min(100, (recebido / previsto) * 100) : 0;

    const cobrancas = recebimentosFinanceiros.length;
    const pagas = recebimentosFinanceiros.filter(estaPago).length;
    const atrasadas = recebimentosFinanceiros.filter(estaAtrasado).length;
    const abertas = Math.max(0, cobrancas - pagas);

    return {
      previsto,
      recebido,
      pendente,
      taxa,
      cobrancas,
      pagas,
      abertas,
      atrasadas
    };
  }, [recebimentosFinanceiros]);

  const resumoMensal = useMemo(() => {
    return meses.map(([id, nome]) => {
      const registros = recebimentosDoPredio.filter(
        r => r.competencia?.slice(5, 7) === id && !estaCancelado(r)
      );

      const previsto = registros.reduce((s, r) => s + totalPrevisto(r), 0);
      const recebido = registros.reduce((s, r) => s + numero(r.valor_recebido), 0);
      const pendente = Math.max(0, previsto - recebido);
      const taxa = previsto > 0 ? Math.min(100, (recebido / previsto) * 100) : 0;
      const pagas = registros.filter(estaPago).length;
      const atrasadas = registros.filter(estaAtrasado).length;

      return {
        id,
        nome,
        previsto,
        recebido,
        pendente,
        taxa,
        cobrancas: registros.length,
        pagas,
        atrasadas
      };
    });
  }, [recebimentosDoPredio]);

  const pagamentosPagos = useMemo(
    () =>
      recebimentosFinanceiros.filter(
        r => estaPago(r) && numero(r.valor_recebido) > 0
      ),
    [recebimentosFinanceiros]
  );

  const resumoFormasPagamento = useMemo(() => {
    const mapa = new Map(
      formasPagamento.map(([id, nome]) => [
        id,
        { id, nome, quantidade: 0, valor: 0, percentual: 0 }
      ])
    );

    for (const r of pagamentosPagos) {
      const id = normalizarFormaPagamento(r.forma_pagamento);
      const item = mapa.get(id) || mapa.get("outro");
      item.quantidade += 1;
      item.valor += numero(r.valor_recebido);
    }

    const total = Array.from(mapa.values()).reduce(
      (soma, item) => soma + item.valor,
      0
    );

    return Array.from(mapa.values())
      .map(item => ({
        ...item,
        percentual: total > 0 ? (item.valor / total) * 100 : 0
      }))
      .filter(item => item.quantidade > 0)
      .sort((a, b) => b.valor - a.valor);
  }, [pagamentosPagos]);


  const resumoPredios = useMemo(() => {
    return gruposImoveis
      .map(grupo => {
        const registros = recebimentosPeriodo.filter(
          r => grupoIdDoRecebimento(r) === grupo.id && !estaCancelado(r)
        );

        const previsto = registros.reduce((s, r) => s + totalPrevisto(r), 0);
        const recebido = registros.reduce((s, r) => s + numero(r.valor_recebido), 0);
        const pendente = Math.max(0, previsto - recebido);
        const taxa = previsto > 0 ? Math.min(100, (recebido / previsto) * 100) : 0;

        return {
          id: grupo.id,
          nome: grupo.nome,
          endereco: grupo.endereco,
          arquivado: grupo.arquivado,
          entradas: grupo.entradas,
          cobrancas: registros.length,
          previsto,
          recebido,
          pendente,
          taxa
        };
      })
      .filter(item => item.cobrancas > 0)
      .sort((a, b) => b.recebido - a.recebido);
  }, [gruposImoveis, recebimentosPeriodo]);

  const periodoLabel = useMemo(() => {
    if (mesFiltro === "todos") return `Ano de ${ano}`;
    const nome = meses.find(([id]) => id === mesFiltro)?.[1] || "";
    return `${nome} de ${ano}`;
  }, [ano, mesFiltro]);

  function selecionarMes(id) {
    setMesFiltro(atual => (atual === id ? "todos" : id));
    setFormaFiltro("todos");
  }

  function selecionarForma(id) {
    setFormaFiltro(atual => (atual === id ? "todos" : id));
  }

  function imprimir() {
    window.print();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="reports-header reports-header-v2">
          <div>
            <h2>Relatórios</h2>
            <p>Visão financeira dos aluguéis e recebimentos.</p>
          </div>

          <div className="reports-filters-v2">
            <label>
              Ano
              <select
                value={ano}
                onChange={e => {
                  setAno(e.target.value);
                  setMesFiltro("todos");
                  setFormaFiltro("todos");
                }}
              >
                {anos.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label>
              Período
              <select
                value={mesFiltro}
                onChange={e => {
                  setMesFiltro(e.target.value);
                  setFormaFiltro("todos");
                }}
              >
                <option value="todos">Ano inteiro</option>
                {meses.map(([id, nome]) => (
                  <option key={id} value={id}>{nome}</option>
                ))}
              </select>
            </label>

            <label>
              Imóvel
              <select
                value={predioFiltro}
                onChange={e => {
                  setPredioFiltro(e.target.value);
                  setFormaFiltro("todos");
                }}
              >
                <option value="todos">Todos os imóveis</option>
                {gruposImoveis.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nome}{p.arquivado ? " (arquivado)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="secondary reports-print" onClick={imprimir}>
              Imprimir / PDF
            </button>
          </div>
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="reports-period-line">
          <strong>{periodoLabel}</strong>
          {predioFiltro !== "todos" && (
            <span>
              {gruposImoveis.find(p => p.id === predioFiltro)?.nome || ""}
            </span>
          )}
        </div>

        <div className="reports-cards reports-cards-v2">
          <div className="reports-card reports-card-v2">
            <span>Previsto</span>
            <strong>{moeda(totais.previsto)}</strong>
            <small>{totais.cobrancas} cobrança(s)</small>
          </div>

          <div className="reports-card reports-card-v2">
            <span>Recebido</span>
            <strong>{moeda(totais.recebido)}</strong>
            <small>{totais.pagas} pagamento(s) quitado(s)</small>
          </div>

          <div className="reports-card reports-card-v2">
            <span>Em aberto</span>
            <strong>{moeda(totais.pendente)}</strong>
            <small>
              {totais.abertas} em aberto · {totais.atrasadas} atrasada(s)
            </small>
          </div>

          <div className="reports-card reports-card-v2">
            <span>Taxa de recebimento</span>
            <strong>{totais.taxa.toFixed(1)}%</strong>
            <div className="reports-progress">
              <span style={{ width: `${totais.taxa}%` }} />
            </div>
          </div>
        </div>

        <section className="reports-section">
          <div className="reports-section-head">
            <div>
              <h3>Resumo mensal</h3>
              <p>Clique em um mês para filtrar todo o relatório.</p>
            </div>
            {mesFiltro !== "todos" && (
              <button type="button" className="reports-clear" onClick={() => selecionarMes(mesFiltro)}>
                Mostrar ano inteiro
              </button>
            )}
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table reports-month-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Cobranças</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Em aberto</th>
                  <th>Atrasadas</th>
                  <th>Taxa</th>
                </tr>
              </thead>
              <tbody>
                {resumoMensal.map(item => (
                  <tr
                    key={item.id}
                    className={mesFiltro === item.id ? "reports-row-active" : ""}
                    onClick={() => selecionarMes(item.id)}
                  >
                    <td><strong>{item.nome}</strong></td>
                    <td>{item.cobrancas}</td>
                    <td>{moeda(item.previsto)}</td>
                    <td>{moeda(item.recebido)}</td>
                    <td>{moeda(item.pendente)}</td>
                    <td>{item.atrasadas}</td>
                    <td>
                      <div className="reports-rate-cell">
                        <span>{item.taxa.toFixed(1)}%</span>
                        <div><i style={{ width: `${item.taxa}%` }} /></div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="reports-section">
          <div className="reports-section-head">
            <div>
              <h3>Por imóvel</h3>
              <p>Desempenho financeiro no período selecionado.</p>
            </div>
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Cobranças</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Em aberto</th>
                  <th>Taxa</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr>
                    <td colSpan="6" className="reports-empty">Carregando...</td>
                  </tr>
                )}

                {!carregando && resumoPredios.map(item => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.nome}</strong>
                      {item.endereco && <small className="reports-address">{item.endereco}</small>}
                      {item.entradas?.length > 1 && (
                        <small className="reports-address">
                          {item.entradas.length} entradas/cadastros vinculados
                        </small>
                      )}
                      {item.arquivado && <small className="reports-archived">Arquivado</small>}
                    </td>
                    <td>{item.cobrancas}</td>
                    <td>{moeda(item.previsto)}</td>
                    <td>{moeda(item.recebido)}</td>
                    <td>{moeda(item.pendente)}</td>
                    <td>{item.taxa.toFixed(1)}%</td>
                  </tr>
                ))}

                {!carregando && resumoPredios.length === 0 && (
                  <tr>
                    <td colSpan="6" className="reports-empty">
                      Nenhuma movimentação encontrada neste período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="reports-section reports-payment-section">
          <div className="reports-section-head">
            <div>
              <h3>Formas de pagamento</h3>
              <p>Somente formas utilizadas no período aparecem aqui.</p>
            </div>
            {formaFiltro !== "todos" && (
              <button type="button" className="reports-clear" onClick={() => setFormaFiltro("todos")}>
                Limpar filtro
              </button>
            )}
          </div>

          {resumoFormasPagamento.length > 0 ? (
            <div className="payment-method-cards payment-method-cards-v2">
              {resumoFormasPagamento.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`payment-method-card ${
                    formaFiltro === item.id ? "active" : ""
                  }`}
                  onClick={() => selecionarForma(item.id)}
                >
                  <span>{item.nome}</span>
                  <strong>{moeda(item.valor)}</strong>
                  <small>{item.quantidade} pagamento(s)</small>
                  <div className="payment-percent-track">
                    <i style={{ width: `${item.percentual}%` }} />
                  </div>
                  <em>{item.percentual.toFixed(1)}% do recebido</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="reports-empty reports-empty-box">
              Nenhum pagamento recebido neste período.
            </div>
          )}

        </section>

        <style jsx>{`
          .reports-header-v2 {
            align-items: flex-end;
            gap: 18px;
            margin-bottom: 8px;
          }

          .reports-header-v2 > div:first-child h2 {
            margin: 0;
          }

          .reports-header-v2 > div:first-child p {
            margin: 4px 0 0;
            color: #64748b;
            font-size: 13px;
          }

          .reports-filters-v2 {
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: wrap;
          }

          .reports-filters-v2 label {
            display: grid;
            gap: 4px;
            color: #64748b;
            font-size: 11px;
            font-weight: 800;
          }

          .reports-filters-v2 select {
            min-width: 130px;
            height: 38px;
            padding: 0 10px;
            border: 1px solid #cbd5e1;
            border-radius: 9px;
            background: #fff;
            color: #173b5f;
            font-weight: 700;
          }

          .reports-filters-v2 label:nth-child(3) select {
            min-width: 210px;
          }

          .reports-print {
            height: 38px;
            white-space: nowrap;
          }

          .reports-period-line {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 8px 0 14px;
            color: #64748b;
            font-size: 12px;
          }

          .reports-period-line strong {
            color: #173b5f;
          }

          .reports-period-line span::before {
            content: "•";
            margin-right: 10px;
            color: #94a3b8;
          }

          .reports-cards-v2 {
            margin-bottom: 18px;
          }

          .reports-card-v2 {
            min-height: 112px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          .reports-card-v2 span {
            color: #64748b;
            font-size: 12px;
            font-weight: 800;
          }

          .reports-card-v2 strong {
            margin-top: 4px;
            font-size: 24px;
            color: #173b5f;
          }

          .reports-card-v2 small {
            margin-top: 6px;
            color: #64748b;
            font-size: 11px;
          }

          .reports-progress {
            height: 7px;
            margin-top: 10px;
            overflow: hidden;
            border-radius: 999px;
            background: #e7eef5;
          }

          .reports-progress span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: #1976d2;
          }

          .reports-section {
            margin-bottom: 18px;
          }

          .reports-section-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 12px;
            margin-bottom: 12px;
          }

          .reports-section-head h3 {
            margin: 0;
          }

          .reports-section-head p {
            margin: 4px 0 0;
            color: #64748b;
            font-size: 12px;
          }

          .reports-clear {
            border: 0;
            background: transparent;
            color: #1976d2;
            font-weight: 800;
            cursor: pointer;
          }

          .reports-month-table tbody tr {
            cursor: pointer;
            transition: background .12s ease;
          }

          .reports-month-table tbody tr:hover,
          .reports-row-active {
            background: #eff7ff;
          }

          .reports-rate-cell {
            min-width: 118px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .reports-rate-cell > span {
            width: 48px;
            font-weight: 800;
          }

          .reports-rate-cell > div {
            flex: 1;
            height: 6px;
            overflow: hidden;
            border-radius: 999px;
            background: #e7eef5;
          }

          .reports-rate-cell i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: #1976d2;
          }

          .reports-address,
          .reports-archived {
            display: block;
            margin-top: 3px;
            color: #64748b;
            font-size: 11px;
            font-weight: 400;
          }

          .reports-archived {
            color: #b45309;
            font-weight: 800;
          }

          .payment-method-cards-v2 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
          }

          .payment-method-card {
            min-height: 124px;
            padding: 14px;
            border: 1px solid #dbe6f1;
            border-radius: 12px;
            background: #fff;
            color: #173b5f;
            text-align: left;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: center;
            transition: .15s ease;
          }

          .payment-method-card:hover {
            transform: translateY(-1px);
            border-color: #8fc2ef;
            box-shadow: 0 5px 14px rgba(23, 59, 95, .06);
          }

          .payment-method-card.active {
            border-color: #1976d2;
            background: #eff7ff;
            box-shadow: 0 0 0 3px rgba(25, 118, 210, .10);
          }

          .payment-method-card span {
            color: #64748b;
            font-size: 12px;
            font-weight: 800;
          }

          .payment-method-card strong {
            margin-top: 4px;
            font-size: 20px;
          }

          .payment-method-card small,
          .payment-method-card em {
            margin-top: 3px;
            color: #64748b;
            font-size: 11px;
            font-style: normal;
          }

          .payment-percent-track {
            height: 6px;
            margin-top: 9px;
            overflow: hidden;
            border-radius: 999px;
            background: #e7eef5;
          }

          .payment-percent-track i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: #1976d2;
          }


          .reports-empty-box {
            padding: 18px;
            margin-bottom: 18px;
            border: 1px dashed #cbd5e1;
            border-radius: 10px;
            text-align: center;
          }

          @media print {
            .reports-filters-v2,
            .reports-clear,
            .reports-print {
              display: none !important;
            }

            .reports-header-v2 {
              margin-bottom: 14px;
            }

            .reports-section,
            .reports-card {
              break-inside: avoid;
            }

            .reports-table {
              font-size: 10px;
            }

            .payment-method-card {
              min-height: 90px;
            }
          }

          @media (max-width: 900px) {
            .reports-header-v2 {
              align-items: stretch;
              flex-direction: column;
            }

            .reports-filters-v2 {
              justify-content: flex-start;
            }

            .reports-filters-v2 label,
            .reports-filters-v2 select {
              flex: 1;
            }
          }

          @media (max-width: 640px) {
            .reports-filters-v2 {
              display: grid;
              grid-template-columns: 1fr 1fr;
            }

            .reports-filters-v2 label:nth-child(3),
            .reports-print {
              grid-column: 1 / -1;
            }

            .reports-filters-v2 select,
            .reports-filters-v2 label:nth-child(3) select {
              width: 100%;
              min-width: 0;
            }

            .reports-section-head {
              align-items: flex-start;
              flex-direction: column;
            }

            .payment-method-cards-v2 {
              grid-template-columns: 1fr 1fr;
            }
          }
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
