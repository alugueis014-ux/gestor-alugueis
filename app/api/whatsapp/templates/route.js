import { NextResponse } from "next/server";
import { obterConexaoWhatsApp, obterUsuarioEEmpresa } from "../../../../lib/whatsapp-server";
import { garantirTemplatesWhatsAppPadrao } from "../../../../lib/whatsapp-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const contexto = await obterUsuarioEEmpresa(request);
    if (!contexto) {
      return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
    }

    const conexao = await obterConexaoWhatsApp(contexto.supabase, contexto.empresaId);
    if (!conexao?.waba_id || !conexao?.access_token) {
      return NextResponse.json({ ok: false, erro: "A empresa ainda não conectou um WhatsApp." }, { status: 400 });
    }

    const resultado = await garantirTemplatesWhatsAppPadrao({
      wabaId: conexao.waba_id,
      accessToken: conexao.access_token,
      apiVersion: process.env.META_GRAPH_API_VERSION || "v26.0"
    });

    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e?.message || "Não foi possível criar os modelos padrão." },
      { status: 500 }
    );
  }
}
