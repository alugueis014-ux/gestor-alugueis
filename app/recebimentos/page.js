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
  const [modal, setModal] = useState(null);
  const [modalReceber, setModalReceber] = useState(null);
  const [salvandoReceber, setSalvandoReceber] = useState(false);
  const [formReceber, setFormReceber] = useState({
    valor_recebido: "",
    data_pagamento: hojeISO(),
    forma_pagamento: "pix"
  });
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
    const agora = new Date();
    const mesAtual = `${agora.getFullYear()}-${String(
      agora.getMonth() + 1
    ).padStart(2, "0")}`;

    // Só gera automaticamente as cobranças do mês atual.
    // Mês futuro pode ser consultado, mas não será criado antes do dia 1º.
    if (mes === mesAtual) {
      prepararMes();
    } else {
      carregar();
    }
  }, [mes]);

  async function prepararMes() {
    setCarregando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sessão inválida.");

      const { data: contratos, error: contratosError } = await supabase
        .from("contratos")
        .select("id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status");

      if (contratosError) throw contratosError;

      const validos = (contratos || []).filter(c => {
        const inicio = c.data_inicio?.slice(0, 7);
        const fim = c.data_fim?.slice(0, 7);

        return (
          c.status !== "cancelado" &&
          (!inicio || inicio <= mes) &&
          (!fim || fim >= mes)
        );
      });

      if (validos.length > 0) {
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

        const { error: upsertError } = await supabase
          .from("recebimentos")
          .upsert(registros, {
            onConflict: "contrato_id,competencia",
            ignoreDuplicates: true
          });

        if (upsertError) throw upsertError;
      }

      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível preparar as cobranças do mês.");
      setCarregando(false);
    }
  }

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
          apartamentos(id,numero,predios(id,nome,endereco))
        )
      `)
      .eq("competencia", `${mes}-01`)
      .order("data_vencimento");

    if (error) setErro(error.message);
    setLista(data || []);
    setCarregando(false);
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

  const grupos = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((r) => {
      const id = r.predio?.id || "sem-predio";
      if (!mapa.has(id)) {
        mapa.set(id, {
          id,
          nome: r.predio?.nome || "Sem prédio",
          endereco: r.predio?.endereco || "",
          linhas: []
        });
      }
      mapa.get(id).linhas.push(r);
    });
    return Array.from(mapa.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    );
  }, [linhas]);

  function abrirReceber(r) {
    setErro("");
    setModalReceber(r);
    setFormReceber({
      valor_recebido: String(r.valor_previsto || ""),
      data_pagamento: hojeISO(),
      forma_pagamento: "pix"
    });
  }

  async function confirmarRecebimento(e) {
    e.preventDefault();
    if (!modalReceber) return;

    const valor = Number(formReceber.valor_recebido || 0);
    if (valor <= 0) {
      return setErro("Informe o valor recebido.");
    }
    if (!formReceber.data_pagamento) {
      return setErro("Informe a data do pagamento.");
    }

    setSalvandoReceber(true);
    setErro("");

    try {
      const { error } = await supabase
        .from("recebimentos")
        .update({
          valor_recebido: valor,
          data_pagamento: formReceber.data_pagamento,
          forma_pagamento: formReceber.forma_pagamento || null,
          status: "pago",
          atualizado_em: new Date().toISOString()
        })
        .eq("id", modalReceber.id);

      if (error) throw error;

      setModalReceber(null);
      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível registrar o pagamento.");
    } finally {
      setSalvandoReceber(false);
    }
  }

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

  async function excluirTodos() {
    if (lista.length === 0) return;

    const competencia = `${mes}-01`;
    const mesFormatado = mes.split("-").reverse().join("/");

    if (
      !confirm(
        `Excluir TODAS as cobranças de ${mesFormatado}?\n\n` +
        `Serão excluídos ${lista.length} recebimento(s), inclusive os que estiverem pagos.\n` +
        `Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("recebimentos")
      .delete()
      .eq("competencia", competencia);

    if (error) {
      setErro(error.message);
      return;
    }

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
              type="button"
              className="danger"
              onClick={excluirTodos}
              disabled={carregando || lista.length === 0}
              title="Excluir todas as cobranças do mês selecionado"
            >
              Excluir todos
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
          <div className="receipts-buildings">
            {grupos.map(grupo => (
              <section className="receipts-building" key={grupo.id}>
                <div className="receipts-building-head">
                  <h3>{grupo.nome}</h3>
                  {grupo.endereco && <p>{grupo.endereco}</p>}
                </div>
                <div className="receipts-table-wrap">
                  <table className="receipts-table">
                    <thead>
                      <tr>
                        <th>Mês</th><th>Apto</th><th>Inquilino</th>
                        <th>Previsto</th><th>Recebido</th><th>Data</th>
                        <th>Status</th><th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.linhas.map(r => (
                        <tr key={r.id}>
                          <td>{mes}</td>
                          <td>{r.apartamento?.numero || "-"}</td>
                          <td>{r.inquilino?.nome || "-"}</td>
                          <td>{moeda(r.valor_previsto)}</td>
                          <td>{moeda(r.valor_recebido)}</td>
                          <td>{r.data_pagamento
                            ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
                            : ""}</td>
                          <td><span className={`receipts-status ${r.statusTela.toLowerCase()}`}>{r.statusTela}</span></td>
                          <td>
                            <div className="receipts-actions">
                              {r.statusTela !== "Pago" && (
                                <button className="primary" onClick={() => abrirReceber(r)}>
                                  Receber
                                </button>
                              )}
                              <button className="secondary" onClick={() => estornar(r)}>Estornar</button>
                              <button className="secondary" onClick={() => recibo(r)}>Recibo</button>
                              <button className="danger" onClick={() => excluir(r)}>Excluir</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}

        <style jsx>{`
          .receipts-header-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
          .receipts-buildings{display:grid;gap:18px}
          .receipts-building{background:#fff;border:1px solid #dbe3ee;border-radius:12px;overflow:hidden}
          .receipts-building-head{padding:14px 16px 10px;border-bottom:1px solid #e5eaf1}
          .receipts-building-head h3{margin:0;font-size:18px}
          .receipts-building-head p{margin:4px 0 0;color:#64748b;font-size:13px}
          .receipts-building .receipts-table-wrap{margin:0;border:0;border-radius:0;overflow-x:auto}
          .receipts-building .receipts-table{
            width:100%;
            min-width:1180px;
            table-layout:fixed;
          }
          .receipts-building .receipts-table th,
          .receipts-building .receipts-table td{
            box-sizing:border-box;
            vertical-align:middle;
          }
          .receipts-building .receipts-table th:nth-child(1),
          .receipts-building .receipts-table td:nth-child(1){
            width:10%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(2),
          .receipts-building .receipts-table td:nth-child(2){
            width:10%;
            white-space:normal;
            overflow-wrap:anywhere;
          }
          .receipts-building .receipts-table th:nth-child(3),
          .receipts-building .receipts-table td:nth-child(3){
            width:22%;
            white-space:normal;
            overflow-wrap:anywhere;
            line-height:1.35;
          }
          .receipts-building .receipts-table th:nth-child(4),
          .receipts-building .receipts-table td:nth-child(4){
            width:12%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(5),
          .receipts-building .receipts-table td:nth-child(5){
            width:12%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(6),
          .receipts-building .receipts-table td:nth-child(6){
            width:11%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(7),
          .receipts-building .receipts-table td:nth-child(7){
            width:10%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(8),
          .receipts-building .receipts-table td:nth-child(8){
            width:23%;
            white-space:nowrap;
          }
          .receipts-building .receipts-actions{
            display:flex;
            gap:6px;
            flex-wrap:nowrap;
            align-items:center;
          }
        `}</style>

        {modalReceber && (
          <div className="receipts-modal-bg">
            <form className="receipts-modal" onSubmit={confirmarRecebimento}>
              <div className="receipts-modal-head">
                <div>
                  <h3>Registrar pagamento</h3>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                    {modalReceber.inquilino?.nome || "-"} — Apto {modalReceber.apartamento?.numero || "-"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalReceber(null)}
                  disabled={salvandoReceber}
                >
                  ×
                </button>
              </div>

              <div className="receipts-form-grid">
                <label>
                  Valor recebido
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formReceber.valor_recebido}
                    onChange={e =>
                      setFormReceber({ ...formReceber, valor_recebido: e.target.value })
                    }
                    required
                    autoFocus
                  />
                </label>

                <label>
                  Data do pagamento
                  <input
                    type="date"
                    value={formReceber.data_pagamento}
                    onChange={e =>
                      setFormReceber({ ...formReceber, data_pagamento: e.target.value })
                    }
                    required
                  />
                </label>

                <label className="receipts-full">
                  Forma de pagamento
                  <select
                    value={formReceber.forma_pagamento}
                    onChange={e =>
                      setFormReceber({ ...formReceber, forma_pagamento: e.target.value })
                    }
                  >
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                    <option value="cartao">Cartão</option>
                    <option value="boleto">Boleto</option>
                    <option value="outro">Outro</option>
                  </select>
                </label>
              </div>

              {erro && <div className="error" style={{ marginTop: 12 }}>{erro}</div>}

              <div className="receipts-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModalReceber(null)}
                  disabled={salvandoReceber}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={salvandoReceber}>
                  {salvandoReceber ? "Registrando..." : "Confirmar pagamento"}
                </button>
              </div>
            </form>
          </div>
        )}

      </AppShell>
    </AuthGuard>
  );
}
