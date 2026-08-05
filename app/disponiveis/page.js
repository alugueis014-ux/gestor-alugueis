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

  const totais = useMemo(() => ({
    disponivel: apartamentos.filter(a => a.situacao === "disponivel").length,
    reservado: apartamentos.filter(a => a.situacao === "reservado").length,
    manutencao: apartamentos.filter(a => a.situacao === "manutencao").length
  }), [apartamentos]);

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

  return (
    <AuthGuard>
      <AppShell>
        <div className="available-header">
          <h2>Disponíveis para Aluguel</h2>
          <p>Apartamentos livres e prontos para receber novo inquilino</p>
        </div>

        {erro && <div className="error">{erro}</div>}

        <div className="available-cards">
          <div className="available-card">
            <span>Total disponível</span>
            <strong>{totais.disponivel}</strong>
          </div>
          <div className="available-card">
            <span>Reservados</span>
            <strong>{totais.reservado}</strong>
          </div>
          <div className="available-card">
            <span>Em manutenção</span>
            <strong>{totais.manutencao}</strong>
          </div>
        </div>

        <div className="available-filters">
          <select value={predio} onChange={e => setPredio(e.target.value)}>
            <option value="">Todos os prédios</option>
            {predios.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>

          <select value={situacao} onChange={e => setSituacao(e.target.value)}>
            <option value="">Todas as situações</option>
            <option value="disponivel">Disponíveis</option>
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
        ) : filtrados.length === 0 ? (
          <div className="available-empty">Nenhum apartamento encontrado com os filtros selecionados.</div>
        ) : (
          <div className="available-list">
            {filtrados.map(a => (
              <article className="available-unit" key={a.id}>
                <div>
                  <span className={`status-pill ${a.situacao}`}>{rotulos[a.situacao] || a.situacao}</span>
                  <h3>Apartamento {a.numero}</h3>
                  <p>{a.predios?.nome || "Prédio não informado"}</p>
                  {a.observacoes && <small>{a.observacoes}</small>}
                </div>
                <a className="primary available-action" href="/inquilinos">Cadastrar inquilino</a>
              </article>
            ))}
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
