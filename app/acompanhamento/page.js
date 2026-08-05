"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

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
  if (r.status === "pago") return "Pago";
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
  const [modal, setModal] = useState(null);
  const [pagamento, setPagamento] = useState({
    valor_recebido:"", multa:"0", juros:"0", desconto:"0",
    data_pagamento:hojeISO(), forma_pagamento:"pix", observacoes:""
  });

  useEffect(() => { prepararMes(); }, [mes]);

  async function prepararMes() {
    setCarregando(true); setErro("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sessão inválida.");

      const [p, c] = await Promise.all([
        supabase.from("predios").select("id,nome").order("nome"),
        supabase.from("contratos").select("id,proprietario_id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status").eq("status","ativo")
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
          proprietario_id: auth.user.id,
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
    const { data, error } = await supabase
      .from("recebimentos")
      .select(`
        *,
        contratos(
          id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status,
          inquilinos(id,nome,cpf,telefone,email),
          apartamentos(id,numero,predio_id,predios(id,nome,endereco))
        )
      `)
      .eq("competencia", competencia)
      .order("data_vencimento");
    if (error) setErro(error.message);
    setRecebimentos(data || []);
    setCarregando(false);
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

  const pagos = linhas.filter(x => x.statusExibido === "Pago").length;
  const pendentes = linhas.filter(x => x.statusExibido === "Pendente").length;
  const atrasados = linhas.filter(x => x.statusExibido === "Atrasado").length;

  function abrirReceber(r) {
    setModal(r);
    setPagamento({
      valor_recebido:String(r.valor_previsto), multa:"0", juros:"0", desconto:"0",
      data_pagamento:hojeISO(), forma_pagamento:"pix", observacoes:""
    });
  }

  async function salvarPagamento(e) {
    e.preventDefault();
    const { error } = await supabase.from("recebimentos").update({
      valor_recebido:Number(pagamento.valor_recebido || 0),
      multa:Number(pagamento.multa || 0),
      juros:Number(pagamento.juros || 0),
      desconto:Number(pagamento.desconto || 0),
      data_pagamento:pagamento.data_pagamento,
      forma_pagamento:pagamento.forma_pagamento,
      status:"pago",
      observacoes:pagamento.observacoes || null,
      atualizado_em:new Date().toISOString()
    }).eq("id",modal.id);
    if (error) return setErro(error.message);
    setModal(null); await carregarRecebimentos();
  }

  function whatsapp(r) {
    const tel=String(r.inquilino?.telefone||"").replace(/\D/g,"");
    if (!tel) return alert("Este inquilino não possui telefone cadastrado.");
    const numero=tel.startsWith("55")?tel:`55${tel}`;
    const texto=`Olá ${r.inquilino?.nome}. Estou entrando em contato sobre o aluguel de ${mes.split("-").reverse().join("/")} do ${r.predio?.nome}, apartamento ${r.apartamento?.numero}, no valor de ${moeda(r.valor_previsto)}. O pagamento está ${r.statusExibido.toLowerCase()}.`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,"_blank");
  }

  function recibo(r) {
    if (r.statusExibido !== "Pago") return alert("O recibo só pode ser gerado após o pagamento.");
    const w=window.open("","_blank"); if(!w) return;
    w.document.write(`<html><head><title>Recibo</title><style>body{font-family:Arial;padding:45px;line-height:1.6}h2{text-align:center}.linha{margin-top:70px;border-top:1px solid;width:300px;text-align:center}</style></head><body><h2>RECIBO DE ALUGUEL</h2><p>Recebi de <b>${r.inquilino?.nome||""}</b> a quantia de <b>${moeda(r.valor_recebido)}</b>, referente ao aluguel do imóvel <b>${r.predio?.nome}</b>, apartamento <b>${r.apartamento?.numero}</b>, competência <b>${mes.split("-").reverse().join("/")}</b>.</p><p>Forma de pagamento: <b>${r.forma_pagamento||"Não informada"}</b>.</p><p>Princesa Isabel-PB, ${new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")}.</p><div class="linha">ARMANDO DE GINO<br>LOCADOR</div><script>window.print()<\/script></body></html>`);
    w.document.close();
  }

  return <AuthGuard><AppShell>
    <div className="tracking-header"><h2>Acompanhamento de Aluguéis</h2><input type="month" value={mes} onChange={e=>setMes(e.target.value)} /></div>
    <div className="tracking-filters">
      <select value={predio} onChange={e=>setPredio(e.target.value)}><option value="">Todos os prédios</option>{predios.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}</select>
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
    <div className="tracking-table-wrap"><table className="tracking-table"><thead><tr><th>Prédio</th><th>Apartamento</th><th>Inquilino</th><th>Telefone</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Dias em atraso</th><th>Ações</th></tr></thead><tbody>
      {carregando&&<tr><td colSpan="9" className="empty-row">Carregando...</td></tr>}
      {!carregando&&linhas.length===0&&<tr><td colSpan="9" className="empty-row">Nenhum aluguel encontrado para este mês.</td></tr>}
      {linhas.map(r=><tr key={r.id}><td>{r.predio?.nome||"-"}</td><td>{r.apartamento?.numero||"-"}</td><td>{r.inquilino?.nome||"-"}</td><td>{r.inquilino?.telefone||"-"}</td><td>{new Date(`${r.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR")}</td><td>{moeda(r.valor_previsto)}</td><td><span className={`tracking-status ${r.statusExibido.toLowerCase()}`}>{r.statusExibido}</span></td><td>{r.atraso?`${r.atraso} dia(s)`:"-"}</td><td><div className="tracking-actions">{r.statusExibido!=="Pago"&&<button className="primary" onClick={()=>abrirReceber(r)}>Receber</button>}<button className="secondary" onClick={()=>whatsapp(r)}>WhatsApp</button>{r.statusExibido==="Pago"&&<button className="secondary" onClick={()=>recibo(r)}>Recibo</button>}</div></td></tr>)}
    </tbody></table></div>
    {modal&&<div className="tracking-modal-bg"><form className="tracking-modal" onSubmit={salvarPagamento}><div className="tracking-modal-head"><h3>Registrar pagamento</h3><button type="button" onClick={()=>setModal(null)}>×</button></div><div className="tracking-form-grid">
      <label>Valor recebido<input type="number" step="0.01" value={pagamento.valor_recebido} onChange={e=>setPagamento({...pagamento,valor_recebido:e.target.value})} required /></label>
      <label>Data do pagamento<input type="date" value={pagamento.data_pagamento} onChange={e=>setPagamento({...pagamento,data_pagamento:e.target.value})} required /></label>
      <label>Multa<input type="number" step="0.01" value={pagamento.multa} onChange={e=>setPagamento({...pagamento,multa:e.target.value})} /></label>
      <label>Juros<input type="number" step="0.01" value={pagamento.juros} onChange={e=>setPagamento({...pagamento,juros:e.target.value})} /></label>
      <label>Desconto<input type="number" step="0.01" value={pagamento.desconto} onChange={e=>setPagamento({...pagamento,desconto:e.target.value})} /></label>
      <label>Forma de pagamento<select value={pagamento.forma_pagamento} onChange={e=>setPagamento({...pagamento,forma_pagamento:e.target.value})}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="outro">Outro</option></select></label>
      <label className="full">Observações<textarea value={pagamento.observacoes} onChange={e=>setPagamento({...pagamento,observacoes:e.target.value})} /></label>
    </div><div className="tracking-modal-actions"><button type="button" className="secondary" onClick={()=>setModal(null)}>Cancelar</button><button className="primary">Confirmar pagamento</button></div></form></div>}
  </AppShell></AuthGuard>;
}
