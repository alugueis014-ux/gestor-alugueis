"use client";

import { useEffect, useState } from "react";

export default function MetaWhatsAppCallback() {
  const [mensagem, setMensagem] = useState("Concluindo a conexão com a Meta...");

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.search);
    const code = parametros.get("code") || "";
    const state = parametros.get("state") || "";
    const erro = parametros.get("error_message") || parametros.get("error_description") || "";

    if (!window.opener) {
      setMensagem("Volte ao Aluguel Fácil e tente conectar novamente.");
      return;
    }

    window.opener.postMessage({
      type: "ALUGUEL_FACIL_META_OAUTH",
      code,
      state,
      error: erro
    }, window.location.origin);

    setMensagem(erro ? `A Meta não concluiu a autorização: ${erro}` : "Autorização concluída. Esta janela será fechada.");
    if (!erro) setTimeout(() => window.close(), 500);
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 520, textAlign: "center", padding: 32, border: "1px solid #d7e2ef", borderRadius: 16, background: "#fff" }}>
        <h1 style={{ color: "#0b315c", marginTop: 0 }}>Aluguel Fácil</h1>
        <p style={{ color: "#40556e", marginBottom: 0 }}>{mensagem}</p>
      </section>
    </main>
  );
}
