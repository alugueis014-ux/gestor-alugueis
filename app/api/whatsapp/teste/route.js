import { NextResponse } from "next/server";
import {
  obterConexaoWhatsApp,
  obterUsuarioEEmpresa,
  normalizarTelefoneMeta
} from "../../../../lib/whatsapp-server";

async function enviarMensagem({ apiVersion, phoneNumberId, token, telefone }) {
  const resposta = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: {
        preview_url: false,
        body: "Mensagem de teste enviada com sucesso pelo Aluguel Fácil."
      }
    })
  });
  const json = await resposta.json().catch(() => ({}));
  return { resposta, json };
}

async function registrarNumero({ apiVersion, phoneNumberId, token }) {
  const pin = String(process.env.WHATSAPP_TWO_STEP_PIN || "").trim();
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("Configure WHATSAPP_TWO_STEP_PIN com um PIN de 6 dígitos.");
  }

  const resposta = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin })
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(json?.error?.message || `Não foi possível registrar o número (HTTP ${resposta.status}).`);
  }
}

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

    const conexao = await obterConexaoWhatsApp(contexto.supabase, contexto.empresaId);
    const token = conexao?.access_token;
    const phoneNumberId = conexao?.phone_number_id;
    const apiVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
    if (!token || !phoneNumberId) {
      return NextResponse.json({ ok: false, erro: "A empresa ainda não conectou um WhatsApp." }, { status: 400 });
    }

    let { resposta, json } = await enviarMensagem({ apiVersion, phoneNumberId, token, telefone });
    if (!resposta.ok && Number(json?.error?.code) === 133010) {
      await registrarNumero({ apiVersion, phoneNumberId, token });
      ({ resposta, json } = await enviarMensagem({ apiVersion, phoneNumberId, token, telefone }));
    }
    if (!resposta.ok) {
      return NextResponse.json({ ok: false, erro: json?.error?.message || `Erro da Meta (HTTP ${resposta.status}).` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, messageId: json?.messages?.[0]?.id || null });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e?.message || "Erro ao enviar mensagem de teste." }, { status: 500 });
  }
}
