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
