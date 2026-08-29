export function normalizarNumeroWhatsApp(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return "";

  const semPrefixoInternacional = digitos.startsWith("55") ? digitos.slice(2) : digitos;
  if (semPrefixoInternacional.length < 10 || semPrefixoInternacional.length > 11) return "";

  return `55${semPrefixoInternacional}`;
}

export function abrirWhatsApp({ telefone, mensagem = "" }) {
  const numero = normalizarNumeroWhatsApp(telefone);
  if (!numero) {
    return {
      ok: false,
      erro: "Telefone inválido ou não cadastrado. Verifique o cadastro antes de abrir o WhatsApp."
    };
  }

  const texto = String(mensagem || "").trim();
  const url = texto
    ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${numero}`;

  window.open(url, "_blank", "noopener,noreferrer");
  return { ok: true };
}
