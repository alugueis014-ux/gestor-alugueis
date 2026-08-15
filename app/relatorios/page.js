"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

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

export default function Relatorios() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(String(anoAtual));
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

  async function carregar() {
    setCarregando(true);
    setErro("");

    const inicio = `${ano}-01-01`;
    const fim = `${ano}-12-31`;

    const [rec, pre] = await Promise.all([
      supabase
        .from("recebimentos")
        .select(`
          id,
          competencia,
          valor_previsto,
          valor_recebido,
          status,
          contratos(
            apartamentos(
              predio_id,
              predios(id,nome)
            )
          )
        `)
        .gte("competencia", inicio)
        .lte("competencia", fim),
      supabase
        .from("predios")
        .select("id,nome,endereco")
        .order("nome")
    ]);

    const falha = rec.error || pre.error;
    if (falha) setErro(falha.message);

    setRecebimentos(rec.data || []);
    setPredios(pre.data || []);
    setCarregando(false);
  }

  const totais = useMemo(() => {
    const previsto = recebimentos.reduce(
      (soma, r) => soma + numero(r.valor_previsto),
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
        (soma, r) => soma + numero(r.valor_previsto),
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

  const porPredio = useMemo(() => {
    return predios.map(predio => {
      const registros = recebimentos.filter(
        r => r.contratos?.apartamentos?.predio_id === predio.id
      );

      const previsto = registros.reduce(
        (soma, r) => soma + numero(r.valor_previsto),
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
      </AppShell>
    </AuthGuard>
  );
}
