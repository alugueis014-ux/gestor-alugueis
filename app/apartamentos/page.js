"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

export default function Apartamentos() {
  const [predios, setPredios] = useState([]);
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    predio_id: "",
    numero: "",
    situacao: "disponivel",
    observacoes: "",
  });

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setErro("");

    const [p, a] = await Promise.all([
      supabase.from("predios").select("id,nome,endereco").order("nome"),
      supabase
        .from("apartamentos")
        .select("*, predios(nome,endereco)")
        .order("numero"),
    ]);

    if (p.error) setErro(p.error.message);
    if (a.error) setErro(a.error.message);

    setPredios(p.data || []);
    setLista(a.data || []);

    if (!form.predio_id && p.data?.[0]) {
      setForm((f) => ({ ...f, predio_id: p.data[0].id }));
    }
  }

  async function salvar(e) {
    e.preventDefault();
    setErro("");

    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("apartamentos").insert({
      ...form,
      proprietario_id: u.user.id,
    });

    if (error) return setErro(error.message);

    setForm((f) => ({ ...f, numero: "", observacoes: "" }));
    carregar();
  }

  async function excluir(id) {
    if (!confirm("Excluir apartamento?")) return;

    const { error } = await supabase.from("apartamentos").delete().eq("id", id);
    if (error) return setErro(error.message);

    carregar();
  }

  const apartamentosPorPredio = useMemo(() => {
    const grupos = new Map();

    predios.forEach((predio) => {
      grupos.set(predio.id, { predio, apartamentos: [] });
    });

    lista.forEach((apartamento) => {
      if (!grupos.has(apartamento.predio_id)) {
        grupos.set(apartamento.predio_id, {
          predio: {
            id: apartamento.predio_id,
            nome: apartamento.predios?.nome || "Prédio não informado",
            endereco: apartamento.predios?.endereco || "",
          },
          apartamentos: [],
        });
      }
      grupos.get(apartamento.predio_id).apartamentos.push(apartamento);
    });

    return Array.from(grupos.values());
  }, [predios, lista]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="page-header">
          <h2>Apartamentos</h2>
          <p>Controle das unidades</p>
        </div>

        <form className="panel form-grid" onSubmit={salvar}>
          <label>
            Prédio
            <select
              value={form.predio_id}
              onChange={(e) => setForm({ ...form, predio_id: e.target.value })}
              required
            >
              {predios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            Apartamento
            <input
              value={form.numero}
              onChange={(e) => setForm({ ...form, numero: e.target.value })}
              required
            />
          </label>

          <label>
            Situação
            <select
              value={form.situacao}
              onChange={(e) => setForm({ ...form, situacao: e.target.value })}
            >
              <option value="disponivel">Disponível</option>
              <option value="reservado">Reservado</option>
              <option value="manutencao">Manutenção</option>
              <option value="ocupado">Ocupado</option>
            </select>
          </label>

          <label>
            Observações
            <input
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            />
          </label>

          {erro && <div className="error full">{erro}</div>}

          <div className="actions full">
            <button className="primary">Cadastrar apartamento</button>
          </div>
        </form>

        <div style={{ display: "grid", gap: 18 }}>
          {apartamentosPorPredio.map(({ predio, apartamentos }) => (
            <div className="panel table-wrap" key={predio.id}>
              <div style={{ marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 21 }}>
                  {predio.nome}{predio.endereco ? ` - ${predio.endereco}` : ""}
                </h3>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Apartamento</th>
                    <th>Situação</th>
                    <th>Observações</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {apartamentos.length > 0 ? (
                    apartamentos.map((a) => (
                      <tr key={a.id}>
                        <td>{`Apartamento ${a.numero}`}</td>
                        <td>
                          <span className={`badge ${a.situacao}`}>{a.situacao}</span>
                        </td>
                        <td>{a.observacoes || "—"}</td>
                        <td>
                          <button className="danger" onClick={() => excluir(a.id)}>
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" style={{ color: "#64748b" }}>
                        Nenhum apartamento cadastrado neste prédio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
