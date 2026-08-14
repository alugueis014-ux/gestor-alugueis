"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

export default function Apartamentos() {
  const [predios, setPredios] = useState([]);
  const [lista, setLista] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [contratosAtivos, setContratosAtivos] = useState([]);
  const [erro, setErro] = useState("");
  const [modalInquilino, setModalInquilino] = useState(null);
  const [vinculando, setVinculando] = useState(false);
  const [formContrato, setFormContrato] = useState({
    inquilino_id: "",
    valor_aluguel: "",
    dia_vencimento: "",
    data_inicio: new Date().toISOString().slice(0, 10),
    data_fim: ""
  });
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

    const [p, a, i, c] = await Promise.all([
      supabase.from("predios").select("id,nome,endereco").order("nome"),
      supabase
        .from("apartamentos")
        .select("*, predios(nome,endereco)")
        .order("numero"),
      supabase
        .from("inquilinos")
        .select("id,nome,cpf,telefone,status")
        .order("nome"),
      supabase
        .from("contratos")
        .select("id,inquilino_id,apartamento_id,status")
        .eq("status", "ativo"),
    ]);

    const falha = p.error || a.error || i.error || c.error;
    if (falha) setErro(falha.message);

    setPredios(p.data || []);
    setLista(a.data || []);
    setInquilinos(i.data || []);
    setContratosAtivos(c.data || []);

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

  const inquilinosSemApartamento = useMemo(() => {
    const ocupados = new Set(
      contratosAtivos
        .filter(c => c.inquilino_id)
        .map(c => c.inquilino_id)
    );

    return inquilinos.filter(i => !ocupados.has(i.id));
  }, [inquilinos, contratosAtivos]);

  function abrirSelecionarInquilino(apartamento) {
    if (apartamento.situacao === "ocupado") {
      return setErro("Este apartamento já está ocupado.");
    }

    setErro("");
    setModalInquilino(apartamento);
    setFormContrato({
      inquilino_id: "",
      valor_aluguel: "",
      dia_vencimento: "",
      data_inicio: new Date().toISOString().slice(0, 10),
      data_fim: ""
    });
  }

  async function vincularInquilino(e) {
    e.preventDefault();
    if (!modalInquilino) return;

    if (!formContrato.inquilino_id) {
      return setErro("Selecione um inquilino.");
    }
    if (!formContrato.valor_aluguel || Number(formContrato.valor_aluguel) <= 0) {
      return setErro("Informe o valor do aluguel.");
    }
    if (
      !formContrato.dia_vencimento ||
      Number(formContrato.dia_vencimento) < 1 ||
      Number(formContrato.dia_vencimento) > 31
    ) {
      return setErro("Informe um dia de vencimento entre 1 e 31.");
    }
    if (!formContrato.data_inicio) {
      return setErro("Informe a data de início do contrato.");
    }

    setVinculando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sessão inválida.");

      // Confere novamente no banco para impedir vínculo duplicado.
      const { data: contratoExistente, error: contratoError } = await supabase
        .from("contratos")
        .select("id")
        .eq("inquilino_id", formContrato.inquilino_id)
        .eq("status", "ativo")
        .maybeSingle();

      if (contratoError) throw contratoError;
      if (contratoExistente) {
        throw new Error("Este inquilino já está vinculado a outro apartamento.");
      }

      const { error: novoContratoError } = await supabase
        .from("contratos")
        .insert({
          proprietario_id: auth.user.id,
          inquilino_id: formContrato.inquilino_id,
          apartamento_id: modalInquilino.id,
          valor_aluguel: Number(formContrato.valor_aluguel),
          dia_vencimento: Number(formContrato.dia_vencimento),
          data_inicio: formContrato.data_inicio,
          data_fim: formContrato.data_fim || null,
          status: "ativo"
        });

      if (novoContratoError) throw novoContratoError;

      const { error: aptError } = await supabase
        .from("apartamentos")
        .update({ situacao: "ocupado" })
        .eq("id", modalInquilino.id);

      if (aptError) throw aptError;

      const { error: inqError } = await supabase
        .from("inquilinos")
        .update({ status: "ativo", data_saida: null })
        .eq("id", formContrato.inquilino_id);

      if (inqError) throw inqError;

      setModalInquilino(null);
      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível vincular o inquilino.");
    } finally {
      setVinculando(false);
    }
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
                <h3 style={{ margin: 0, fontSize: 21 }}>{predio.nome}</h3>
                {predio.endereco && (
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                    {predio.endereco}
                  </div>
                )}
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
                        <td>
                          {a.numero || "-"}
                        </td>
                        <td>
                          <span className={`badge ${a.situacao}`}>{a.situacao}</span>
                        </td>
                        <td>{a.observacoes || "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {a.situacao !== "ocupado" && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => abrirSelecionarInquilino(a)}
                              >
                                Selecionar inquilino
                              </button>
                            )}
                            <button
                              type="button"
                              className="danger"
                              onClick={() => excluir(a.id)}
                            >
                              Excluir
                            </button>
                          </div>
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

        {modalInquilino && (
          <div className="tenant-modal-backdrop">
            <form className="tenant-modal" onSubmit={vincularInquilino}>
              <div className="tenant-modal-title">
                <div>
                  <h3>Selecionar inquilino</h3>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                    {modalInquilino.predios?.nome || ""} — Apartamento {modalInquilino.numero}
                  </div>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setModalInquilino(null)}
                  disabled={vinculando}
                >
                  ×
                </button>
              </div>

              <div className="tenant-modal-body">
                <div className="tenant-form-grid">
                  <label className="tenant-full">
                    Inquilino sem apartamento
                    <select
                      value={formContrato.inquilino_id}
                      onChange={e =>
                        setFormContrato({ ...formContrato, inquilino_id: e.target.value })
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      {inquilinosSemApartamento.map(i => (
                        <option key={i.id} value={i.id}>
                          {i.nome}{i.cpf ? ` — CPF ${i.cpf}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Valor do aluguel
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formContrato.valor_aluguel}
                      onChange={e =>
                        setFormContrato({ ...formContrato, valor_aluguel: e.target.value })
                      }
                      required
                    />
                  </label>

                  <label>
                    Dia do vencimento
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={formContrato.dia_vencimento}
                      onChange={e =>
                        setFormContrato({ ...formContrato, dia_vencimento: e.target.value })
                      }
                      required
                    />
                  </label>

                  <label>
                    Início do contrato
                    <input
                      type="date"
                      value={formContrato.data_inicio}
                      onChange={e =>
                        setFormContrato({ ...formContrato, data_inicio: e.target.value })
                      }
                      required
                    />
                  </label>

                  <label>
                    Fim do contrato
                    <input
                      type="date"
                      value={formContrato.data_fim}
                      onChange={e =>
                        setFormContrato({ ...formContrato, data_fim: e.target.value })
                      }
                    />
                  </label>
                </div>

                {inquilinosSemApartamento.length === 0 && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 12,
                      borderRadius: 8,
                      background: "#f8fafc",
                      color: "#64748b"
                    }}
                  >
                    Não há inquilinos cadastrados sem apartamento.
                  </div>
                )}

                {erro && <div className="error tenant-modal-error">{erro}</div>}
              </div>

              <div className="tenant-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModalInquilino(null)}
                  disabled={vinculando}
                >
                  Cancelar
                </button>
                <button
                  className="primary"
                  disabled={vinculando || inquilinosSemApartamento.length === 0}
                >
                  {vinculando ? "Vinculando..." : "Vincular ao apartamento"}
                </button>
              </div>
            </form>
          </div>
        )}

        <style jsx>{`
          .table-wrap {
            overflow-x: auto;
          }

          .table-wrap table {
            width: 100%;
            min-width: 900px;
            table-layout: fixed;
          }

          .table-wrap th,
          .table-wrap td {
            box-sizing: border-box;
            vertical-align: middle;
          }

          .table-wrap th:nth-child(1),
          .table-wrap td:nth-child(1) {
            width: 48%;
            white-space: normal;
            overflow-wrap: anywhere;
            line-height: 1.35;
          }

          .table-wrap th:nth-child(2),
          .table-wrap td:nth-child(2) {
            width: 12%;
            white-space: nowrap;
          }

          .table-wrap th:nth-child(3),
          .table-wrap td:nth-child(3) {
            width: 15%;
            white-space: normal;
            overflow-wrap: anywhere;
          }

          .table-wrap th:nth-child(4),
          .table-wrap td:nth-child(4) {
            width: 25%;
            white-space: nowrap;
          }
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
