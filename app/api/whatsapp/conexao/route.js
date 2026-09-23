import { NextResponse } from "next/server";
import { obterUsuarioEEmpresa } from "../../../../lib/whatsapp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuracaoMeta() {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const apiVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
  if (!appId || !appSecret) {
    throw new Error("Configure META_APP_ID/NEXT_PUBLIC_META_APP_ID e META_APP_SECRET.");
  }
  return { appId, appSecret, apiVersion };
}

async function trocarCodigoPorToken(code, redirectUri = "") {
  const { appId, appSecret, apiVersion } = configuracaoMeta();
  const url = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);

  const resposta = await fetch(url, { cache: "no-store" });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !json?.access_token) {
    throw new Error(json?.error?.message || "Não foi possível concluir a autorização da Meta.");
  }
  return json.access_token;
}

async function depurarToken(accessToken) {
  const { appId, appSecret, apiVersion } = configuracaoMeta();
  const url = new URL(`https://graph.facebook.com/${apiVersion}/debug_token`);
  url.searchParams.set("input_token", accessToken);

  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` },
    cache: "no-store"
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !json?.data) return null;
  return json.data;
}

function wabasDoDebug(debug) {
  const ids = new Set();
  const escopos = Array.isArray(debug?.granular_scopes) ? debug.granular_scopes : [];
  for (const item of escopos) {
    if (!["whatsapp_business_management", "whatsapp_business_messaging"].includes(item?.scope)) continue;
    for (const id of item?.target_ids || []) {
      if (id) ids.add(String(id));
    }
  }
  return [...ids];
}

async function listarTelefonesDaWaba(wabaId, accessToken) {
  const { apiVersion } = configuracaoMeta();
  const url = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}/phone_numbers`);
  url.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,code_verification_status,last_onboarded_time"
  );

  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !Array.isArray(json?.data)) return [];
  return json.data.map(item => ({ ...item, wabaId: String(wabaId) }));
}

async function descobrirAtivosAutorizados({ accessToken, wabaId = "", phoneNumberId = "" }) {
  let wabas = wabaId ? [String(wabaId)] : [];

  if (!wabas.length) {
    const debug = await depurarToken(accessToken);
    wabas = wabasDoDebug(debug);
  }

  if (!wabas.length) {
    throw new Error(
      "A Meta autorizou o acesso, mas não foi possível identificar a Conta do WhatsApp Business. Tente conectar novamente."
    );
  }

  const candidatos = [];
  for (const id of wabas) {
    const telefones = await listarTelefonesDaWaba(id, accessToken);
    candidatos.push(...telefones);
  }

  let escolhido = null;
  if (phoneNumberId) {
    escolhido = candidatos.find(item => String(item.id) === String(phoneNumberId)) || null;
  }

  if (!escolhido && candidatos.length) {
    candidatos.sort((a, b) => {
      const ta = Date.parse(a?.last_onboarded_time || 0) || 0;
      const tb = Date.parse(b?.last_onboarded_time || 0) || 0;
      return tb - ta;
    });
    escolhido = candidatos[0];
  }

  if (!escolhido) {
    throw new Error(
      "A Meta autorizou a conta, mas nenhum número do WhatsApp foi encontrado nela. Conclua o cadastro do número e tente novamente."
    );
  }

  return {
    wabaId: escolhido.wabaId || String(wabas[0]),
    phoneNumberId: String(escolhido.id),
    numero: escolhido.display_phone_number || "",
    nome: escolhido.verified_name || ""
  };
}

async function descobrirNumero(phoneNumberId, accessToken) {
  const { apiVersion } = configuracaoMeta();
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

async function assinarWebhookDaWaba(wabaId, accessToken) {
  try {
    const { apiVersion } = configuracaoMeta();
    await fetch(`https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    });
  } catch {
    // A assinatura do webhook não deve impedir o cadastro da conexão.
  }
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
    let info = { numero: "", nome: "" };

    if (body?.modo === "teste") {
      if (process.env.WHATSAPP_PERMITIR_CONEXAO_TESTE !== "true") {
        return NextResponse.json({ ok: false, erro: "Conexão de teste desabilitada." }, { status: 403 });
      }
      accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
      wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
      phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
      origem = "teste_meta";
    } else {
      if (!body?.code) {
        return NextResponse.json({ ok: false, erro: "Autorização da Meta incompleta." }, { status: 400 });
      }

      const redirectUri = `${request.nextUrl.origin}/meta-whatsapp-callback`;
      if (body?.redirectUri && body.redirectUri !== redirectUri) {
        return NextResponse.json({ ok: false, erro: "URL de retorno da Meta inválida." }, { status: 400 });
      }
      accessToken = await trocarCodigoPorToken(body.code, redirectUri);

      // O evento FINISH do Embedded Signup pode ser bloqueado ou chegar atrasado em
      // alguns navegadores. Por isso o servidor também descobre WABA/telefone a partir
      // dos ativos concedidos ao token, sem depender exclusivamente do postMessage.
      const ativos = await descobrirAtivosAutorizados({ accessToken, wabaId, phoneNumberId });
      wabaId = ativos.wabaId;
      phoneNumberId = ativos.phoneNumberId;
      info = { numero: ativos.numero, nome: ativos.nome };
    }

    if (!accessToken || !wabaId || !phoneNumberId) {
      throw new Error("Credenciais do WhatsApp incompletas.");
    }

    if (!info.numero && !info.nome) {
      info = await descobrirNumero(phoneNumberId, accessToken);
    }

    await assinarWebhookDaWaba(wabaId, accessToken);

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
