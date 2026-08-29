import { NextResponse } from "next/server";
import {
  criarSupabaseAdmin,
  dataBR,
  diferencaDias,
  enviarTemplateWhatsApp,
  hojeFortalezaISO,
  moedaBR
} from "../../../../lib/whatsapp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  return request.headers.get("authorization") === `Bearer ${segredo}`;
}

function descricaoImovel(predio, apartamento) {
  const nome = predio?.nome || "Imóvel";
  const numero = apartamento?.numero ? ` - Apartamento ${apartamento.numero}` : "";
  return `${nome}${numero}`;
}

async function registrarFalha(supabase, dados) {
  await supabase.from("whatsapp_disparos").insert({ ...dados, status: "erro" });
}

export async function GET(request) {
  if (!autorizado(request)) {
    return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  }

  const supabase = criarSupabaseAdmin();
  const hoje = hojeFortalezaISO();
  const template5Dias = process.env.WHATSAPP_TEMPLATE_LEMBRETE_5_DIAS || "aluguel_lembrete_5_dias";
  const templateHoje = process.env.WHATSAPP_TEMPLATE_VENCIMENTO_HOJE || "aluguel_vencimento_hoje";
  const templateAtraso = process.env.WHATSAPP_TEMPLATE_ATRASO_5_DIAS || "aluguel_atrasado_5_dias";

  const { data: recebimentos, error } = await supabase
    .from("recebimentos")
    .select(`
      id,
      empresa_id,
      contrato_id,
      data_vencimento,
      valor_previsto,
      valor_recebido,
      status,
      contratos!inner(
        id,
        empresa_id,
        status,
        inquilinos(id,nome,telefone),
        apartamentos(id,numero,predios(id,nome))
      )
    `)
    .eq("status", "pendente")
    .eq("contratos.status", "ativo");

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });

  const candidatos = [];

  for (const r of recebimentos || []) {
    const previsto = Number(r.valor_previsto || 0);
    const recebido = Number(r.valor_recebido || 0);
    if (previsto > 0 && recebido >= previsto) continue;

    const contrato = Array.isArray(r.contratos) ? r.contratos[0] : r.contratos;
    const inquilino = Array.isArray(contrato?.inquilinos) ? contrato.inquilinos[0] : contrato?.inquilinos;
    const apartamento = Array.isArray(contrato?.apartamentos) ? contrato.apartamentos[0] : contrato?.apartamentos;
    const predio = Array.isArray(apartamento?.predios) ? apartamento.predios[0] : apartamento?.predios;
    const diferenca = diferencaDias(r.data_vencimento, hoje);

    let tipo = null;
    let marco = null;
    let template = null;

    if (diferenca === 5) {
      tipo = "lembrete";
      marco = 5;
      template = template5Dias;
    } else if (diferenca === 0) {
      tipo = "lembrete";
      marco = 0;
      template = templateHoje;
    } else if (diferenca === -5) {
      tipo = "atraso";
      marco = 5;
      template = templateAtraso;
    }

    if (!tipo) continue;

    candidatos.push({
      r,
      contrato,
      inquilino,
      tipo,
      marco,
      template,
      parametros: [
        inquilino?.nome || "Inquilino",
        descricaoImovel(predio, apartamento),
        moedaBR(r.valor_previsto),
        dataBR(r.data_vencimento)
      ]
    });
  }

  let enviados = 0;
  let ignorados = 0;
  const falhas = [];

  for (const item of candidatos) {
    const { data: existente } = await supabase
      .from("whatsapp_disparos")
      .select("id,status")
      .eq("recebimento_id", item.r.id)
      .eq("tipo", item.tipo)
      .eq("marco_dias", item.marco)
      .eq("data_referencia", hoje)
      .eq("status", "enviado")
      .maybeSingle();

    if (existente) {
      ignorados += 1;
      continue;
    }

    try {
      const envio = await enviarTemplateWhatsApp({
        empresaId: item.r.empresa_id,
        supabaseAdmin: supabase,
        telefone: item.inquilino?.telefone,
        template: item.template,
        parametros: item.parametros
      });

      const { error: logError } = await supabase.from("whatsapp_disparos").insert({
        empresa_id: item.r.empresa_id,
        recebimento_id: item.r.id,
        contrato_id: item.r.contrato_id,
        inquilino_id: item.inquilino?.id || null,
        telefone: item.inquilino?.telefone || null,
        tipo: item.tipo,
        marco_dias: item.marco,
        data_referencia: hoje,
        template_nome: item.template,
        meta_message_id: envio.messageId,
        status: "enviado"
      });

      if (logError) throw logError;
      enviados += 1;
    } catch (e) {
      const mensagem = e?.message || "Falha desconhecida";
      console.error("[WhatsApp cron] Falha no disparo:", mensagem);
      falhas.push({ recebimento_id: item.r.id, erro: mensagem });
      await registrarFalha(supabase, {
        empresa_id: item.r.empresa_id,
        recebimento_id: item.r.id,
        contrato_id: item.r.contrato_id,
        inquilino_id: item.inquilino?.id || null,
        telefone: item.inquilino?.telefone || null,
        tipo: item.tipo,
        marco_dias: item.marco,
        data_referencia: hoje,
        template_nome: item.template,
        erro: mensagem
      });
    }
  }

  return NextResponse.json({
    ok: falhas.length === 0,
    data: hoje,
    candidatos: candidatos.length,
    enviados,
    ignorados,
    falhas
  });
}
