import { NextResponse } from "next/server";
import { obterUsuarioEEmpresa, normalizarTelefoneMeta } from "../../../../lib/whatsapp-server";

export async function POST(request) {
  try {
    if (process.env.WHATSAPP_PERMITIR_CONEXAO_TESTE !== "true") {
      return NextResponse.json({ ok: false, erro: "O envio de teste está desativado." }, { status: 403 });
    }

    const contexto = await obterUsuarioEEmpresa(request);
    if (!contexto) {
      return NextResponse.json({ ok: false, erro: "Sessão inválida." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const telefone = normalizarTelefoneMeta(body?.telefone);
    if (!telefone) {
      return NextResponse.json({ ok: false, erro: "Informe um telefone brasileiro válido." }, { status: 400 });
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
    if (!token || !phoneNumberId) {
      return NextResponse.json({ ok: false, erro: "Credenciais de teste do WhatsApp não configuradas." }, { status: 500 });
    }

    const resposta = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefone,
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } }
      })
    });

    const json = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      return NextResponse.json({ ok: false, erro: json?.error?.message || `Erro da Meta (HTTP ${resposta.status}).` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, messageId: json?.messages?.[0]?.id || null });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e?.message || "Erro ao enviar mensagem de teste." }, { status: 500 });
  }
}
