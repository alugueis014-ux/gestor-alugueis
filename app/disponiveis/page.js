"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

const rotulos = {
  disponivel: "Disponível",
  reservado: "Reservado",
  manutencao: "Em manutenção",
  ocupado: "Ocupado"
};

export default function Disponiveis() {
  const [predios, setPredios] = useState([]);
  const [apartamentos, setApartamentos] = useState([]);
  const [predio, setPredio] = useState("");
  const [situacao, setSituacao] = useState("disponivel");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");

    const [p, a] = await Promise.all([
      supabase.from("predios").select("id,nome").order("nome"),
      supabase
        .from("apartamentos")
        .select("id,numero,situacao,observacoes,predio_id,predios(nome)")
        .order("numero")
    ]);

    const falha = p.error || a.error;
    if (falha) setErro(falha.message);

    setPredios(p.data || []);
    setApartamentos(a.data || []);
    setCarregando(false);
  }

  const totalDisponivel = useMemo(
    () => apartamentos.filter(a => a.situacao === "disponivel").length,
    [apartamentos]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return apartamentos.filter(a => {
      const correspondePredio = !predio || a.predio_id === predio;
      const correspondeSituacao = !situacao || a.situacao === situacao;
      const texto = `${a.numero || ""} ${a.predios?.nome || ""} ${a.observacoes || ""}`.toLowerCase();
      const correspondeBusca = !termo || texto.includes(termo);
      return correspondePredio && correspondeSituacao && correspondeBusca;
    });
  }, [apartamentos, predio, situacao, busca]);

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
            nome: a.predios?.nome || "Prédio não informado"
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
            <option value="">Todos os prédios</option>
            {predios.map(p => (
              <option key={p.id} value={p.id}>{p.nome}</option>
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
                  <h3 style={{ margin: 0, fontSize: 21 }}>{p.nome}</h3>

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
                        <span className={`status-pill ${a.situacao}`}>
                          {rotulos[a.situacao] || a.situacao}
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
