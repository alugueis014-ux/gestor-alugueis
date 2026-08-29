import { NextResponse } from "next/server";
import {
  dataBR,
  enviarTemplateWhatsApp,
  moedaBR,
  obterUsuarioEEmpresa
} from "../../../../lib/whatsapp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function descricaoImovel(predio, apartamento) {
  const nome = predio?.nome || "Imóvel";
  const numero = apartamento?.numero ? ` - Apartamento ${apartamento.numero}` : "";
  return `${nome}${numero}`;
}

export async function POST(request) {
  try {
    const contexto = await obterUsuarioEEmpresa(request);
    if (!contexto) {
      return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
    }

    const { empresaId, supabase } = contexto;
    const corpo = await request.json().catch(() => ({}));
    const recebimentoId = corpo?.recebimentoId;
    if (!recebimentoId) {
      return NextResponse.json({ ok: false, erro: "Recebimento não informado." }, { status: 400 });
    }

    const template = process.env.WHATSAPP_TEMPLATE_PAGAMENTO || "aluguel_confirmacao_pagamento";

    const { data: r, error } = await supabase
      .from("recebimentos")
      .select(`
        id,
        empresa_id,
        contrato_id,
        data_pagamento,
        valor_recebido,
        status,
        contratos(
          id,
          inquilinos(id,nome,telefone),
          apartamentos(id,numero,predios(id,nome))
        )
      `)
      .eq("id", recebimentoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) throw error;
    if (!r) return NextResponse.json({ ok: false, erro: "Recebimento não encontrado." }, { status: 404 });
    if (String(r.status || "").toLowerCase() !== "pago") {
      return NextResponse.json({ ok: true, ignorado: true, motivo: "Recebimento ainda não está pago." });
    }

    const contrato = Array.isArray(r.contratos) ? r.contratos[0] : r.contratos;
    const inquilino = Array.isArray(contrato?.inquilinos) ? contrato.inquilinos[0] : contrato?.inquilinos;
    const apartamento = Array.isArray(contrato?.apartamentos) ? contrato.apartamentos[0] : contrato?.apartamentos;
    const predio = Array.isArray(apartamento?.predios) ? apartamento.predios[0] : apartamento?.predios;
    const dataReferencia = r.data_pagamento || new Date().toISOString().slice(0, 10);

    const { data: existente } = await supabase
      .from("whatsapp_disparos")
      .select("id,status")
      .eq("recebimento_id", r.id)
      .eq("tipo", "pagamento")
      .eq("marco_dias", 0)
      .eq("data_referencia", dataReferencia)
      .eq("status", "enviado")
      .maybeSingle();

    if (existente) {
      return NextResponse.json({ ok: true, ignorado: true, motivo: "Confirmação já enviada." });
    }

    try {
      const envio = await enviarTemplateWhatsApp({
        empresaId,
        supabaseAdmin: supabase,
        telefone: inquilino?.telefone,
        template,
        parametros: [
          inquilino?.nome || "Inquilino",
          descricaoImovel(predio, apartamento),
          moedaBR(r.valor_recebido),
          dataBR(dataReferencia)
        ]
      });

      await supabase.from("whatsapp_disparos").insert({
        empresa_id: r.empresa_id,
        recebimento_id: r.id,
        contrato_id: r.contrato_id,
        inquilino_id: inquilino?.id || null,
        telefone: inquilino?.telefone || null,
        tipo: "pagamento",
        marco_dias: 0,
        data_referencia: dataReferencia,
        template_nome: template,
        meta_message_id: envio.messageId,
        status: "enviado"
      });

      return NextResponse.json({ ok: true, enviado: true });
    } catch (e) {
      const mensagem = e?.message || "Falha desconhecida";
      console.error("[WhatsApp pagamento] Falha ao enviar confirmação:", mensagem);
      await supabase.from("whatsapp_disparos").insert({
        empresa_id: r.empresa_id,
        recebimento_id: r.id,
        contrato_id: r.contrato_id,
        inquilino_id: inquilino?.id || null,
        telefone: inquilino?.telefone || null,
        tipo: "pagamento",
        marco_dias: 0,
        data_referencia: dataReferencia,
        template_nome: template,
        status: "erro",
        erro: mensagem
      });
      return NextResponse.json({ ok: false, erro: mensagem }, { status: 502 });
    }
  } catch (e) {
    const mensagem = e?.message || "Erro interno.";
    console.error("[WhatsApp pagamento] Erro interno:", mensagem);
    return NextResponse.json({ ok: false, erro: mensagem }, { status: 500 });
  }
}
