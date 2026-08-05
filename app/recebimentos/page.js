"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function vencimentoDaCompetencia(competencia, dia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(
    Math.min(Number(dia), ultimoDia)
  ).padStart(2, "0")}`;
}

function statusExibido(recebimento) {
  if (recebimento.status === "pago") return "Pago";
  if (recebimento.status === "cancelado") return "Estornado";
  return hojeISO() > recebimento.data_vencimento ? "Atrasado" : "Pendente";
}

export default function Recebimentos() {
  const agora = new Date();
  const [mes, setMes] = useState(
    `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`
  );
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    valor_previsto: "",
    valor_recebido: "",
    data_pagamento: "",
    forma_pagamento: "",
    multa: "0",
    juros: "0",
    desconto: "0",
    observacoes: ""
  });

  useEffect(() => {
    carregar();
  }, [mes]);

  async function carregar() {
    setCarregando(true);
    setErro("");

    const { data, error } = await supabase
      .from("recebimentos")
      .select(`
        *,
        contratos(
          id,
          inquilinos(id,nome,cpf,telefone),
          apartamentos(id,numero,predios(id,nome))
        )
      `)
      .eq("competencia", `${mes}-01`)
      .order("data_vencimento");

    if (error) setErro(error.message);
    setLista(data || []);
    setCarregando(false);
  }

  async function gerarCobrancas() {
    setGerando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sessão inválida.");

      const { data: contratos, error: contratosError } = await supabase
        .from("contratos")
        .select("id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status")
        .eq("status", "ativo");

      if (contratosError) throw contratosError;

      const validos = (contratos || []).filter(c => {
        const inicio = c.data_inicio?.slice(0, 7);
        const fim = c.data_fim?.slice(0, 7);
        return (!inicio || inicio <= mes) && (!fim || fim >= mes);
      });

      if (!validos.length) {
        alert("Nenhum contrato ativo encontrado para este mês.");
        return;
      }

      const registros = validos.map(c => ({
        proprietario_id: auth.user.id,
        contrato_id: c.id,
        competencia: `${mes}-01`,
        data_vencimento: vencimentoDaCompetencia(mes, c.dia_vencimento),
        valor_previsto: Number(c.valor_aluguel),
        valor_recebido: 0,
        multa: 0,
        juros: 0,
        desconto: 0,
        status: "pendente"
      }));

      const { error } = await supabase
        .from("recebimentos")
        .upsert(registros, {
          onConflict: "contrato_id,competencia",
          ignoreDuplicates: true
        });

      if (error) throw error;

      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível gerar as cobranças.");
    } finally {
      setGerando(false);
    }
  }

  const linhas = useMemo(
    () =>
      lista.map(r => ({
        ...r,
        statusTela: statusExibido(r),
        inquilino: r.contratos?.inquilinos,
        apartamento: r.contratos?.apartamentos,
        predio: r.contratos?.apartamentos?.predios
      })),
    [lista]
  );

  function abrirEditar(r) {
    setModal(r);
    setForm({
      valor_previsto: String(r.valor_previsto || ""),
      valor_recebido: String(r.valor_recebido || ""),
      data_pagamento: r.data_pagamento || "",
      forma_pagamento: r.forma_pagamento || "",
      multa: String(r.multa || 0),
      juros: String(r.juros || 0),
      desconto: String(r.desconto || 0),
      observacoes: r.observacoes || ""
    });
  }

  async function salvarEdicao(e) {
    e.preventDefault();

    const pago = Number(form.valor_recebido || 0) > 0 && form.data_pagamento;

    const { error } = await supabase
      .from("recebimentos")
      .update({
        valor_previsto: Number(form.valor_previsto || 0),
        valor_recebido: Number(form.valor_recebido || 0),
        data_pagamento: form.data_pagamento || null,
        forma_pagamento: form.forma_pagamento || null,
        multa: Number(form.multa || 0),
        juros: Number(form.juros || 0),
        desconto: Number(form.desconto || 0),
        observacoes: form.observacoes || null,
        status: pago ? "pago" : "pendente",
        atualizado_em: new Date().toISOString()
      })
      .eq("id", modal.id);

    if (error) return setErro(error.message);

    setModal(null);
    await carregar();
  }

  async function estornar(r) {
    if (!confirm(`Estornar o recebimento de ${r.inquilino?.nome || "inquilino"}?`)) {
      return;
    }

    const { error } = await supabase
      .from("recebimentos")
      .update({
        valor_recebido: 0,
        data_pagamento: null,
        forma_pagamento: null,
        multa: 0,
        juros: 0,
        desconto: 0,
        status: "pendente",
        atualizado_em: new Date().toISOString()
      })
      .eq("id", r.id);

    if (error) return setErro(error.message);
    await carregar();
  }

  async function excluir(r) {
    if (!confirm(`Excluir definitivamente esta cobrança de ${r.inquilino?.nome || "inquilino"}?`)) {
      return;
    }

    const { error } = await supabase
      .from("recebimentos")
      .delete()
      .eq("id", r.id);

    if (error) return setErro(error.message);
    await carregar();
  }

  function recibo(r) {
    if (r.statusTela !== "Pago") {
      alert("O recibo só pode ser gerado após o pagamento.");
      return;
    }

    const janela = window.open("", "_blank");
    if (!janela) return;

    const dataPagamento = r.data_pagamento
      ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
      : "";

    janela.document.write(`
      <html>
      <head>
        <title>Recibo de Aluguel</title>
        <style>
          body{font-family:Arial,sans-serif;padding:45px;line-height:1.65;color:#111}
          h2{text-align:center;margin-bottom:35px}
          .linha{margin-top:80px;border-top:1px solid #111;width:320px;text-align:center}
          @media print{button{display:none}}
        </style>
      </head>
      <body>
        <h2>RECIBO DE ALUGUEL</h2>
        <p>
          Recebi de <b>${r.inquilino?.nome || ""}</b> a quantia de
          <b>${moeda(r.valor_recebido)}</b>, referente ao aluguel do imóvel
          <b>${r.predio?.nome || ""}</b>, apartamento
          <b>${r.apartamento?.numero || ""}</b>, competência
          <b>${mes.split("-").reverse().join("/")}</b>.
        </p>
        <p>Forma de pagamento: <b>${r.forma_pagamento || "Não informada"}</b>.</p>
        <p>Princesa Isabel-PB, ${dataPagamento}.</p>
        <div class="linha">ARMANDO DE GINO<br>LOCADOR</div>
        <script>window.onload=()=>window.print()<\/script>
      </body>
      </html>
    `);

    janela.document.close();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="receipts-header">
          <h2>Recebimentos</h2>

          <div className="receipts-header-actions">
            <input
              type="month"
              value={mes}
              onChange={e => setMes(e.target.value)}
            />
            <button
              className="primary receipts-generate-button"
              onClick={gerarCobrancas}
              disabled={gerando}
            >
              {gerando ? "Gerando..." : "Gerar cobranças"}
            </button>
          </div>
        </div>

        {erro && <div className="error">{erro}</div>}

        {!carregando && linhas.length === 0 && (
          <div className="receipts-empty">
            Nenhum recebimento gerado para este mês.
          </div>
        )}

        {carregando && (
          <div className="receipts-empty">Carregando...</div>
        )}

        {!carregando && linhas.length > 0 && (
          <div className="receipts-table-wrap">
            <table className="receipts-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Prédio</th>
                  <th>Apto</th>
                  <th>Inquilino</th>
                  <th>Previsto</th>
                  <th>Recebido</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>

              <tbody>
                {linhas.map(r => (
                  <tr key={r.id}>
                    <td>{mes}</td>
                    <td>{r.predio?.nome || "-"}</td>
                    <td>{r.apartamento?.numero || "-"}</td>
                    <td>{r.inquilino?.nome || "-"}</td>
                    <td>{moeda(r.valor_previsto)}</td>
                    <td>{moeda(r.valor_recebido)}</td>
                    <td>
                      {r.data_pagamento
                        ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
                        : ""}
                    </td>
                    <td>
                      <span className={`receipts-status ${r.statusTela.toLowerCase()}`}>
                        {r.statusTela}
                      </span>
                    </td>
                    <td>
                      <div className="receipts-actions">
                        <button
                          className="primary"
                          onClick={() => abrirEditar(r)}
                        >
                          Editar
                        </button>

                        <button
                          className="secondary"
                          onClick={() => estornar(r)}
                        >
                          Estornar
                        </button>

                        <button
                          className="secondary"
                          onClick={() => recibo(r)}
                        >
                          Recibo
                        </button>

                        <button
                          className="danger"
                          onClick={() => excluir(r)}
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {modal && (
          <div className="receipts-modal-bg">
            <form className="receipts-modal" onSubmit={salvarEdicao}>
              <div className="receipts-modal-head">
                <h3>Editar recebimento</h3>
                <button type="button" onClick={() => setModal(null)}>×</button>
              </div>

              <div className="receipts-form-grid">
                <label>
                  Valor previsto
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.valor_previsto}
                    onChange={e => setForm({...form, valor_previsto:e.target.value})}
                    required
                  />
                </label>

                <label>
                  Valor recebido
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.valor_recebido}
                    onChange={e => setForm({...form, valor_recebido:e.target.value})}
                  />
                </label>

                <label>
                  Data do pagamento
                  <input
                    type="date"
                    value={form.data_pagamento}
                    onChange={e => setForm({...form, data_pagamento:e.target.value})}
                  />
                </label>

                <label>
                  Forma de pagamento
                  <select
                    value={form.forma_pagamento}
                    onChange={e => setForm({...form, forma_pagamento:e.target.value})}
                  >
                    <option value="">Não informada</option>
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                    <option value="cartao">Cartão</option>
                    <option value="boleto">Boleto</option>
                    <option value="outro">Outro</option>
                  </select>
                </label>

                <label>
                  Multa
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.multa}
                    onChange={e => setForm({...form, multa:e.target.value})}
                  />
                </label>

                <label>
                  Juros
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.juros}
                    onChange={e => setForm({...form, juros:e.target.value})}
                  />
                </label>

                <label>
                  Desconto
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.desconto}
                    onChange={e => setForm({...form, desconto:e.target.value})}
                  />
                </label>

                <label className="receipts-full">
                  Observações
                  <textarea
                    value={form.observacoes}
                    onChange={e => setForm({...form, observacoes:e.target.value})}
                  />
                </label>
              </div>

              <div className="receipts-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </button>

                <button className="primary">Salvar alterações</button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
