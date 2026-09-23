export const TEMPLATES_WHATSAPP_PADRAO = [
  {
    name: "aluguel_lembrete_5_dias",
    category: "UTILITY",
    language: "pt_BR",
    body: "Olá, {{1}}. Este é um lembrete de que o aluguel referente a {{2}}, no valor de {{3}}, vence em {{4}}.\n\nCaso o pagamento já tenha sido realizado, desconsidere esta mensagem.",
    example: ["João", "Apartamento 101", "R$ 1.200,00", "10/09/2026"]
  },
  {
    name: "aluguel_vencimento_hoje",
    category: "UTILITY",
    language: "pt_BR",
    body: "Olá, {{1}}. Informamos que o aluguel referente a {{2}}, no valor de {{3}}, vence hoje, {{4}}.\n\nCaso o pagamento já tenha sido realizado, desconsidere esta mensagem.",
    example: ["João", "Apartamento 101", "R$ 1.200,00", "10/09/2026"]
  },
  {
    name: "aluguel_atrasado_5_dias",
    category: "UTILITY",
    language: "pt_BR",
    body: "Olá, {{1}}. Identificamos que o aluguel referente a {{2}}, no valor de {{3}}, com vencimento em {{4}}, continua pendente.\n\nPedimos que verifique a situação do pagamento. Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.",
    example: ["João", "Apartamento 101", "R$ 1.200,00", "10/09/2026"]
  },
  {
    name: "aluguel_confirmacao_pagamento",
    category: "UTILITY",
    language: "pt_BR",
    body: "Olá, {{1}}. Confirmamos o recebimento do aluguel referente a {{2}}, no valor de {{3}}, pago em {{4}}.\n\nObrigado. Seu pagamento foi registrado com sucesso.",
    example: ["João", "Apartamento 101", "R$ 1.200,00", "10/09/2026"]
  }
];

async function respostaMeta(resposta) {
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(json?.error?.message || `Erro da Meta (HTTP ${resposta.status}).`);
  }
  return json;
}

async function listarTemplates({ wabaId, accessToken, apiVersion }) {
  const encontrados = [];
  let url = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`);
  url.searchParams.set("fields", "name,language,status");
  url.searchParams.set("limit", "100");

  while (url) {
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    });
    const json = await respostaMeta(resposta);
    encontrados.push(...(Array.isArray(json?.data) ? json.data : []));
    url = json?.paging?.next ? new URL(json.paging.next) : null;
  }

  return encontrados;
}

async function criarTemplate({ wabaId, accessToken, apiVersion, template }) {
  const resposta = await fetch(
    `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: template.name,
        category: template.category,
        language: template.language,
        components: [{
          type: "BODY",
          text: template.body,
          example: { body_text: [template.example] }
        }]
      }),
      cache: "no-store"
    }
  );
  return respostaMeta(resposta);
}

export async function garantirTemplatesWhatsAppPadrao({
  wabaId,
  accessToken,
  apiVersion = "v26.0"
}) {
  if (!wabaId || !accessToken) throw new Error("Conexão do WhatsApp incompleta.");

  const existentes = await listarTemplates({ wabaId, accessToken, apiVersion });
  const chaves = new Set(existentes.map(item => `${item.name}:${item.language}`));
  const criados = [];
  const jaExistiam = [];

  for (const template of TEMPLATES_WHATSAPP_PADRAO) {
    const chave = `${template.name}:${template.language}`;
    if (chaves.has(chave)) {
      jaExistiam.push(template.name);
      continue;
    }
    await criarTemplate({ wabaId, accessToken, apiVersion, template });
    criados.push(template.name);
  }

  return { criados, jaExistiam, total: TEMPLATES_WHATSAPP_PADRAO.length };
}
