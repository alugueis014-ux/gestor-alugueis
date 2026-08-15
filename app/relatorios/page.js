"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { obterEmpresaId } from "../../lib/empresa";
import { assinarAtualizacoes, normalizarTransferenciasRecebimentos, notificarAtualizacao } from "../../lib/sincronizacao";

const meses = [
  ["01", "Jan"], ["02", "Fev"], ["03", "Mar"], ["04", "Abr"],
  ["05", "Mai"], ["06", "Jun"], ["07", "Jul"], ["08", "Ago"],
  ["09", "Set"], ["10", "Out"], ["11", "Nov"], ["12", "Dez"]
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


const formasPagamento = [
  ["pix", "PIX"],
  ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"],
  ["cartao", "Cartão"],
  ["boleto", "Boleto"],
  ["outro", "Outro"],
  ["nao_informado", "Não informado"]
];

function normalizarFormaPagamento(valor) {
  const forma = String(valor || "").trim().toLowerCase();

  if (!forma) return "nao_informado";
  if (["pix"].includes(forma)) return "pix";
  if (["dinheiro", "cash"].includes(forma)) return "dinheiro";
  if (["transferencia", "transferência", "ted", "doc"].includes(forma)) {
    return "transferencia";
  }
  if (["cartao", "cartão", "credito", "crédito", "debito", "débito"].includes(forma)) {
    return "cartao";
  }
  if (["boleto"].includes(forma)) return "boleto";

  return "outro";
}

function rotuloFormaPagamento(valor) {
  const chave = normalizarFormaPagamento(valor);
  return formasPagamento.find(([id]) => id === chave)?.[1] || "Outro";
}

export default function Relatorios() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(String(anoAtual));
  const [recebimentos, setRecebimentos] = useState([]);
  const [predios, setPredios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mesPagamento, setMesPagamento] = useState("todos");
  const [filtroFormaPagamento, setFiltroFormaPagamento] = useState("todos");

  const anos = useMemo(() => {
    const lista = [];
    for (let a = anoAtual + 1; a >= anoAtual - 8; a--) lista.push(String(a));
    if (!lista.includes(ano)) lista.push(ano);
    return lista.sort((a, b) => Number(b) - Number(a));
  }, [ano, anoAtual]);

  useEffect(() => {
    carregar();

    const atualizarAoVoltar = () => {
      if (document.visibilityState === "visible") carregar();
    };

    window.addEventListener("focus", carregar);
    document.addEventListener("visibilitychange", atualizarAoVoltar);

    return () => {
      window.removeEventListener("focus", carregar);
      document.removeEventListener("visibilitychange", atualizarAoVoltar);
    };
  }, [ano]);

  useEffect(() => {
    return assinarAtualizacoes(() => {
      carregar();
    });
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
                predio_id,
                predios(id,nome,endereco)
              )
            )
          `)
          .eq("empresa_id", empresaId)
          .eq("contratos.empresa_id", empresaId)
          .gte("competencia", inicio)
          .lte("competencia", fim),

        // Relatórios históricos também precisam conhecer imóveis arquivados.
        supabase
          .from("predios")
          .select("id,nome,endereco,arquivado")
          .eq("empresa_id", empresaId)
          .order("nome")
      ]);

      const falha = rec.error || pre.error;
      if (falha) throw falha;

      /*
        Fonte única do relatório:
        para cada apartamento + competência deve existir apenas UMA cobrança
        contabilizada, mesmo que registros antigos duplicados ainda estejam no banco.

        Prioridade:
        1. registro pago / totalmente recebido;
        2. contrato ativo;
        3. maior valor recebido;
        4. contrato mais recente.
      */
      const mapa = new Map();

      const pontuar = item => {
        const previsto = numero(item.valor_previsto);
        const recebido = numero(item.valor_recebido);
        const status = String(item.status || "").toLowerCase();

        const pago =
          status === "pago" || (previsto > 0 && recebido >= previsto)
            ? 1000000000
            : 0;

        const ativo =
          String(item.contratos?.status || "").toLowerCase() === "ativo"
            ? 100000000
            : 0;

        const valorRecebido = recebido * 1000;
        const inicioContrato =
          Number(String(item.contratos?.data_inicio || "").replace(/-/g, "")) || 0;

        return pago + ativo + valorRecebido + inicioContrato;
      };

      const dadosNormalizados = normalizarTransferenciasRecebimentos(rec.data || []);

      for (const item of dadosNormalizados) {
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

  const totais = useMemo(() => {
    const previsto = recebimentos.reduce(
      (soma, r) =>
        soma +
        numero(r.valor_previsto) +
        numero(r.multa) +
        numero(r.juros) -
        numero(r.desconto),
      0
    );
    const recebido = recebimentos.reduce(
      (soma, r) => soma + numero(r.valor_recebido),
      0
    );
    const pendente = Math.max(0, previsto - recebido);
    const taxa = previsto > 0 ? (recebido / previsto) * 100 : 0;

    return { previsto, recebido, pendente, taxa };
  }, [recebimentos]);

  const porMes = useMemo(() => {
    return meses.map(([numeroMes, nome]) => {
      const registros = recebimentos.filter(
        r => r.competencia?.slice(5, 7) === numeroMes
      );

      const previsto = registros.reduce(
        (soma, r) =>
          soma +
          numero(r.valor_previsto) +
          numero(r.multa) +
          numero(r.juros) -
          numero(r.desconto),
        0
      );
      const recebido = registros.reduce(
        (soma, r) => soma + numero(r.valor_recebido),
        0
      );
      const pendente = Math.max(0, previsto - recebido);
      const taxa = previsto > 0 ? (recebido / previsto) * 100 : 0;

      return { nome, previsto, recebido, pendente, taxa };
    });
  }, [recebimentos]);

  const recebimentosPagos = useMemo(() => {
    return recebimentos.filter((r) => {
      const valorRecebido = numero(r.valor_recebido);
      const status = String(r.status || "").toLowerCase();
      const quitado =
        status === "pago" ||
        (
          numero(r.valor_previsto) > 0 &&
          valorRecebido >= numero(r.valor_previsto)
        );

      if (!quitado || valorRecebido <= 0) return false;

      if (
        mesPagamento !== "todos" &&
        r.competencia?.slice(5, 7) !== mesPagamento
      ) {
        return false;
      }

      return true;
    });
  }, [recebimentos, mesPagamento]);

  const resumoFormasPagamento = useMemo(() => {
    const mapa = new Map(
      formasPagamento.map(([id, nome]) => [
        id,
        { id, nome, quantidade: 0, valor: 0, percentual: 0 }
      ])
    );

    for (const r of recebimentosPagos) {
      const id = normalizarFormaPagamento(r.forma_pagamento);
      const item = mapa.get(id) || mapa.get("outro");

      item.quantidade += 1;
      item.valor += numero(r.valor_recebido);
    }

    const total = Array.from(mapa.values()).reduce(
      (soma, item) => soma + item.valor,
      0
    );

    return Array.from(mapa.values()).map((item) => ({
      ...item,
      percentual: total > 0 ? (item.valor / total) * 100 : 0
    }));
  }, [recebimentosPagos]);

  const totalFormasPagamento = useMemo(() => {
    return resumoFormasPagamento.reduce(
      (acc, item) => ({
        quantidade: acc.quantidade + item.quantidade,
        valor: acc.valor + item.valor
      }),
      { quantidade: 0, valor: 0 }
    );
  }, [resumoFormasPagamento]);

  const detalhesFormaPagamento = useMemo(() => {
    return recebimentosPagos
      .filter((r) => {
        if (filtroFormaPagamento === "todos") return true;
        return normalizarFormaPagamento(r.forma_pagamento) === filtroFormaPagamento;
      })
      .sort((a, b) =>
        String(b.data_pagamento || b.competencia || "").localeCompare(
          String(a.data_pagamento || a.competencia || "")
        )
      );
  }, [recebimentosPagos, filtroFormaPagamento]);

  function alternarFiltroFormaPagamento(id) {
    setFiltroFormaPagamento((atual) => atual === id ? "todos" : id);
  }

  const porPredio = useMemo(() => {
    return predios.map(predio => {
      const registros = recebimentos.filter(
        r => r.contratos?.apartamentos?.predio_id === predio.id
      );

      const previsto = registros.reduce(
        (soma, r) =>
          soma +
          numero(r.valor_previsto) +
          numero(r.multa) +
          numero(r.juros) -
          numero(r.desconto),
        0
      );
      const recebido = registros.reduce(
        (soma, r) => soma + numero(r.valor_recebido),
        0
      );
      const pendente = Math.max(0, previsto - recebido);
      const taxa = previsto > 0 ? (recebido / previsto) * 100 : 0;

      return {
        id: predio.id,
        nome: predio.nome,
        endereco: predio.endereco || "",
        previsto,
        recebido,
        pendente,
        taxa
      };
    });
  }, [predios, recebimentos]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="reports-header">
          <h2>Relatórios</h2>

          <select value={ano} onChange={e => setAno(e.target.value)}>
            {anos.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="reports-cards">
          <div className="reports-card">
            <span>Previsto no ano</span>
            <strong>{moeda(totais.previsto)}</strong>
          </div>

          <div className="reports-card">
            <span>Recebido no ano</span>
            <strong>{moeda(totais.recebido)}</strong>
          </div>

          <div className="reports-card">
            <span>Pendente no ano</span>
            <strong>{moeda(totais.pendente)}</strong>
          </div>

          <div className="reports-card">
            <span>Taxa anual</span>
            <strong>{totais.taxa.toFixed(1)}%</strong>
          </div>
        </div>

        <section className="reports-section reports-payment-section">
          <div className="reports-payment-heading">
            <div>
              <h3>Formas de pagamento</h3>
              <p>Veja como os aluguéis recebidos foram pagos.</p>
            </div>

            <select
              value={mesPagamento}
              onChange={(e) => {
                setMesPagamento(e.target.value);
                setFiltroFormaPagamento("todos");
              }}
            >
              <option value="todos">Ano inteiro</option>
              {meses.map(([numeroMes, nome]) => (
                <option key={numeroMes} value={numeroMes}>
                  {nome}/{ano}
                </option>
              ))}
            </select>
          </div>

          <div className="payment-method-cards">
            {resumoFormasPagamento.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`payment-method-card ${
                  filtroFormaPagamento === item.id ? "active" : ""
                }`}
                onClick={() => alternarFiltroFormaPagamento(item.id)}
              >
                <span>{item.nome}</span>
                <strong>{item.quantidade}</strong>
                <small>{moeda(item.valor)}</small>
                <em>{item.percentual.toFixed(1)}% do recebido</em>
              </button>
            ))}
          </div>

          <div className="payment-summary-line">
            <div>
              <span>Pagamentos no período</span>
              <strong>{totalFormasPagamento.quantidade}</strong>
            </div>
            <div>
              <span>Total recebido</span>
              <strong>{moeda(totalFormasPagamento.valor)}</strong>
            </div>

            {filtroFormaPagamento !== "todos" && (
              <button
                type="button"
                onClick={() => setFiltroFormaPagamento("todos")}
              >
                Mostrar todas as formas
              </button>
            )}
          </div>

          <div className="payment-distribution">
            <h4>Distribuição</h4>

            {resumoFormasPagamento
              .filter((item) => item.quantidade > 0)
              .map((item) => (
                <div className="payment-bar-row" key={item.id}>
                  <div className="payment-bar-label">
                    <span>{item.nome}</span>
                    <b>{item.percentual.toFixed(1)}%</b>
                  </div>
                  <div className="payment-bar-track">
                    <div
                      className="payment-bar-fill"
                      style={{ width: `${Math.max(item.percentual, 1)}%` }}
                    />
                  </div>
                  <small>{moeda(item.valor)}</small>
                </div>
              ))}

            {totalFormasPagamento.quantidade === 0 && (
              <div className="reports-empty">
                Nenhum pagamento registrado neste período.
              </div>
            )}
          </div>

          <div className="reports-table-wrap payment-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Forma</th>
                  <th>Quantidade</th>
                  <th>Valor recebido</th>
                  <th>% do recebido</th>
                </tr>
              </thead>
              <tbody>
                {resumoFormasPagamento
                  .filter((item) => item.quantidade > 0)
                  .map((item) => (
                    <tr
                      key={item.id}
                      className={
                        filtroFormaPagamento === item.id
                          ? "payment-table-selected"
                          : ""
                      }
                      onClick={() => alternarFiltroFormaPagamento(item.id)}
                    >
                      <td>{item.nome}</td>
                      <td>{item.quantidade}</td>
                      <td>{moeda(item.valor)}</td>
                      <td>{item.percentual.toFixed(1)}%</td>
                    </tr>
                  ))}

                {totalFormasPagamento.quantidade === 0 && (
                  <tr>
                    <td colSpan="4" className="reports-empty">
                      Nenhum pagamento registrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="payment-details">
            <h4>
              {filtroFormaPagamento === "todos"
                ? "Pagamentos recebidos"
                : `Pagamentos por ${
                    resumoFormasPagamento.find(
                      (item) => item.id === filtroFormaPagamento
                    )?.nome || ""
                  }`}
            </h4>

            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Inquilino</th>
                    <th>Imóvel</th>
                    <th>Apto</th>
                    <th>Forma</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhesFormaPagamento.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.data_pagamento
                          ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td>{r.contratos?.inquilinos?.nome || "—"}</td>
                      <td>{r.contratos?.apartamentos?.predios?.nome || "—"}</td>
                      <td>{r.contratos?.apartamentos?.numero || "—"}</td>
                      <td>{rotuloFormaPagamento(r.forma_pagamento)}</td>
                      <td>{moeda(r.valor_recebido)}</td>
                    </tr>
                  ))}

                  {detalhesFormaPagamento.length === 0 && (
                    <tr>
                      <td colSpan="6" className="reports-empty">
                        Nenhum pagamento encontrado neste filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="reports-section">
          <h3>Por mês</h3>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Pendente</th>
                  <th>Taxa</th>
                </tr>
              </thead>

              <tbody>
                {porMes.map(item => (
                  <tr key={item.nome}>
                    <td>{item.nome}</td>
                    <td>{moeda(item.previsto)}</td>
                    <td>{moeda(item.recebido)}</td>
                    <td>{moeda(item.pendente)}</td>
                    <td>{item.taxa.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="reports-section reports-building-section">
          <h3>Por imóvel</h3>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Endereço</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Pendente</th>
                  <th>Taxa</th>
                </tr>
              </thead>

              <tbody>
                {carregando && (
                  <tr>
                    <td colSpan="6" className="reports-empty">Carregando...</td>
                  </tr>
                )}

                {!carregando && porPredio.length === 0 && (
                  <tr>
                    <td colSpan="6" className="reports-empty">
                      Nenhum imóvel cadastrado.
                    </td>
                  </tr>
                )}

                {!carregando && porPredio.map(item => (
                  <tr key={item.id}>
                    <td>{item.nome}</td>
                    <td>{item.endereco || "—"}</td>
                    <td>{moeda(item.previsto)}</td>
                    <td>{moeda(item.recebido)}</td>
                    <td>{moeda(item.pendente)}</td>
                    <td>{item.taxa.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <style jsx>{`
          .reports-payment-heading {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 16px;
            margin-bottom: 16px;
          }

          .reports-payment-heading h3 {
            margin: 0;
          }

          .reports-payment-heading p {
            margin: 4px 0 0;
            color: #64748b;
            font-size: 13px;
          }

          .reports-payment-heading select {
            min-width: 145px;
            min-height: 40px;
            padding: 8px 10px;
            border: 1px solid #cbd5e1;
            border-radius: 9px;
            background: #fff;
            color: #173b5f;
            font-weight: 700;
          }

          .payment-method-cards {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 14px;
          }

          .payment-method-card {
            min-height: 112px;
            padding: 14px 16px;
            border: 1px solid #dbe6f1;
            border-radius: 12px;
            background: #fff;
            color: #173b5f;
            text-align: left;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 3px;
            transition: .15s ease;
          }

          .payment-method-card:hover {
            transform: translateY(-1px);
            border-color: #8fc2ef;
          }

          .payment-method-card.active {
            border-color: #1976d2;
            background: #eff7ff;
            box-shadow: 0 0 0 3px rgba(25,118,210,.10);
          }

          .payment-method-card span {
            font-size: 12px;
            color: #64748b;
            font-weight: 800;
          }

          .payment-method-card strong {
            font-size: 24px;
            line-height: 1.05;
          }

          .payment-method-card small {
            font-size: 13px;
            font-weight: 800;
          }

          .payment-method-card em {
            margin-top: 4px;
            font-size: 11px;
            color: #64748b;
            font-style: normal;
          }

          .payment-summary-line {
            display: flex;
            align-items: center;
            gap: 28px;
            flex-wrap: wrap;
            padding: 14px 16px;
            margin-bottom: 16px;
            background: #f8fbfe;
            border: 1px solid #e1ebf5;
            border-radius: 10px;
          }

          .payment-summary-line div {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .payment-summary-line span {
            font-size: 11px;
            color: #64748b;
          }

          .payment-summary-line strong {
            font-size: 16px;
            color: #173b5f;
          }

          .payment-summary-line button {
            margin-left: auto;
            border: 0;
            background: transparent;
            color: #1976d2;
            font-weight: 800;
            cursor: pointer;
          }

          .payment-distribution {
            padding: 16px;
            margin-bottom: 16px;
            border: 1px solid #e1ebf5;
            border-radius: 12px;
            background: #fff;
          }

          .payment-distribution h4,
          .payment-details h4 {
            margin: 0 0 14px;
            color: #173b5f;
          }

          .payment-bar-row {
            display: grid;
            grid-template-columns: 120px minmax(140px, 1fr) 120px;
            align-items: center;
            gap: 12px;
            margin: 10px 0;
          }

          .payment-bar-label {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
            color: #475569;
          }

          .payment-bar-track {
            height: 10px;
            background: #eaf0f6;
            border-radius: 999px;
            overflow: hidden;
          }

          .payment-bar-fill {
            height: 100%;
            background: #1976d2;
            border-radius: inherit;
          }

          .payment-bar-row small {
            text-align: right;
            font-weight: 800;
            color: #173b5f;
          }

          .payment-table-wrap {
            margin-bottom: 18px;
          }

          .payment-table-wrap tbody tr {
            cursor: pointer;
          }

          .payment-table-selected {
            background: #eff7ff;
          }

          .payment-details {
            margin-top: 18px;
          }

          @media (max-width: 980px) {
            .payment-method-cards {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 640px) {
            .reports-payment-heading {
              align-items: stretch;
              flex-direction: column;
            }

            .reports-payment-heading select {
              width: 100%;
            }

            .payment-method-cards {
              grid-template-columns: 1fr 1fr;
              gap: 8px;
            }

            .payment-method-card {
              min-height: 98px;
              padding: 12px;
            }

            .payment-bar-row {
              grid-template-columns: 92px minmax(90px, 1fr);
            }

            .payment-bar-row small {
              grid-column: 2;
              text-align: left;
            }

            .payment-summary-line button {
              width: 100%;
              margin-left: 0;
              text-align: left;
            }
          }
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
