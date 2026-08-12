"use client";

import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

const vazio = {
  nome: "",
  endereco: "",
  observacoes: "",
  apartamentos: [""]
};

export default function Predios() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState(null);
  const [erro, setErro] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [predioApartamentos, setPredioApartamentos] = useState(null);
  const [apartamentosDoPredio, setApartamentosDoPredio] = useState([]);
  const [novosApartamentos, setNovosApartamentos] = useState([""]);
  const [salvandoApartamentos, setSalvandoApartamentos] = useState(false);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setErro("");
    const { data, error } = await supabase
      .from("predios")
      .select("*")
      .order("nome");

    if (error) setErro(error.message);
    else setLista(data || []);
  }

  function abrirNovo() {
    setForm(vazio);
    setEditando(null);
    setErro("");
    setModalAberto(true);
  }

  function editar(p) {
    setEditando(p.id);
    setForm({
      nome: p.nome,
      endereco: p.endereco || "",
      observacoes: p.observacoes || "",
      apartamentos: [""]
    });
    setErro("");
    setModalAberto(true);
  }

  function fecharModal() {
    if (!salvando) {
      setModalAberto(false);
      setEditando(null);
      setForm(vazio);
      setErro("");
    }
  }

  function alterarApartamento(index, valor) {
    setForm((f) => ({
      ...f,
      apartamentos: f.apartamentos.map((item, i) => (i === index ? valor : item))
    }));
  }

  function adicionarApartamento() {
    setForm((f) => ({
      ...f,
      apartamentos: [...f.apartamentos, ""]
    }));
  }

  function removerApartamento(index) {
    setForm((f) => {
      const novaLista = f.apartamentos.filter((_, i) => i !== index);
      return {
        ...f,
        apartamentos: novaLista.length ? novaLista : [""]
      };
    });
  }

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    setSalvando(true);

    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u?.user) {
        throw new Error("Sessão inválida. Entre novamente no sistema.");
      }

      const payload = {
        nome: form.nome.trim(),
        endereco: form.endereco.trim() || null,
        observacoes: form.observacoes.trim() || null,
        proprietario_id: u.user.id
      };

      if (!payload.nome) {
        throw new Error("Informe o nome do prédio.");
      }

      let predioId = editando;

      if (editando) {
        const { error } = await supabase
          .from("predios")
          .update(payload)
          .eq("id", editando);

        if (error) throw error;
      } else {
        const { data: novoPredio, error } = await supabase
          .from("predios")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw error;
        predioId = novoPredio.id;
      }

      const apartamentosValidos = form.apartamentos
        .map((numero) => numero.trim())
        .filter(Boolean);

      if (apartamentosValidos.length > 0) {
        const registros = apartamentosValidos.map((numero) => ({
          proprietario_id: u.user.id,
          predio_id: predioId,
          numero,
          situacao: "disponivel",
          observacoes: null
        }));

        const { error: apartamentosError } = await supabase
          .from("apartamentos")
          .insert(registros);

        if (apartamentosError) throw apartamentosError;
      }

      setModalAberto(false);
      setEditando(null);
      setForm(vazio);
      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível salvar o prédio.");
    } finally {
      setSalvando(false);
    }
  }

  async function abrirCadastroApartamentos(predio) {
    setPredioApartamentos(predio);
    setNovosApartamentos([""]);
    setApartamentosDoPredio([]);
    setErro("");

    const { data, error } = await supabase
      .from("apartamentos")
      .select("id,predio_id,numero,situacao,observacoes")
      .eq("predio_id", predio.id)
      .order("numero");

    if (error) {
      setErro(error.message);
      return;
    }

    setApartamentosDoPredio(data || []);
  }

  function alterarNovoApartamento(index, valor) {
    setNovosApartamentos((lista) =>
      lista.map((item, i) => (i === index ? valor : item))
    );
  }

  function adicionarNovoApartamento() {
    setNovosApartamentos((lista) => [...lista, ""]);
  }

  function removerNovoApartamento(index) {
    setNovosApartamentos((lista) => {
      const novaLista = lista.filter((_, i) => i !== index);
      return novaLista.length ? novaLista : [""];
    });
  }

  function alterarApartamentoExistente(id, campo, valor) {
    setApartamentosDoPredio((lista) =>
      lista.map((apartamento) =>
        apartamento.id === id
          ? { ...apartamento, [campo]: valor }
          : apartamento
      )
    );
  }

  async function excluirApartamentoExistente(apartamento) {
    if (!confirm(`Excluir o apartamento ${apartamento.numero}?`)) return;

    const { error } = await supabase
      .from("apartamentos")
      .delete()
      .eq("id", apartamento.id);

    if (error) {
      setErro(error.message);
      return;
    }

    setApartamentosDoPredio((lista) =>
      lista.filter((item) => item.id !== apartamento.id)
    );
  }

  async function salvarApartamentosExistentes(e) {
    e.preventDefault();
    if (!predioApartamentos) return;

    setErro("");
    setSalvandoApartamentos(true);

    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u?.user) {
        throw new Error("Sessão inválida. Entre novamente no sistema.");
      }

      // Atualiza os apartamentos já cadastrados.
      for (const apartamento of apartamentosDoPredio) {
        const numero = String(apartamento.numero || "").trim();
        if (!numero) {
          throw new Error("Todos os apartamentos cadastrados precisam ter um número.");
        }

        const { error: updateError } = await supabase
          .from("apartamentos")
          .update({
            numero,
            situacao: apartamento.situacao || "disponivel",
            observacoes: apartamento.observacoes?.trim() || null
          })
          .eq("id", apartamento.id);

        if (updateError) throw updateError;
      }

      // Cadastra os novos apartamentos informados no final da janela.
      const apartamentosValidos = novosApartamentos
        .map((numero) => numero.trim())
        .filter(Boolean);

      if (apartamentosValidos.length > 0) {
        const registros = apartamentosValidos.map((numero) => ({
          proprietario_id: u.user.id,
          predio_id: predioApartamentos.id,
          numero,
          situacao: "disponivel",
          observacoes: null
        }));

        const { error: insertError } = await supabase
          .from("apartamentos")
          .insert(registros);

        if (insertError) throw insertError;
      }

      setPredioApartamentos(null);
      setApartamentosDoPredio([]);
      setNovosApartamentos([""]);
    } catch (e) {
      setErro(e.message || "Não foi possível salvar os apartamentos.");
    } finally {
      setSalvandoApartamentos(false);
    }
  }

  async function excluir(id) {
    if (!confirm("Excluir este prédio?")) return;

    const { error } = await supabase
      .from("predios")
      .delete()
      .eq("id", id);

    if (error) return setErro(error.message);
    carregar();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div
          className="page-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16
          }}
        >
          <div>
            <h2>Prédios</h2>
            <p>Cadastre seus residenciais</p>
          </div>

          <button className="primary" onClick={abrirNovo}>
            Cadastrar prédio
          </button>
        </div>

        {erro && !modalAberto && <div className="error">{erro}</div>}

        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Endereço</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.nome}</td>
                  <td>{p.endereco || "—"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => abrirCadastroApartamentos(p)}
                    >
                      Gerenciar apartamentos
                    </button>{" "}
                    <button className="secondary" onClick={() => editar(p)}>
                      Editar
                    </button>{" "}
                    <button className="danger" onClick={() => excluir(p.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {modalAberto && (
          <div
            className="tenant-modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) fecharModal();
            }}
          >
            <form className="tenant-modal" onSubmit={salvar}>
              <div className="tenant-modal-title">
                <h3>{editando ? "Editar prédio" : "Cadastrar prédio"}</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={fecharModal}
                >
                  ×
                </button>
              </div>

              <div className="tenant-modal-body">
                <div className="tenant-form-grid">
                  <label>
                    Nome do prédio
                    <input
                      value={form.nome}
                      onChange={(e) =>
                        setForm({ ...form, nome: e.target.value })
                      }
                      required
                    />
                  </label>

                  <label>
                    Endereço
                    <input
                      value={form.endereco}
                      onChange={(e) =>
                        setForm({ ...form, endereco: e.target.value })
                      }
                    />
                  </label>

                  <label className="tenant-full">
                    Observações
                    <textarea
                      value={form.observacoes}
                      onChange={(e) =>
                        setForm({ ...form, observacoes: e.target.value })
                      }
                    />
                  </label>

                  {!editando && (
                    <div className="tenant-full">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 10
                        }}
                      >
                        <strong>Apartamentos do prédio</strong>

                        <button
                          type="button"
                          className="secondary"
                          onClick={adicionarApartamento}
                        >
                          + Adicionar apartamento
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: 10 }}>
                        {form.apartamentos.map((numero, index) => (
                          <div
                            key={index}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr auto",
                              gap: 8,
                              alignItems: "center"
                            }}
                          >
                            <input
                              placeholder={`Apartamento ${index + 1} (ex.: 101)`}
                              value={numero}
                              onChange={(e) =>
                                alterarApartamento(index, e.target.value)
                              }
                            />

                            <button
                              type="button"
                              className="danger"
                              onClick={() => removerApartamento(index)}
                              disabled={form.apartamentos.length === 1}
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          color: "#64748b",
                          fontSize: 13
                        }}
                      >
                        Os apartamentos serão cadastrados como disponíveis.
                      </div>
                    </div>
                  )}
                </div>

                {erro && (
                  <div className="error tenant-modal-error">{erro}</div>
                )}
              </div>

              <div className="tenant-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={fecharModal}
                  disabled={salvando}
                >
                  Cancelar
                </button>

                <button className="primary" disabled={salvando}>
                  {salvando
                    ? "Salvando..."
                    : editando
                    ? "Atualizar prédio"
                    : "Salvar prédio"}
                </button>
              </div>
            </form>
          </div>
        )}

        {predioApartamentos && (
          <div
            className="tenant-modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !salvandoApartamentos) {
                setPredioApartamentos(null);
              }
            }}
          >
            <form
              className="tenant-modal"
              onSubmit={salvarApartamentosExistentes}
              style={{ maxWidth: 900 }}
            >
              <div className="tenant-modal-title">
                <div>
                  <h3 style={{ marginBottom: 4 }}>Gerenciar apartamentos</h3>
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    {predioApartamentos.nome}
                    {predioApartamentos.endereco
                      ? ` - ${predioApartamentos.endereco}`
                      : ""}
                  </div>
                </div>

                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setPredioApartamentos(null)}
                >
                  ×
                </button>
              </div>

              <div className="tenant-modal-body">
                <div style={{ marginBottom: 20 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>
                    Apartamentos já cadastrados
                  </strong>

                  {apartamentosDoPredio.length === 0 ? (
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      Nenhum apartamento cadastrado neste prédio.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {apartamentosDoPredio.map((apartamento) => (
                        <div
                          key={apartamento.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px 180px 1fr auto",
                            gap: 8,
                            alignItems: "center"
                          }}
                        >
                          <input
                            value={apartamento.numero || ""}
                            placeholder="Apartamento"
                            onChange={(e) =>
                              alterarApartamentoExistente(
                                apartamento.id,
                                "numero",
                                e.target.value
                              )
                            }
                          />

                          <select
                            value={apartamento.situacao || "disponivel"}
                            onChange={(e) =>
                              alterarApartamentoExistente(
                                apartamento.id,
                                "situacao",
                                e.target.value
                              )
                            }
                          >
                            <option value="disponivel">Disponível</option>
                            <option value="ocupado">Ocupado</option>
                            <option value="reservado">Reservado</option>
                            <option value="manutencao">Manutenção</option>
                          </select>

                          <input
                            value={apartamento.observacoes || ""}
                            placeholder="Observações"
                            onChange={(e) =>
                              alterarApartamentoExistente(
                                apartamento.id,
                                "observacoes",
                                e.target.value
                              )
                            }
                          />

                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              excluirApartamentoExistente(apartamento)
                            }
                          >
                            Excluir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: 18
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 12
                    }}
                  >
                    <strong>Adicionar novos apartamentos</strong>

                    <button
                      type="button"
                      className="secondary"
                      onClick={adicionarNovoApartamento}
                    >
                      + Adicionar apartamento
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {novosApartamentos.map((numero, index) => (
                      <div
                        key={index}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 8,
                          alignItems: "center"
                        }}
                      >
                        <input
                          placeholder={`Novo apartamento ${index + 1} (ex.: 101)`}
                          value={numero}
                          onChange={(e) =>
                            alterarNovoApartamento(index, e.target.value)
                          }
                        />

                        <button
                          type="button"
                          className="danger"
                          onClick={() => removerNovoApartamento(index)}
                          disabled={novosApartamentos.length === 1}
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      color: "#64748b",
                      fontSize: 13
                    }}
                  >
                    Os novos apartamentos serão cadastrados como disponíveis.
                  </div>
                </div>

                {erro && (
                  <div className="error tenant-modal-error">{erro}</div>
                )}
              </div>

              <div className="tenant-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPredioApartamentos(null)}
                  disabled={salvandoApartamentos}
                >
                  Cancelar
                </button>

                <button className="primary" disabled={salvandoApartamentos}>
                  {salvandoApartamentos
                    ? "Salvando..."
                    : "Salvar alterações"}
                </button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
