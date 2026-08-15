"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";


async function obterEmpresaId() {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) throw new Error("Sessão inválida. Entre novamente no sistema.");

  let consulta = await supabase.from("empresa_usuarios").select("empresa_id").eq("usuario_id", auth.user.id).limit(1).maybeSingle();
  if (consulta.error && /usuario_id|column|schema cache/i.test(consulta.error.message || "")) {
    consulta = await supabase.from("empresa_usuarios").select("empresa_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
  }
  if (consulta.error) throw consulta.error;
  if (!consulta.data?.empresa_id) throw new Error("Usuário não está vinculado a nenhuma empresa.");
  return consulta.data.empresa_id;
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hojeISO() { return new Date().toISOString().slice(0, 10); }

function vencimentoDaCompetencia(competencia, dia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return `${ano}-${String(mes).padStart(2,"0")}-${String(Math.min(Number(dia), ultimoDia)).padStart(2,"0")}`;
}

function statusReal(r) {
  const previsto = Number(r.valor_previsto || 0);
  const recebido = Number(r.valor_recebido || 0);

  if (r.status === "pago" || (previsto > 0 && recebido >= previsto)) return "Pago";
  if (r.status === "cancelado") return "Cancelado";
  return hojeISO() > r.data_vencimento ? "Atrasado" : "Pendente";
}

function diasAtraso(r) {
  if (statusReal(r) !== "Atrasado") return 0;
  const hoje = new Date(`${hojeISO()}T12:00:00`);
  const venc = new Date(`${r.data_vencimento}T12:00:00`);
  return Math.max(0, Math.floor((hoje - venc) / 86400000));
}

export default function Acompanhamento() {
  const agora = new Date();
  const [mes, setMes] = useState(`${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,"0")}`);
  const [predios, setPredios] = useState([]);
  const [recebimentos, setRecebimentos] = useState([]);
  const [predio, setPredio] = useState("");
  const [status, setStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [nomeEmpresa, setNomeEmpresa] = useState("LOCADOR");
  const [modalReceber, setModalReceber] = useState(null);
  const [salvandoReceber, setSalvandoReceber] = useState(false);
  const [formReceber, setFormReceber] = useState({
    valor_recebido: "",
    data_pagamento: hojeISO(),
    forma_pagamento: "pix"
  });

  useEffect(() => { prepararMes(); }, [mes]);

  async function prepararMes() {
    setCarregando(true); setErro("");
    try {
      const empresaId = await obterEmpresaId();

      const { data: empresa, error: empresaError } = await supabase
        .from("empresas")
        .select("nome")
        .eq("id", empresaId)
        .single();

      if (empresaError) throw empresaError;
      setNomeEmpresa(empresa?.nome || "LOCADOR");

      const [p, c] = await Promise.all([
        supabase.from("predios").select("id,nome,endereco").eq("empresa_id", empresaId).eq("arquivado", false).order("nome"),
        supabase.from("contratos").select("id,empresa_id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status").eq("empresa_id", empresaId).eq("status","ativo")
      ]);
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      setPredios(p.data || []);

      const competencia = `${mes}-01`;
      const contratosValidos = (c.data || []).filter(x => {
        const inicio = x.data_inicio?.slice(0,7);
        const fim = x.data_fim?.slice(0,7);
        return (!inicio || inicio <= mes) && (!fim || fim >= mes);
      });

      if (contratosValidos.length) {
        const novos = contratosValidos.map(x => ({
          empresa_id: empresaId,
          contrato_id: x.id,
          competencia,
          data_vencimento: vencimentoDaCompetencia(mes, x.dia_vencimento),
          valor_previsto: Number(x.valor_aluguel),
          status: "pendente"
        }));
        const { error: upsertError } = await supabase
          .from("recebimentos")
          .upsert(novos, { onConflict: "contrato_id,competencia", ignoreDuplicates: true });
        if (upsertError) throw upsertError;
      }

      await carregarRecebimentos();
    } catch(e) {
      setErro(e.message || "Não foi possível carregar o acompanhamento.");
      setCarregando(false);
    }
  }

  async function carregarRecebimentos() {
    const competencia = `${mes}-01`;

    try {
      const empresaId = await obterEmpresaId();

      const { data, error } = await supabase
        .from("recebimentos")
        .select(`
          *,
          contratos!inner(
            id,
            empresa_id,
            apartamento_id,
            valor_aluguel,
            dia_vencimento,
            data_inicio,
            data_fim,
            status,
            inquilinos(id,nome,cpf,telefone,email),
            apartamentos(id,numero,predio_id,predios(id,nome,endereco))
          )
        `)
        .eq("empresa_id", empresaId)
        .eq("contratos.empresa_id", empresaId)
        .eq("competencia", competencia)
        .order("data_vencimento");

      if (error) throw error;

      // Registros antigos podem conter um Pago e outro Pendente
      // para o mesmo apartamento no mesmo mês.
      // O Acompanhamento deve mostrar somente UMA cobrança.
      const mapa = new Map();

      const pontuar = item => {
        const status = String(item.status || "").toLowerCase();
        const previsto = Number(item.valor_previsto || 0);
        const recebido = Number(item.valor_recebido || 0);

        // Pago sempre vence uma duplicidade pendente.
        const pago =
          status === "pago" || (previsto > 0 && recebido >= previsto)
            ? 1000000000
            : 0;

        // Depois prioriza o contrato ativo.
        const ativo =
          String(item.contratos?.status || "").toLowerCase() === "ativo"
            ? 100000000
            : 0;

        // Depois o registro com maior valor já recebido.
        const valorRecebido = recebido * 1000;

        // Por último, contrato de início mais recente.
        const inicio =
          Number(String(item.contratos?.data_inicio || "").replace(/-/g, "")) || 0;

        return pago + ativo + valorRecebido + inicio;
      };

      for (const item of data || []) {
        const apartamentoId =
          item.contratos?.apartamento_id ||
          item.contratos?.apartamentos?.id ||
          item.id;

        const chave = `${apartamentoId}|${item.competencia}`;
        const atual = mapa.get(chave);

        if (!atual || pontuar(item) > pontuar(atual)) {
          mapa.set(chave, item);
        }
      }

      setRecebimentos(Array.from(mapa.values()));
    } catch (e) {
      setErro(e.message || "Não foi possível carregar os recebimentos.");
      setRecebimentos([]);
    } finally {
      setCarregando(false);
    }
  }

  const linhas = useMemo(() => recebimentos.map(r => ({
    ...r,
    statusExibido: statusReal(r),
    atraso: diasAtraso(r),
    contrato: r.contratos,
    inquilino: r.contratos?.inquilinos,
    apartamento: r.contratos?.apartamentos,
    predio: r.contratos?.apartamentos?.predios
  })).filter(r => {
    const texto = [r.inquilino?.nome,r.apartamento?.numero,r.predio?.nome,r.inquilino?.telefone].join(" ").toLowerCase();
    return (!predio || r.predio?.id === predio) && (!status || r.statusExibido === status) && texto.includes(busca.toLowerCase());
  }).sort((a,b) => {
    const ordem={Atrasado:1,Pendente:2,Pago:3,Cancelado:4};
    return ordem[a.statusExibido]-ordem[b.statusExibido] || b.atraso-a.atraso || String(a.predio?.nome).localeCompare(String(b.predio?.nome));
  }), [recebimentos,predio,status,busca]);

  const grupos = useMemo(() => {
    const mapa = new Map();

    linhas.forEach(r => {
      const id = r.predio?.id || "sem-predio";
      if (!mapa.has(id)) {
        mapa.set(id, {
          id,
          nome: r.predio?.nome || "Sem imóvel",
          endereco: r.predio?.endereco || "",
          linhas: []
        });
      }
      mapa.get(id).linhas.push(r);
    });

    return Array.from(mapa.values()).sort((a,b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    );
  }, [linhas]);

  const pagos = linhas.filter(x => x.statusExibido === "Pago").length;
  const pendentes = linhas.filter(x => x.statusExibido === "Pendente").length;
  const atrasados = linhas.filter(x => x.statusExibido === "Atrasado").length;

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
      await carregarRecebimentos();
    } catch (e) {
      setErro(e.message || "Não foi possível registrar o pagamento.");
    } finally {
      setSalvandoReceber(false);
    }
  }

  function whatsapp(r) {
    if (r.statusExibido !== "Atrasado") {
      return alert("A cobrança por WhatsApp fica disponível somente para aluguéis atrasados.");
    }

    const tel = String(r.inquilino?.telefone || "").replace(/\D/g, "");
    if (!tel) {
      return alert("Este inquilino não possui telefone cadastrado. Edite o cadastro antes de enviar a cobrança.");
    }

    const numero = tel.startsWith("55") ? tel : `55${tel}`;
    const vencimento = new Date(`${r.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR");
    const nome = r.inquilino?.nome || "inquilino";
    const predioNome = r.predio?.nome || "imóvel";
    const apartamentoNumero = r.apartamento?.numero || "não informado";

    const texto = [
      `Olá, ${nome}.`,
      "",
      `Identificamos um aluguel em aberto no valor de ${moeda(r.valor_previsto)}, referente ao ${predioNome}, apartamento ${apartamentoNumero}.`,
      `O vencimento ocorreu em ${vencimento} e o pagamento está com ${r.atraso} dia(s) de atraso.`,
      "",
      "Caso o pagamento já tenha sido realizado, por favor desconsidere esta mensagem e, se possível, envie o comprovante.",
      "",
      "Em caso de dúvida, entre em contato."
    ].join("\n");

    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  }

  function recibo(r) {
    if (r.statusExibido !== "Pago") return alert("O recibo só pode ser gerado após o pagamento.");
    const w=window.open("","_blank"); if(!w) return;
    w.document.write(`<html><head><title>Recibo</title><style>body{font-family:Arial;padding:45px;line-height:1.6}h2{text-align:center}.linha{margin-top:70px;border-top:1px solid;width:300px;text-align:center}</style></head><body><h2>RECIBO DE ALUGUEL</h2><p>Recebi de <b>${r.inquilino?.nome||""}</b> a quantia de <b>${moeda(r.valor_recebido)}</b>, referente ao aluguel do imóvel <b>${r.predio?.nome}</b>, apartamento <b>${r.apartamento?.numero}</b>, competência <b>${mes.split("-").reverse().join("/")}</b>.</p><p>Forma de pagamento: <b>${r.forma_pagamento||"Não informada"}</b>.</p><p>Princesa Isabel-PB, ${new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")}.</p><div class="linha">${nomeEmpresa}<br>LOCADOR</div><script>window.print()<\/script></body></html>`);
    w.document.close();
  }

  return <AuthGuard><AppShell>
    <div className="tracking-header"><h2>Acompanhamento de Aluguéis</h2><input type="month" value={mes} onChange={e=>setMes(e.target.value)} /></div>
    <div className="tracking-filters">
      <select value={predio} onChange={e=>setPredio(e.target.value)}><option value="">Todos os imóveis</option>{predios.map(p=><option key={p.id} value={p.id}>{p.nome}{p.endereco ? ` — ${p.endereco}` : ""}</option>)}</select>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option>Pago</option><option>Pendente</option><option>Atrasado</option></select>
      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar inquilino ou apartamento" />
    </div>
    <div className="tracking-cards">
      <div><span>Total de apartamentos</span><strong>{linhas.length}</strong></div>
      <div><span>Pagos</span><strong>{pagos}</strong></div>
      <div><span>Pendentes</span><strong>{pendentes}</strong></div>
      <div><span>Atrasados</span><strong>{atrasados}</strong></div>
    </div>
    {erro&&<div className="error">{erro}</div>}
    {carregando&&<div className="tracking-table-wrap"><div className="empty-row">Carregando...</div></div>}
    {!carregando&&linhas.length===0&&<div className="tracking-table-wrap"><div className="empty-row">Nenhum aluguel encontrado para este mês.</div></div>}
    {!carregando&&linhas.length>0&&<div className="tracking-buildings">
      {grupos.map(grupo=><section className="tracking-building" key={grupo.id}>
        <div className="tracking-building-head">
          <h3>{grupo.nome}</h3>
          {grupo.endereco&&<p>{grupo.endereco}</p>}
        </div>
        <div className="tracking-table-wrap"><table className="tracking-table"><thead><tr><th>Apartamento</th><th>Inquilino</th><th>Telefone</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Dias em atraso</th><th>Ações</th></tr></thead><tbody>
          {grupo.linhas.map(r=><tr key={r.id}><td>{r.apartamento?.numero||"-"}</td><td>{r.inquilino?.nome||"-"}</td><td>{r.inquilino?.telefone||"-"}</td><td>{new Date(`${r.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR")}</td><td>{moeda(r.valor_previsto)}</td><td><span className={`tracking-status ${r.statusExibido.toLowerCase()}`}>{r.statusExibido}</span></td><td>{r.atraso?`${r.atraso} dia(s)`:"-"}</td><td><div className="tracking-actions">{r.statusExibido!=="Pago"&&<button className="primary" onClick={()=>abrirReceber(r)}>Receber</button>}{r.statusExibido==="Atrasado"&&<button className="secondary tracking-whatsapp" onClick={()=>whatsapp(r)}>WhatsApp</button>}{r.statusExibido==="Pago"&&<button className="secondary" onClick={()=>recibo(r)}>Recibo</button>}</div></td></tr>)}
        </tbody></table></div>
      </section>)}
    </div>}
    <style jsx>{`
      .tracking-buildings{display:grid;gap:18px}
      .tracking-building{background:#fff;border:1px solid #dbe3ee;border-radius:12px;overflow:hidden}
      .tracking-building-head{padding:14px 16px 10px;border-bottom:1px solid #e5eaf1}
      .tracking-building-head h3{margin:0;font-size:18px}
      .tracking-building-head p{margin:4px 0 0;color:#64748b;font-size:13px}
      .tracking-building .tracking-table-wrap{margin:0;border:0;border-radius:0;overflow-x:auto}
      .tracking-building .tracking-table{width:100%;min-width:1180px;table-layout:fixed}
      .tracking-building .tracking-table th,
      .tracking-building .tracking-table td{
        box-sizing:border-box;
        vertical-align:middle;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .tracking-building .tracking-table th:nth-child(1),
      .tracking-building .tracking-table td:nth-child(1){width:15%}
      .tracking-building .tracking-table th:nth-child(2),
      .tracking-building .tracking-table td:nth-child(2){
        width:25%;
        white-space:normal;
        overflow-wrap:anywhere;
        word-break:normal;
        line-height:1.35;
      }
      .tracking-building .tracking-table th:nth-child(3),
      .tracking-building .tracking-table td:nth-child(3){width:14%;white-space:nowrap}
      .tracking-building .tracking-table th:nth-child(4),
      .tracking-building .tracking-table td:nth-child(4){width:12%;white-space:nowrap}
      .tracking-building .tracking-table th:nth-child(5),
      .tracking-building .tracking-table td:nth-child(5){width:10%;white-space:nowrap}
      .tracking-building .tracking-table th:nth-child(6),
      .tracking-building .tracking-table td:nth-child(6){width:10%;white-space:nowrap}
      .tracking-building .tracking-table th:nth-child(7),
      .tracking-building .tracking-table td:nth-child(7){width:10%;white-space:nowrap}
      .tracking-building .tracking-table th:nth-child(8),
      .tracking-building .tracking-table td:nth-child(8){width:14%;white-space:nowrap}
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
  </AppShell></AuthGuard>;
}
