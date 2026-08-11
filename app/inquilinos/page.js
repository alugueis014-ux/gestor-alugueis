"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

const formularioVazio = {
  nome: "",
  cpf: "",
  telefone: "",
  email: "",
  predio_id: "",
  apartamento_id: "",
  valor_aluguel: "",
  dia_vencimento: "",
  data_inicio: "",
  data_fim: "",
  status: "ativo",
  data_saida: "",
  observacoes: ""
};

export default function Inquilinos() {
  const [lista, setLista] = useState([]);
  const [predios, setPredios] = useState([]);
  const [apartamentos, setApartamentos] = useState([]);
  const [form, setForm] = useState(formularioVazio);
  const [arquivo, setArquivo] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [contratoEditandoId, setContratoEditandoId] = useState(null);
  const [apartamentoAnteriorId, setApartamentoAnteriorId] = useState(null);

  useEffect(() => { carregarTudo(); }, []);

  async function carregarTudo() {
    setErro("");
    const [inq, pre, apt] = await Promise.all([
      supabase
        .from("inquilinos")
        .select("*, contratos(id, apartamento_id, valor_aluguel, dia_vencimento, data_inicio, data_fim, status, apartamentos(numero, predio_id, predios(nome,endereco)))")
        .order("nome"),
      supabase.from("predios").select("id,nome,endereco").order("nome"),
      supabase.from("apartamentos").select("id,predio_id,numero,situacao,predios(nome,endereco)").order("numero")
    ]);

    const falha = inq.error || pre.error || apt.error;
    if (falha) setErro(falha.message);
    setLista(inq.data || []);
    setPredios(pre.data || []);
    setApartamentos(apt.data || []);
  }

  const apartamentosDoPredio = useMemo(() => {
    if (!form.predio_id) return [];
    return apartamentos.filter(
      a => a.predio_id === form.predio_id &&
      (a.situacao !== "ocupado" || a.id === form.apartamento_id)
    );
  }, [apartamentos, form.predio_id, form.apartamento_id]);

  const filtrados = lista.filter(i => {
    const texto = [i.nome, i.cpf, i.telefone].join(" ").toLowerCase();
    return texto.includes(busca.toLowerCase());
  });

  const inquilinosPorPredio = useMemo(() => {
    const grupos = new Map();

    predios.forEach((predio) => {
      grupos.set(predio.id, { predio, inquilinos: [] });
    });

    filtrados.forEach((inquilino) => {
      const contrato =
        (inquilino.contratos || []).find(c => c.status === "ativo") ||
        (inquilino.contratos || [])[0];

      const predioId = contrato?.apartamentos?.predio_id || "sem-predio";
      const predioNome =
        contrato?.apartamentos?.predios?.nome || "Sem prédio informado";

      if (!grupos.has(predioId)) {
        grupos.set(predioId, {
          predio: {
            id: predioId,
            nome: predioNome,
            endereco: contrato?.apartamentos?.predios?.endereco || ""
          },
          inquilinos: []
        });
      }

      grupos.get(predioId).inquilinos.push({ inquilino, contrato });
    });

    return Array.from(grupos.values()).filter(
      grupo => grupo.inquilinos.length > 0
    );
  }, [predios, filtrados]);

  function abrirNovo() {
    setForm(formularioVazio);
    setArquivo(null);
    setErro("");
    setEditandoId(null);
    setContratoEditandoId(null);
    setApartamentoAnteriorId(null);
    setModalAberto(true);
  }

  function abrirEditar(inquilino) {
    const contrato =
      (inquilino.contratos || []).find(c => c.status === "ativo") ||
      (inquilino.contratos || [])[0];

    setForm({
      nome: inquilino.nome || "",
      cpf: inquilino.cpf || "",
      telefone: inquilino.telefone || "",
      email: inquilino.email || "",
      predio_id: contrato?.apartamentos?.predio_id || "",
      apartamento_id: contrato?.apartamento_id || "",
      valor_aluguel: contrato?.valor_aluguel ?? "",
      dia_vencimento: contrato?.dia_vencimento ?? "",
      data_inicio: contrato?.data_inicio || "",
      data_fim: contrato?.data_fim || "",
      status: inquilino.status || "ativo",
      data_saida: inquilino.data_saida || "",
      observacoes: inquilino.observacoes || ""
    });

    setArquivo(null);
    setErro("");
    setEditandoId(inquilino.id);
    setContratoEditandoId(contrato?.id || null);
    setApartamentoAnteriorId(contrato?.apartamento_id || null);
    setModalAberto(true);
  }

  function fecharModal() {
    if (!salvando) setModalAberto(false);
  }

  function alterarPredio(predioId) {
    setForm(f => ({ ...f, predio_id: predioId, apartamento_id: "" }));
  }

  async function enviarAnexo({ proprietario_id, inquilino_id, contrato_id }) {
    if (!arquivo || !contrato_id) return;

    const extensao = arquivo.name.split(".").pop() || "arquivo";
    const caminho = `${proprietario_id}/${contrato_id}/${Date.now()}.${extensao}`;

    const { error: uploadError } = await supabase.storage
      .from("contratos")
      .upload(caminho, arquivo);

    if (uploadError) throw uploadError;

    const { error: anexoError } = await supabase.from("anexos").insert({
      proprietario_id,
      inquilino_id,
      contrato_id,
      nome_arquivo: arquivo.name,
      caminho_arquivo: caminho,
      tipo_arquivo: arquivo.type || null,
      tamanho_bytes: arquivo.size
    });

    if (anexoError) throw anexoError;
  }

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) return setErro("Informe o nome do inquilino.");

    setSalvando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        throw new Error("Sessão inválida. Entre novamente no sistema.");
      }

      const proprietario_id = auth.user.id;
      const dadosInquilino = {
        nome: form.nome.trim(),
        cpf: form.cpf.trim() || null,
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
        data_saida: form.data_saida || null,
        observacoes: form.observacoes.trim() || null
      };

      let inquilinoId = editandoId;

      if (editandoId) {
        const { error } = await supabase
          .from("inquilinos")
          .update(dadosInquilino)
          .eq("id", editandoId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("inquilinos")
          .insert({ proprietario_id, ...dadosInquilino })
          .select()
          .single();

        if (error) throw error;
        inquilinoId = data.id;
      }

      const dadosContratoCompletos =
        form.apartamento_id &&
        form.valor_aluguel &&
        form.dia_vencimento &&
        form.data_inicio;

      let contratoId = contratoEditandoId;

      if (dadosContratoCompletos) {
        const dadosContrato = {
          proprietario_id,
          inquilino_id: inquilinoId,
          apartamento_id: form.apartamento_id,
          valor_aluguel: Number(form.valor_aluguel),
          dia_vencimento: Number(form.dia_vencimento),
          data_inicio: form.data_inicio,
          data_fim: form.data_fim || null,
          status: form.status === "ativo" ? "ativo" : "encerrado"
        };

        if (contratoEditandoId) {
          const { error } = await supabase
            .from("contratos")
            .update(dadosContrato)
            .eq("id", contratoEditandoId);

          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("contratos")
            .insert(dadosContrato)
            .select()
            .single();

          if (error) throw error;
          contratoId = data.id;
        }

        if (
          apartamentoAnteriorId &&
          apartamentoAnteriorId !== form.apartamento_id
        ) {
          await supabase
            .from("apartamentos")
            .update({ situacao: "disponivel" })
            .eq("id", apartamentoAnteriorId);
        }

        await supabase
          .from("apartamentos")
          .update({
            situacao: form.status === "ativo" ? "ocupado" : "disponivel"
          })
          .eq("id", form.apartamento_id);
      } else if (contratoEditandoId && form.status === "inativo") {
        await supabase
          .from("contratos")
          .update({
            status: "encerrado",
            data_fim: form.data_saida || form.data_fim || new Date().toISOString().slice(0, 10)
          })
          .eq("id", contratoEditandoId);

        if (apartamentoAnteriorId) {
          await supabase
            .from("apartamentos")
            .update({ situacao: "disponivel" })
            .eq("id", apartamentoAnteriorId);
        }
      }

      await enviarAnexo({
        proprietario_id,
        inquilino_id: inquilinoId,
        contrato_id: contratoId
      });

      setModalAberto(false);
      setForm(formularioVazio);
      setArquivo(null);
      setEditandoId(null);
      setContratoEditandoId(null);
      setApartamentoAnteriorId(null);
      await carregarTudo();
    } catch (err) {
      setErro(err.message || "Não foi possível salvar o inquilino.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(inquilino) {
    const novoStatus = inquilino.status === "ativo" ? "inativo" : "ativo";
    const contratoAtivo = (inquilino.contratos || []).find(c => c.status === "ativo");

    const { error } = await supabase
      .from("inquilinos")
      .update({
        status: novoStatus,
        data_saida: novoStatus === "inativo"
          ? new Date().toISOString().slice(0, 10)
          : null
      })
      .eq("id", inquilino.id);

    if (error) return setErro(error.message);

    if (contratoAtivo && novoStatus === "inativo") {
      await supabase
        .from("contratos")
        .update({
          status: "encerrado",
          data_fim: new Date().toISOString().slice(0, 10)
        })
        .eq("id", contratoAtivo.id);

      await supabase
        .from("apartamentos")
        .update({ situacao: "disponivel" })
        .eq("id", contratoAtivo.apartamento_id);
    }

    await carregarTudo();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="tenant-page-header">
          <h2>Inquilinos</h2>
          <button className="primary tenant-new-button" onClick={abrirNovo}>
            Novo inquilino
          </button>
        </div>

        <div className="tenant-search-row">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF ou telefone"
          />
        </div>

        {erro && !modalAberto && <div className="error">{erro}</div>}

        <div style={{ display: "grid", gap: 18 }}>
          {inquilinosPorPredio.length === 0 && (
            <div className="panel table-wrap tenant-table-panel">
              <div className="empty-row" style={{ padding: 18 }}>
                Nenhum inquilino cadastrado.
              </div>
            </div>
          )}

          {inquilinosPorPredio.map(({ predio, inquilinos }) => (
            <div className="panel table-wrap tenant-table-panel" key={predio.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: "wrap"
                }}
              >
                <h3 style={{ margin: 0, fontSize: 21 }}>
                  {predio.nome}{predio.endereco ? ` - ${predio.endereco}` : ""}
                </h3>
                <span
                  style={{
                    background: "#e8f1fb",
                    color: "#174f7a",
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700
                  }}
                >
                  {inquilinos.length} inquilino(s)
                </span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Apartamento</th>
                    <th>Inquilino</th>
                    <th>Telefone</th>
                    <th>Aluguel</th>
                    <th>Status</th>
                    <th>Contrato</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {inquilinos.map(({ inquilino: i, contrato }) => (
                    <tr key={i.id}>
                      <td>{contrato?.apartamentos?.numero || "Não informado"}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{i.nome}</div>
                        {i.cpf && (
                          <div style={{ color: "#64748b", fontSize: 13 }}>
                            CPF: {i.cpf}
                          </div>
                        )}
                      </td>
                      <td>{i.telefone || "-"}</td>
                      <td>
                        {contrato?.valor_aluguel != null
                          ? Number(contrato.valor_aluguel).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL"
                            })
                          : "-"}
                      </td>
                      <td>
                        <span className={`badge ${i.status}`}>
                          {i.status === "ativo" ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>{contrato ? "Cadastrado" : "Sem contrato"}</td>
                      <td>
                        <div className="tenant-action-buttons">
                          <button
                            className="secondary"
                            onClick={() => abrirEditar(i)}
                          >
                            Editar
                          </button>
                          <button
                            className="secondary"
                            onClick={() => alternar(i)}
                          >
                            {i.status === "ativo" ? "Desativar" : "Reativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {modalAberto && (
          <div
            className="tenant-modal-backdrop"
            onMouseDown={e => {
              if (e.target === e.currentTarget) fecharModal();
            }}
          >
            <form className="tenant-modal" onSubmit={salvar}>
              <div className="tenant-modal-title">
                <h3>{editandoId ? "Editar inquilino" : "Inquilino"}</h3>
                <button type="button" className="modal-close" onClick={fecharModal}>
                  ×
                </button>
              </div>

              <div className="tenant-modal-body">
                <div className="tenant-form-grid">
                  <label>
                    Nome
                    <input
                      value={form.nome}
                      onChange={e => setForm({...form, nome:e.target.value})}
                      required
                    />
                  </label>

                  <label>
                    CPF
                    <input
                      value={form.cpf}
                      onChange={e => setForm({...form, cpf:e.target.value})}
                    />
                  </label>

                  <label>
                    Telefone
                    <input
                      value={form.telefone}
                      onChange={e => setForm({...form, telefone:e.target.value})}
                    />
                  </label>

                  <label>
                    E-mail
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm({...form, email:e.target.value})}
                    />
                  </label>

                  <label>
                    Prédio
                    <select
                      value={form.predio_id}
                      onChange={e => alterarPredio(e.target.value)}
                    >
                      <option value="">Não informado</option>
                      {predios.map(p => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Apartamento
                    <select
                      value={form.apartamento_id}
                      onChange={e => setForm({...form, apartamento_id:e.target.value})}
                      disabled={!form.predio_id}
                    >
                      <option value="">Não informado</option>
                      {apartamentosDoPredio.map(a => (
                        <option key={a.id} value={a.id}>{a.numero}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Valor do aluguel
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.valor_aluguel}
                      onChange={e => setForm({...form, valor_aluguel:e.target.value})}
                    />
                  </label>

                  <label>
                    Dia do vencimento
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={form.dia_vencimento}
                      onChange={e => setForm({...form, dia_vencimento:e.target.value})}
                    />
                  </label>

                  <label>
                    Início do contrato
                    <input
                      type="date"
                      value={form.data_inicio}
                      onChange={e => setForm({...form, data_inicio:e.target.value})}
                    />
                  </label>

                  <label>
                    Fim do contrato
                    <input
                      type="date"
                      value={form.data_fim}
                      onChange={e => setForm({...form, data_fim:e.target.value})}
                    />
                  </label>

                  <label>
                    Status
                    <select
                      value={form.status}
                      onChange={e => setForm({...form, status:e.target.value})}
                    >
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </label>

                  <label>
                    Data de saída
                    <input
                      type="date"
                      value={form.data_saida}
                      onChange={e => setForm({...form, data_saida:e.target.value})}
                    />
                  </label>

                  <label>
                    Contrato/anexo
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={e => setArquivo(e.target.files?.[0] || null)}
                    />
                  </label>

                  <label className="tenant-full">
                    Observações
                    <textarea
                      value={form.observacoes}
                      onChange={e => setForm({...form, observacoes:e.target.value})}
                    />
                  </label>
                </div>

                {erro && <div className="error tenant-modal-error">{erro}</div>}
              </div>

              <div className="tenant-modal-actions">
                <button type="button" className="secondary" onClick={fecharModal}>
                  Cancelar
                </button>
                <button className="primary" disabled={salvando}>
                  {salvando
                    ? "Salvando..."
                    : editandoId
                      ? "Salvar alterações"
                      : "Salvar inquilino"}
                </button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
