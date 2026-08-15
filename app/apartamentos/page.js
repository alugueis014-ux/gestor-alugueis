"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { assinarAtualizacoes, notificarAtualizacao } from "../../lib/sincronizacao";
import { garantirCobrancaMesAtual, sincronizarEncerramentoContrato, sincronizarValorContratoAberto } from "../../lib/sincronizacao";

export default function Apartamentos() {
  const [predios, setPredios] = useState([]);
  const [lista, setLista] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [contratosAtivos, setContratosAtivos] = useState([]);
  const [erro, setErro] = useState("");
  const [empresaId, setEmpresaId] = useState(null);
  const [modalInquilino, setModalInquilino] = useState(null);
  const [vinculando, setVinculando] = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [formEditar, setFormEditar] = useState({
    predio_id: "",
    numero: "",
    situacao: "disponivel",
    observacoes: "",
  });
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
    iniciar();
  }, []);

  useEffect(() => {
    return assinarAtualizacoes(() => {
      carregar();
    });
  }, [empresaId]);

  async function obterEmpresaId() {
    const { data: auth, error: authError } = await supabase.auth.getUser();

    if (authError || !auth?.user) {
      throw new Error("Sessão inválida. Entre novamente no sistema.");
    }

    // Compatibilidade com os dois nomes mais comuns usados na tabela
    // empresa_usuarios durante a migração: usuario_id ou user_id.
    let consulta = await supabase
      .from("empresa_usuarios")
      .select("empresa_id")
      .eq("usuario_id", auth.user.id)
      .limit(1)
      .maybeSingle();

    if (
      consulta.error &&
      /usuario_id|column|schema cache/i.test(consulta.error.message || "")
    ) {
      consulta = await supabase
        .from("empresa_usuarios")
        .select("empresa_id")
        .eq("user_id", auth.user.id)
        .limit(1)
        .maybeSingle();
    }

    if (consulta.error) throw consulta.error;

    if (!consulta.data?.empresa_id) {
      throw new Error("Usuário não está vinculado a nenhuma empresa.");
    }

    return consulta.data.empresa_id;
  }

  async function iniciar() {
    setErro("");

    try {
      const id = await obterEmpresaId();
      setEmpresaId(id);
      await carregar(id);
    } catch (e) {
      setErro(e.message || "Não foi possível identificar a empresa.");
    }
  }

  async function carregar(idEmpresa = empresaId) {
    setErro("");

    try {
      const id = idEmpresa || await obterEmpresaId();

      const [p, a, i, c] = await Promise.all([
        supabase
          .from("predios")
          .select("id,nome,endereco")
          .eq("empresa_id", id)
          .eq("arquivado", false)
          .order("nome"),
        supabase
          .from("apartamentos")
          .select("*, predios!inner(nome,endereco,arquivado)")
          .eq("empresa_id", id)
          .eq("predios.arquivado", false)
          .order("numero"),
        supabase
          .from("inquilinos")
          .select("id,nome,cpf,telefone,status")
          .eq("empresa_id", id)
          .order("nome"),
        supabase
          .from("contratos")
          .select("id,inquilino_id,apartamento_id,status")
          .eq("empresa_id", id)
          .eq("status", "ativo"),
      ]);

      const falha = p.error || a.error || i.error || c.error;
      if (falha) throw falha;

      setPredios(p.data || []);
      setLista(a.data || []);
      setInquilinos(i.data || []);
      setContratosAtivos(c.data || []);

      setForm((f) => ({
        ...f,
        predio_id:
          f.predio_id && (p.data || []).some((predio) => predio.id === f.predio_id)
            ? f.predio_id
            : p.data?.[0]?.id || ""
      }));
    } catch (e) {
      setErro(e.message || "Não foi possível carregar os dados.");
    }
  }

  async function salvar(e) {
    e.preventDefault();
    setErro("");

    try {
      const id = empresaId || await obterEmpresaId();

      if (form.situacao === "ocupado") {
        throw new Error(
          "Um apartamento só pode ficar como Ocupado quando houver um contrato ativo. Cadastre como Disponível e vincule o inquilino."
        );
      }

      const { data: duplicado, error: duplicadoError } = await supabase
        .from("apartamentos")
        .select("id")
        .eq("empresa_id", id)
        .eq("predio_id", form.predio_id)
        .eq("numero", form.numero.trim())
        .limit(1)
        .maybeSingle();

      if (duplicadoError) throw duplicadoError;
      if (duplicado) {
        throw new Error("Já existe um apartamento com este número neste imóvel.");
      }

      const { error } = await supabase.from("apartamentos").insert({
        ...form,
        numero: form.numero.trim(),
        empresa_id: id,
      });

      if (error) throw error;

      setEmpresaId(id);
      setForm((f) => ({ ...f, numero: "", observacoes: "" }));
      await carregar(id);
    } catch (e) {
      setErro(e.message || "Não foi possível cadastrar o apartamento.");
    }
  }

  async function excluir(id) {
    if (!confirm("Excluir apartamento?")) return;

    try {
      const idEmpresa = empresaId || await obterEmpresaId();

      const { error } = await supabase
        .from("apartamentos")
        .delete()
        .eq("id", id)
        .eq("empresa_id", idEmpresa);

      if (error) throw error;

      await carregar(idEmpresa);
    } catch (e) {
      setErro(e.message || "Não foi possível excluir o apartamento.");
    }
  }

  function abrirEditarApartamento(apartamento) {
    setErro("");
    setModalEditar(apartamento);
    setFormEditar({
      predio_id: apartamento.predio_id || "",
      numero: apartamento.numero || "",
      situacao: apartamento.situacao || "disponivel",
      observacoes: apartamento.observacoes || "",
    });
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!modalEditar) return;

    setErro("");
    setSalvandoEdicao(true);

    try {
      const idEmpresa = empresaId || await obterEmpresaId();

      const contratoAtivo = contratosAtivos.find(
        c => c.apartamento_id === modalEditar.id && c.status === "ativo"
      );

      if (contratoAtivo && formEditar.situacao !== "ocupado") {
        throw new Error(
          "Este apartamento possui contrato ativo e deve permanecer como Ocupado. Encerre o contrato antes de alterar a situação."
        );
      }

      if (!contratoAtivo && formEditar.situacao === "ocupado") {
        throw new Error(
          "Não é permitido marcar um apartamento como Ocupado sem contrato ativo."
        );
      }

      const { data: duplicado, error: duplicadoError } = await supabase
        .from("apartamentos")
        .select("id")
        .eq("empresa_id", idEmpresa)
        .eq("predio_id", formEditar.predio_id)
        .eq("numero", formEditar.numero.trim())
        .neq("id", modalEditar.id)
        .limit(1)
        .maybeSingle();

      if (duplicadoError) throw duplicadoError;
      if (duplicado) {
        throw new Error("Já existe um apartamento com este número neste imóvel.");
      }

      const { error } = await supabase
        .from("apartamentos")
        .update({
          predio_id: formEditar.predio_id,
          numero: formEditar.numero.trim(),
          situacao: formEditar.situacao,
          observacoes: formEditar.observacoes,
        })
        .eq("id", modalEditar.id)
        .eq("empresa_id", idEmpresa);

      if (error) throw error;

      setModalEditar(null);
      await carregar(idEmpresa);
    } catch (e) {
      setErro(e.message || "Não foi possível editar o apartamento.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  // O mesmo inquilino pode ter contratos ativos em imóveis diferentes.
  const inquilinosSemApartamento = useMemo(() => {
    return [...inquilinos].sort((a, b) =>
      String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
    );
  }, [inquilinos]);

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
      const idEmpresa = empresaId || await obterEmpresaId();
      setEmpresaId(idEmpresa);

      // Confere novamente no banco se o APARTAMENTO já possui contrato ativo.
      // O mesmo inquilino pode ter contratos ativos em imóveis/apartamentos diferentes.
      const { data: contratoDoApartamento, error: contratoApartamentoError } = await supabase
        .from("contratos")
        .select("id")
        .eq("empresa_id", idEmpresa)
        .eq("apartamento_id", modalInquilino.id)
        .eq("status", "ativo")
        .limit(1)
        .maybeSingle();

      if (contratoApartamentoError) throw contratoApartamentoError;

      if (contratoDoApartamento) {
        throw new Error("Este apartamento já possui um contrato ativo.");
      }

      const { error: novoContratoError } = await supabase
        .from("contratos")
        .insert({
          empresa_id: idEmpresa,
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
        .eq("id", modalInquilino.id)
        .eq("empresa_id", idEmpresa);

      if (aptError) throw aptError;

      const { error: inqError } = await supabase
        .from("inquilinos")
        .update({ status: "ativo", data_saida: null })
        .eq("id", formContrato.inquilino_id)
        .eq("empresa_id", idEmpresa);

      if (inqError) throw inqError;

      setModalInquilino(null);
      await carregar(idEmpresa);
      notificarAtualizacao("apartamentos-contratos");
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
            nome: apartamento.predios?.nome || "Imóvel não informado",
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
            Imóvel
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
                          <div className="apartment-actions">
                            <button
                              type="button"
                              className="secondary apartment-action-button"
                              onClick={() => abrirEditarApartamento(a)}
                            >
                              Editar
                            </button>

                            <button
                              type="button"
                              className="danger apartment-action-button"
                              onClick={() => excluir(a.id)}
                            >
                              Excluir
                            </button>

                            {a.situacao !== "ocupado" && (
                              <button
                                type="button"
                                className="secondary apartment-action-button"
                                onClick={() => abrirSelecionarInquilino(a)}
                              >
                                Selecionar inquilino
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" style={{ color: "#64748b" }}>
                        Nenhum apartamento cadastrado neste imóvel.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {modalEditar && (
          <div className="tenant-modal-backdrop">
            <form className="tenant-modal apartment-edit-modal" onSubmit={salvarEdicao}>
              <div className="tenant-modal-title">
                <div>
                  <h3>Editar apartamento</h3>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                    Atualize os dados da unidade
                  </div>
                </div>

                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setModalEditar(null)}
                  disabled={salvandoEdicao}
                >
                  ×
                </button>
              </div>

              <div className="tenant-modal-body">
                <div className="tenant-form-grid">
                  <label>
                    Imóvel
                    <select
                      value={formEditar.predio_id}
                      onChange={e =>
                        setFormEditar({ ...formEditar, predio_id: e.target.value })
                      }
                      required
                    >
                      {predios.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Apartamento
                    <input
                      value={formEditar.numero}
                      onChange={e =>
                        setFormEditar({ ...formEditar, numero: e.target.value })
                      }
                      required
                    />
                  </label>

                  <label>
                    Situação
                    <select
                      value={formEditar.situacao}
                      onChange={e =>
                        setFormEditar({ ...formEditar, situacao: e.target.value })
                      }
                    >
                      <option value="disponivel">Disponível</option>
                      <option value="reservado">Reservado</option>
                      <option value="manutencao">Manutenção</option>
                            </select>
                  </label>

                  <label>
                    Observações
                    <input
                      value={formEditar.observacoes}
                      onChange={e =>
                        setFormEditar({ ...formEditar, observacoes: e.target.value })
                      }
                    />
                  </label>
                </div>

                {erro && <div className="error tenant-modal-error">{erro}</div>}
              </div>

              <div className="tenant-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModalEditar(null)}
                  disabled={salvandoEdicao}
                >
                  Cancelar
                </button>

                <button className="primary" disabled={salvandoEdicao}>
                  {salvandoEdicao ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            </form>
          </div>
        )}

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

          .apartment-actions {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 6px;
            width: auto;
            flex-wrap: nowrap;
          }

          .apartment-action-button {
            width: auto !important;
            min-width: 0 !important;
            padding: 8px 10px !important;
            font-size: 13px !important;
            justify-content: center !important;
            text-align: center !important;
            white-space: nowrap;
          }

          .apartment-edit-modal {
            max-width: 720px;
          }
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
