"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { obterEmpresaId } from "../../lib/empresa";
import { assinarAtualizacoes, notificarAtualizacao } from "../../lib/sincronizacao";

const rotulos = {
  disponivel: "Disponível",
  reservado: "Reservado",
  manutencao: "Em manutenção",
  ocupado: "Ocupado"
};

export default function Disponiveis() {
  const [predios, setPredios] = useState([]);
  const [apartamentos, setApartamentos] = useState([]);
  const [contratosAtivos, setContratosAtivos] = useState([]);
  const [predio, setPredio] = useState("");
  const [situacao, setSituacao] = useState("disponivel");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    return assinarAtualizacoes(() => {
      carregar();
    });
  }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");

    try {
      const empresaId = await obterEmpresaId();

      const [p, a, c] = await Promise.all([
        supabase
          .from("predios")
          .select("id,nome,endereco")
          .eq("empresa_id", empresaId)
          .eq("arquivado", false)
          .order("nome"),
        supabase
          .from("apartamentos")
          .select("id,numero,situacao,observacoes,predio_id,predios!inner(nome,endereco,arquivado)")
          .eq("empresa_id", empresaId)
          .eq("predios.arquivado", false)
          .order("numero"),
        supabase
          .from("contratos")
          .select("id,apartamento_id,status,data_inicio,data_fim")
          .eq("empresa_id", empresaId)
          .eq("status", "ativo")
      ]);

      const falha = p.error || a.error || c.error;
      if (falha) throw falha;

      setPredios(p.data || []);
      setApartamentos(a.data || []);
      setContratosAtivos(c.data || []);
    } catch (e) {
      setErro(e.message || "Não foi possível carregar os imóveis disponíveis.");
      setPredios([]);
      setApartamentos([]);
      setContratosAtivos([]);
    } finally {
      setCarregando(false);
    }
  }

  const apartamentosComSituacaoReal = useMemo(() => {
    const ocupados = new Set(
      contratosAtivos
        .filter(c => c.apartamento_id)
        .map(c => c.apartamento_id)
    );

    return apartamentos.map(a => {
      let situacaoReal = a.situacao;

      // Reserva e manutenção continuam respeitando o cadastro manual.
      // Nos demais casos, a ocupação é definida por contrato ativo.
      if (a.situacao !== "reservado" && a.situacao !== "manutencao") {
        situacaoReal = ocupados.has(a.id) ? "ocupado" : "disponivel";
      }

      return { ...a, situacaoReal };
    });
  }, [apartamentos, contratosAtivos]);

  const totalDisponivel = useMemo(
    () => apartamentosComSituacaoReal.filter(a => a.situacaoReal === "disponivel").length,
    [apartamentosComSituacaoReal]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return apartamentosComSituacaoReal.filter(a => {
      const correspondePredio = !predio || a.predio_id === predio;
      const correspondeSituacao = !situacao || a.situacaoReal === situacao;
      const texto = `${a.numero || ""} ${a.predios?.nome || ""} ${a.predios?.endereco || ""} ${a.observacoes || ""}`.toLowerCase();
      const correspondeBusca = !termo || texto.includes(termo);
      return correspondePredio && correspondeSituacao && correspondeBusca;
    });
  }, [apartamentosComSituacaoReal, predio, situacao, busca]);

  const porPredio = useMemo(() => {
    const grupos = new Map();

    predios.forEach(p => {
      grupos.set(p.id, { predio: p, apartamentos: [] });
    });

    filtrados.forEach(a => {
      if (!grupos.has(a.predio_id)) {
        grupos.set(a.predio_id, {
          predio: {
            id: a.predio_id,
            nome: a.predios?.nome || "Imóvel não informado",
            endereco: a.predios?.endereco || ""
          },
          apartamentos: []
        });
      }

      grupos.get(a.predio_id).apartamentos.push(a);
    });

    return Array.from(grupos.values()).filter(g => g.apartamentos.length > 0);
  }, [predios, filtrados]);

  return (
    <AuthGuard>
      <AppShell>
        <div
          className="available-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            flexWrap: "wrap"
          }}
        >
          <div>
            <h2>Disponíveis para Aluguel</h2>
            <p>Apartamentos livres e prontos para receber novo inquilino</p>
          </div>

          <div
            className="available-card"
            style={{
              minWidth: 190,
              margin: 0
            }}
          >
            <span>Total disponível</span>
            <strong>{totalDisponivel}</strong>
          </div>
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="available-filters">
          <select value={predio} onChange={e => setPredio(e.target.value)}>
            <option value="">Todos os imóveis</option>
            {predios.map(p => (
              <option key={p.id} value={p.id}>
                {p.nome}{p.endereco ? ` — ${p.endereco}` : ""}
              </option>
            ))}
          </select>

          <select value={situacao} onChange={e => setSituacao(e.target.value)}>
            <option value="disponivel">Disponíveis</option>
            <option value="">Todas as situações</option>
            <option value="reservado">Reservados</option>
            <option value="manutencao">Em manutenção</option>
          </select>

          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar apartamento"
          />
        </div>

        {carregando ? (
          <div className="available-empty">Carregando apartamentos...</div>
        ) : porPredio.length === 0 ? (
          <div className="available-empty">
            Nenhum apartamento encontrado com os filtros selecionados.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            {porPredio.map(({ predio: p, apartamentos: unidades }) => (
              <section
                className="panel"
                key={p.id}
                style={{
                  padding: 0,
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    padding: "18px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                    borderBottom: "1px solid #dbe5ef"
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: 21 }}>{p.nome}</h3>
                    {p.endereco && (
                      <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                        {p.endereco}
                      </div>
                    )}
                  </div>

                  <span
                    style={{
                      background: "#e7f0ff",
                      color: "#1456a0",
                      padding: "6px 10px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700
                    }}
                  >
                    {unidades.length} disponível(is)
                  </span>
                </div>

                <div
                  style={{
                    padding: 16,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 14
                  }}
                >
                  {unidades.map(a => (
                    <article
                      className="available-unit"
                      key={a.id}
                      style={{
                        margin: 0,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        justifyContent: "space-between",
                        gap: 14,
                        minHeight: 150
                      }}
                    >
                      <div>
                        <span className={`status-pill ${a.situacaoReal}`}>
                          {rotulos[a.situacaoReal] || a.situacaoReal}
                        </span>
                        <h3>Apartamento {a.numero}</h3>
                        {a.observacoes && <small>{a.observacoes}</small>}
                      </div>

                      <a
                        className="primary available-action"
                        href="/inquilinos"
                        style={{
                          width: 180,
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          alignSelf: "flex-start"
                        }}
                      >
                        Cadastrar inquilino
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
