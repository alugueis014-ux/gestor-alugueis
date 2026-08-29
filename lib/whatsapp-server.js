import { createClient } from "@supabase/supabase-js";

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} não configurada.`);
  return valor;
}

export function criarSupabaseAdmin() {
  return createClient(
    exigir("NEXT_PUBLIC_SUPABASE_URL"),
    exigir("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export function normalizarTelefoneMeta(telefone) {
  let digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("0")) digitos = digitos.replace(/^0+/, "");
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  if (!/^55\d{10,11}$/.test(digitos)) return null;
  return digitos;
}

export function moedaBR(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export function dataBR(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export async function obterConexaoWhatsApp(supabase, empresaId) {
  if (!empresaId) return null;
  const { data, error } = await supabase
    .from("whatsapp_conexoes")
    .select("empresa_id,waba_id,phone_number_id,access_token,numero_exibicao,nome_conta,status")
    .eq("empresa_id", empresaId)
    .eq("status", "conectado")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function enviarTemplateWhatsApp({ empresaId, telefone, template, parametros = [], supabaseAdmin = null }) {
  const supabase = supabaseAdmin || criarSupabaseAdmin();
  const conexao = await obterConexaoWhatsApp(supabase, empresaId);

  const token = conexao?.access_token || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = conexao?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.META_GRAPH_API_VERSION || process.env.NEXT_PUBLIC_META_GRAPH_API_VERSION || "v26.0";
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR";
  const to = normalizarTelefoneMeta(telefone);

  if (!token || !phoneNumberId) {
    throw new Error("A empresa ainda não conectou um WhatsApp.");
  }
  if (!to) throw new Error("Telefone do inquilino ausente ou inválido.");
  if (!template) throw new Error("Nome do template do WhatsApp não configurado.");

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: languageCode },
      components: parametros.length
        ? [{
            type: "body",
            parameters: parametros.map(valor => ({ type: "text", text: String(valor ?? "") }))
          }]
        : []
    }
  };

  const resposta = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const detalhe = json?.error?.message || `HTTP ${resposta.status}`;
    throw new Error(`Meta WhatsApp: ${detalhe}`);
  }

  return {
    messageId: json?.messages?.[0]?.id || null,
    raw: json
  };
}

export async function obterUsuarioEEmpresa(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const cliente = createClient(
    exigir("NEXT_PUBLIC_SUPABASE_URL"),
    exigir("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await cliente.auth.getUser(token);
  if (error || !data?.user) return null;

  const admin = criarSupabaseAdmin();
  let vinculo = await admin
    .from("empresa_usuarios")
    .select("empresa_id")
    .eq("usuario_id", data.user.id)
    .limit(1)
    .maybeSingle();

  if (vinculo.error && /usuario_id|column|schema cache/i.test(vinculo.error.message || "")) {
    vinculo = await admin
      .from("empresa_usuarios")
      .select("empresa_id")
      .eq("user_id", data.user.id)
      .limit(1)
      .maybeSingle();
  }

  if (vinculo.error || !vinculo.data?.empresa_id) return null;
  return { user: data.user, empresaId: vinculo.data.empresa_id, supabase: admin };
}

export function listaDias(nome, padrao) {
  const bruto = process.env[nome];
  const fonte = bruto == null || bruto === "" ? padrao : bruto;
  return [...new Set(String(fonte)
    .split(",")
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v >= 0))];
}

export function hojeFortalezaISO() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const obter = tipo => partes.find(p => p.type === tipo)?.value;
  return `${obter("year")}-${obter("month")}-${obter("day")}`;
}

export function diferencaDias(dataAlvoISO, hojeISO) {
  const a = new Date(`${dataAlvoISO}T12:00:00Z`);
  const h = new Date(`${hojeISO}T12:00:00Z`);
  return Math.round((a - h) / 86400000);
}
