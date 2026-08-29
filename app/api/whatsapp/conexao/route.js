import { NextResponse } from "next/server";
import { obterUsuarioEEmpresa } from "../../../../lib/whatsapp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function trocarCodigoPorToken(code) {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
  if (!appId || !appSecret) throw new Error("Configure META_APP_ID/NEXT_PUBLIC_META_APP_ID e META_APP_SECRET.");

  const url = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  const resposta = await fetch(url, { cache: "no-store" });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !json?.access_token) {
    throw new Error(json?.error?.message || "Não foi possível concluir a autorização da Meta.");
  }
  return json.access_token;
}

async function descobrirNumero(phoneNumberId, accessToken) {
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
  const resposta = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  const json = await resposta.json().catch(() => ({}));
  return {
    numero: json?.display_phone_number || "",
    nome: json?.verified_name || ""
  };
}

export async function GET(request) {
  const contexto = await obterUsuarioEEmpresa(request);
  if (!contexto) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });

  const { data, error } = await contexto.supabase
    .from("whatsapp_conexoes")
    .select("empresa_id,waba_id,phone_number_id,numero_exibicao,nome_conta,status,conectado_em,atualizado_em")
    .eq("empresa_id", contexto.empresaId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, conexao: data || null });
}

export async function POST(request) {
  try {
    const contexto = await obterUsuarioEEmpresa(request);
    if (!contexto) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    let accessToken = "";
    let wabaId = body?.wabaId || "";
    let phoneNumberId = body?.phoneNumberId || "";
    let origem = "embedded_signup";

    if (body?.modo === "teste") {
      if (process.env.WHATSAPP_PERMITIR_CONEXAO_TESTE !== "true") {
        return NextResponse.json({ ok: false, erro: "Conexão de teste desabilitada." }, { status: 403 });
      }
      accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
      wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
      phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
      origem = "teste_meta";
    } else {
      if (!body?.code || !wabaId || !phoneNumberId) {
        return NextResponse.json({ ok: false, erro: "Autorização da Meta incompleta." }, { status: 400 });
      }
      accessToken = await trocarCodigoPorToken(body.code);
    }

    if (!accessToken || !wabaId || !phoneNumberId) {
      throw new Error("Credenciais do WhatsApp incompletas.");
    }

    const info = await descobrirNumero(phoneNumberId, accessToken);
    const agora = new Date().toISOString();

    const { error } = await contexto.supabase
      .from("whatsapp_conexoes")
      .upsert({
        empresa_id: contexto.empresaId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        access_token: accessToken,
        numero_exibicao: info.numero || body?.numeroExibicao || null,
        nome_conta: info.nome || body?.nomeConta || null,
        status: "conectado",
        origem,
        conectado_em: agora,
        atualizado_em: agora
      }, { onConflict: "empresa_id" });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      conexao: {
        empresa_id: contexto.empresaId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        numero_exibicao: info.numero || null,
        nome_conta: info.nome || null,
        status: "conectado",
        conectado_em: agora
      }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e?.message || "Não foi possível conectar o WhatsApp." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const contexto = await obterUsuarioEEmpresa(request);
  if (!contexto) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });

  const { error } = await contexto.supabase
    .from("whatsapp_conexoes")
    .update({ status: "desconectado", access_token: null, atualizado_em: new Date().toISOString() })
    .eq("empresa_id", contexto.empresaId);

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
