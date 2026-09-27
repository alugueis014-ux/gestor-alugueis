import { supabase } from "./supabase";

export async function notificarPagamentoWhatsApp(recebimentoId, opcoes = {}) {
  if (!recebimentoId) return { ok: false, ignorado: true };

  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao?.session?.access_token;
  if (!token) return { ok: false, ignorado: true };

  const resposta = await fetch("/api/whatsapp/pagamento", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      recebimentoId,
      forcarReenvio: opcoes.forcarReenvio === true
    })
  });

  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(json?.erro || "Não foi possível enviar a confirmação pelo WhatsApp.");
  }
  return json;
}
