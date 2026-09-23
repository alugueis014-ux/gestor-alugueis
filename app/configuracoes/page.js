"use client";

import "../ui-standard.css";

import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

export default function Configuracoes() {
  const [empresaId, setEmpresaId] = useState(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [empresaNome, setEmpresaNome] = useState("");
  const [empresaRazaoSocial, setEmpresaRazaoSocial] = useState("");
  const [empresaDocumento, setEmpresaDocumento] = useState("");
  const [empresaTelefone, setEmpresaTelefone] = useState("");
  const [empresaEmail, setEmpresaEmail] = useState("");
  const [empresaCep, setEmpresaCep] = useState("");
  const [empresaEndereco, setEmpresaEndereco] = useState("");
  const [empresaNumero, setEmpresaNumero] = useState("");
  const [empresaComplemento, setEmpresaComplemento] = useState("");
  const [empresaBairro, setEmpresaBairro] = useState("");
  const [empresaCidade, setEmpresaCidade] = useState("");
  const [empresaEstado, setEmpresaEstado] = useState("");

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);

  const [carregando, setCarregando] = useState(true);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [whatsapp, setWhatsapp] = useState(null);
  const [carregandoWhatsapp, setCarregandoWhatsapp] = useState(false);
  const [conectandoWhatsapp, setConectandoWhatsapp] = useState(false);
  const [telefoneTesteWhatsapp, setTelefoneTesteWhatsapp] = useState("");
  const [enviandoTesteWhatsapp, setEnviandoTesteWhatsapp] = useState(false);
  const [sincronizandoTemplates, setSincronizandoTemplates] = useState(false);
  const [metaSessao, setMetaSessao] = useState({ wabaId: "", phoneNumberId: "" });
  const [abaAtiva, setAbaAtiva] = useState("empresa");

  function somenteDigitos(valor = "") {
    return String(valor).replace(/\D/g, "");
  }

  function mascararTelefone(valor = "") {
    const n = somenteDigitos(valor).slice(0, 11);
    if (n.length <= 2) return n;
    if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
    if (n.length <= 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  }

  function mascararDocumento(valor = "") {
    const n = somenteDigitos(valor).slice(0, 14);
    if (n.length <= 11) {
      return n
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return n
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function mascararCep(valor = "") {
    const n = somenteDigitos(valor).slice(0, 8);
    return n.replace(/(\d{5})(\d)/, "$1-$2");
  }

  useEffect(() => {
    carregar();
  }, []);

  function origemMetaValida(origem = "") {
    try {
      const hostname = new URL(origem).hostname.toLowerCase();
      return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
    } catch {
      return false;
    }
  }

  function extrairSessaoMeta(event) {
    if (!origemMetaValida(event?.origin)) return null;
    try {
      const dados = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (dados?.type !== "WA_EMBEDDED_SIGNUP") return null;
      if (![
        "FINISH",
        "FINISH_ONLY_WABA",
        "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ].includes(dados?.event)) return null;
      return {
        wabaId: dados?.data?.waba_id || "",
        phoneNumberId: dados?.data?.phone_number_id || ""
      };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    function receberEventoMeta(event) {
      const sessao = extrairSessaoMeta(event);
      if (!sessao) return;
      window.__aluguelFacilMetaSessao = sessao;
      setMetaSessao(sessao);
    }

    window.addEventListener("message", receberEventoMeta);
    return () => window.removeEventListener("message", receberEventoMeta);
  }, []);

  async function obterEmpresaId(userId) {
    let consulta = await supabase
      .from("empresa_usuarios")
      .select("empresa_id")
      .eq("usuario_id", userId)
      .limit(1)
      .maybeSingle();

    if (
      consulta.error &&
      /usuario_id|column|schema cache/i.test(consulta.error.message || "")
    ) {
      consulta = await supabase
        .from("empresa_usuarios")
        .select("empresa_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
    }

    if (consulta.error) throw consulta.error;
    if (!consulta.data?.empresa_id) {
      throw new Error("Não foi possível identificar a empresa.");
    }

    return consulta.data.empresa_id;
  }

  async function carregar() {
    setCarregando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth?.user) {
        throw new Error("Sessão inválida. Entre novamente no sistema.");
      }

      const user = auth.user;
      const idEmpresa = await obterEmpresaId(user.id);

      const { data: empresa, error: empresaError } = await supabase
        .from("empresas")
        .select("id,nome,razao_social,documento,telefone,email,cep,endereco,numero,complemento,bairro,cidade,estado")
        .eq("id", idEmpresa)
        .single();

      if (empresaError) throw empresaError;

      setEmpresaId(idEmpresa);
      setEmail(user.email || "");
      setNome(user.user_metadata?.nome || "");
      setTelefone(user.user_metadata?.telefone || "");
      setEmpresaNome(empresa?.nome || "");
      setEmpresaRazaoSocial(empresa?.razao_social || "");
      setEmpresaDocumento(mascararDocumento(empresa?.documento || ""));
      setEmpresaTelefone(mascararTelefone(empresa?.telefone || ""));
      setEmpresaEmail(empresa?.email || "");
      setEmpresaCep(mascararCep(empresa?.cep || ""));
      setEmpresaEndereco(empresa?.endereco || "");
      setEmpresaNumero(empresa?.numero || "");
      setEmpresaComplemento(empresa?.complemento || "");
      setEmpresaBairro(empresa?.bairro || "");
      setEmpresaCidade(empresa?.cidade || "");
      setEmpresaEstado((empresa?.estado || "").toUpperCase());
      setTimeout(() => carregarWhatsapp(), 0);
    } catch (e) {
      setErro(e.message || "Não foi possível carregar as configurações.");
    } finally {
      setCarregando(false);
    }
  }

  async function apiWhatsapp(method = "GET", body = null) {
    const { data: sessao } = await supabase.auth.getSession();
    const token = sessao?.session?.access_token;
    if (!token) throw new Error("Sessão inválida. Entre novamente no sistema.");

    const resposta = await fetch("/api/whatsapp/conexao", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const json = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !json?.ok) throw new Error(json?.erro || "Não foi possível concluir a operação.");
    return json;
  }

  async function carregarWhatsapp() {
    setCarregandoWhatsapp(true);
    try {
      const json = await apiWhatsapp("GET");
      setWhatsapp(json.conexao || null);
    } catch (e) {
      if (!/whatsapp_conexoes|relation.*does not exist/i.test(e.message || "")) {
        setErro(e.message || "Não foi possível consultar o WhatsApp.");
      }
    } finally {
      setCarregandoWhatsapp(false);
    }
  }

  async function enviarMensagemTesteWhatsapp() {
    setErro("");
    setMensagem("");
    const telefone = somenteDigitos(telefoneTesteWhatsapp);
    if (!telefone) {
      setErro("Informe o número do WhatsApp que receberá a mensagem de teste.");
      return;
    }

    setEnviandoTesteWhatsapp(true);
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const token = sessao?.session?.access_token;
      if (!token) throw new Error("Sessão inválida. Entre novamente no sistema.");

      const resposta = await fetch("/api/whatsapp/teste", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ telefone })
      });
      const json = await resposta.json().catch(() => ({}));
      if (!resposta.ok || !json?.ok) throw new Error(json?.erro || "Não foi possível enviar a mensagem de teste.");
      setMensagem("Mensagem de teste enviada pelo AlugueFácil. Confira o WhatsApp destinatário.");
    } catch (e) {
      setErro(e.message || "Não foi possível enviar a mensagem de teste.");
    } finally {
      setEnviandoTesteWhatsapp(false);
    }
  }

  async function sincronizarTemplatesWhatsapp() {
    setErro("");
    setMensagem("");
    setSincronizandoTemplates(true);
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const token = sessao?.session?.access_token;
      if (!token) throw new Error("Sessão inválida. Entre novamente no sistema.");

      const resposta = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await resposta.json().catch(() => ({}));
      if (!resposta.ok || !json?.ok) throw new Error(json?.erro || "Não foi possível preparar os modelos padrão.");
      setMensagem(
        json.criados?.length
          ? `${json.criados.length} modelo(s) padrão enviado(s) para análise da Meta.`
          : "Os quatro modelos padrão já existem nesta conta do WhatsApp."
      );
    } catch (e) {
      setErro(e.message || "Não foi possível preparar os modelos padrão.");
    } finally {
      setSincronizandoTemplates(false);
    }
  }

  async function conectarWhatsAppTeste() {
    setErro("");
    setMensagem("");
    setConectandoWhatsapp(true);
    try {
      const json = await apiWhatsapp("POST", { modo: "teste" });
      setWhatsapp(json.conexao || null);
      setMensagem("WhatsApp de teste conectado a esta empresa.");
    } catch (e) {
      setErro(e.message || "Não foi possível conectar o WhatsApp de teste.");
    } finally {
      setConectandoWhatsapp(false);
    }
  }

  function abrirCadastroIncorporadoMeta({ appId, configId, state }) {
    const redirectUri = `${window.location.origin}/meta-whatsapp-callback`;
    const versao = process.env.NEXT_PUBLIC_META_GRAPH_API_VERSION || "v26.0";
    const url = new URL(`https://www.facebook.com/${versao}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("config_id", configId);
    url.searchParams.set("override_default_response_type", "true");
    url.searchParams.set("display", "popup");
    url.searchParams.set("state", state);
    url.searchParams.set("extras", JSON.stringify({
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3",
      version: "v4"
    }));

    const popup = window.open(url.toString(), "aluguel-facil-whatsapp-meta", "width=720,height=760,resizable=yes,scrollbars=yes");
    if (!popup) throw new Error("O navegador bloqueou a janela da Meta. Permita pop-ups para continuar.");
    return { popup, redirectUri };
  }

  async function conectarWhatsApp() {
    setErro("");
    setMensagem("");
    const configId = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID;
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    if (!configId || !appId) {
      setErro("A conexão automática da Meta ainda precisa do Configuration ID do Embedded Signup.");
      return;
    }

    setConectandoWhatsapp(true);
    setMetaSessao({ wabaId: "", phoneNumberId: "" });
    try {
      window.__aluguelFacilMetaSessao = { wabaId: "", phoneNumberId: "" };

      const state = crypto.randomUUID();
      sessionStorage.setItem("aluguelFacilMetaState", state);
      const { popup, redirectUri } = abrirCadastroIncorporadoMeta({ appId, configId, state });

      let resolverSessao;
      const promessaSessao = new Promise(resolve => { resolverSessao = resolve; });
      const receberSessaoDestaConexao = event => {
        const sessao = extrairSessaoMeta(event);
        if (!sessao) return;
        window.__aluguelFacilMetaSessao = sessao;
        setMetaSessao(sessao);
        resolverSessao?.(sessao);
      };
      window.addEventListener("message", receberSessaoDestaConexao);

      const code = await new Promise((resolve, reject) => {
        const limite = setTimeout(() => finalizar(null, new Error("A autorização da Meta demorou demais. Tente novamente.")), 10 * 60 * 1000);
        const vigiarPopup = setInterval(() => {
          if (popup.closed) finalizar(null, new Error("A autorização da Meta foi cancelada ou não foi concluída."));
        }, 500);

        function receberRetorno(event) {
          if (event.origin !== window.location.origin || event.data?.type !== "ALUGUEL_FACIL_META_OAUTH") return;
          if (event.data?.state !== state) return finalizar(null, new Error("A Meta retornou uma autorização inválida. Tente novamente."));
          if (event.data?.error) return finalizar(null, new Error(event.data.error));
          finalizar(event.data?.code || "");
        }

        function finalizar(valor, falha = null) {
          clearTimeout(limite);
          clearInterval(vigiarPopup);
          window.removeEventListener("message", receberRetorno);
          sessionStorage.removeItem("aluguelFacilMetaState");
          if (falha) reject(falha);
          else if (!valor) reject(new Error("A autorização da Meta não retornou o código esperado."));
          else resolve(valor);
        }

        window.addEventListener("message", receberRetorno);
      });

      const sessaoEvento = await Promise.race([
        promessaSessao,
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
      ]);
      window.removeEventListener("message", receberSessaoDestaConexao);

      const sessao = sessaoEvento || window.__aluguelFacilMetaSessao || metaSessao || {};
      const wabaId = sessao?.wabaId || "";
      const phoneNumberId = sessao?.phoneNumberId || "";

      // Mesmo quando a Meta não entrega o evento FINISH ao navegador, o servidor
      // consegue descobrir os ativos autorizados a partir do token gerado pelo code.
      const json = await apiWhatsapp("POST", { code, wabaId, phoneNumberId, redirectUri });
      setWhatsapp(json.conexao || null);
      setMensagem("WhatsApp conectado com sucesso.");
    } catch (e) {
      setErro(e.message || "Não foi possível conectar o WhatsApp.");
    } finally {
      setConectandoWhatsapp(false);
    }
  }

  async function desconectarWhatsApp() {
    if (!window.confirm("Desconectar o WhatsApp desta empresa? Os lembretes automáticos deixarão de ser enviados.")) return;
    setErro("");
    setMensagem("");
    setConectandoWhatsapp(true);
    try {
      await apiWhatsapp("DELETE");
      setWhatsapp(null);
      setMensagem("WhatsApp desconectado.");
    } catch (e) {
      setErro(e.message || "Não foi possível desconectar o WhatsApp.");
    } finally {
      setConectandoWhatsapp(false);
    }
  }

  async function salvarPerfil(e) {
    e.preventDefault();
    setErro("");
    setMensagem("");
    setSalvandoPerfil(true);

    try {
      if (!nome.trim()) throw new Error("Informe seu nome.");
      if (!email.trim()) throw new Error("Informe seu e-mail.");
      if (!empresaNome.trim()) throw new Error("Informe o nome do residencial/empresa.");

      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth?.user) throw new Error("Sessão inválida.");

      const emailAtual = auth.user.email || "";

      const { error: userError } = await supabase.auth.updateUser({
        ...(email.trim() !== emailAtual ? { email: email.trim() } : {}),
        data: {
          ...auth.user.user_metadata,
          nome: nome.trim(),
          telefone: telefone.trim()
        }
      });

      if (userError) throw userError;

      const { error: empresaError } = await supabase
        .from("empresas")
        .update({
          nome: empresaNome.trim(),
          razao_social: empresaRazaoSocial.trim() || null,
          documento: somenteDigitos(empresaDocumento) || null,
          telefone: somenteDigitos(empresaTelefone) || null,
          email: empresaEmail.trim() || null,
          cep: somenteDigitos(empresaCep) || null,
          endereco: empresaEndereco.trim() || null,
          numero: empresaNumero.trim() || null,
          complemento: empresaComplemento.trim() || null,
          bairro: empresaBairro.trim() || null,
          cidade: empresaCidade.trim() || null,
          estado: empresaEstado.trim().toUpperCase() || null
        })
        .eq("id", empresaId);

      if (empresaError) throw empresaError;

      setMensagem(
        email.trim() !== emailAtual
          ? "Dados salvos. Verifique seu e-mail para confirmar a alteração do endereço de acesso."
          : "Dados atualizados com sucesso."
      );
    } catch (e) {
      setErro(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function alterarSenha(e) {
    e.preventDefault();
    setErro("");
    setMensagem("");

    if (novaSenha.length < 6) {
      return setErro("A nova senha deve ter pelo menos 6 caracteres.");
    }

    if (novaSenha !== confirmarSenha) {
      return setErro("As senhas informadas não são iguais.");
    }

    setSalvandoSenha(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: novaSenha
      });

      if (error) throw error;

      setNovaSenha("");
      setConfirmarSenha("");
      setMensagem("Senha alterada com sucesso.");
    } catch (e) {
      setErro(e.message || "Não foi possível alterar a senha.");
    } finally {
      setSalvandoSenha(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="settings-page">
          <div className="settings-heading">
            <span className="settings-kicker">Sistema</span>
            <h2>Configurações</h2>
            <p>Gerencie os dados da empresa, a integração com WhatsApp e a segurança da sua conta.</p>
          </div>

          {carregando ? (
            <div className="panel settings-loading">Carregando configurações...</div>
          ) : (
            <div className="settings-layout">
              <aside className="settings-nav" aria-label="Seções das configurações">
                <button type="button" className={abaAtiva === "empresa" ? "active" : ""} onClick={() => setAbaAtiva("empresa")}>
                  <span className="settings-nav-icon"><Icon name="user" size={18} /></span>
                  <span>Dados da empresa</span>
                </button>
                <button type="button" className={abaAtiva === "whatsapp" ? "active" : ""} onClick={() => setAbaAtiva("whatsapp")}>
                  <span className="settings-nav-icon"><Icon name="whatsapp" size={18} /></span>
                  <span>WhatsApp</span>
                  <span className={`settings-nav-status ${whatsapp?.status === "conectado" ? "online" : ""}`} />
                </button>
                <div className="settings-nav-divider" />
                <button type="button" className={abaAtiva === "seguranca" ? "active" : ""} onClick={() => setAbaAtiva("seguranca")}>
                  <span className="settings-nav-icon"><Icon name="lock" size={18} /></span>
                  <span>Segurança</span>
                </button>
              </aside>

              <section className="settings-content">
                {abaAtiva === "empresa" && (
                  <form onSubmit={salvarPerfil}>
                    <div className="content-head">
                      <span>EMPRESA</span>
                      <h3>Dados da empresa</h3>
                      <p>Mantenha completos os dados usados nos contratos, relatórios, comunicações e documentos do Aluguel Fácil.</p>
                    </div>

                    <div className="company-section">
                      <div className="section-title"><h4>Identificação</h4><p>Dados principais da empresa, residencial ou proprietário.</p></div>
                      <div className="content-box no-top">
                        <div className="settings-form two-cols">
                          <label>Nome da empresa / residencial *<input value={empresaNome} onChange={e => setEmpresaNome(e.target.value)} placeholder="Nome para exibição" required /></label>
                          <label>Razão social<input value={empresaRazaoSocial} onChange={e => setEmpresaRazaoSocial(e.target.value)} placeholder="Opcional para pessoa jurídica" /></label>
                          <label>CPF / CNPJ<input value={empresaDocumento} onChange={e => setEmpresaDocumento(mascararDocumento(e.target.value))} placeholder="CPF ou CNPJ" inputMode="numeric" /></label>
                          <label>E-mail da empresa<input type="email" value={empresaEmail} onChange={e => setEmpresaEmail(e.target.value)} placeholder="contato@empresa.com.br" /></label>
                          <label>Celular / WhatsApp da empresa<input value={empresaTelefone} onChange={e => setEmpresaTelefone(mascararTelefone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" /></label>
                        </div>
                      </div>
                    </div>

                    <div className="company-section">
                      <div className="section-title"><h4>Endereço</h4><p>Endereço principal para identificação e emissão de documentos.</p></div>
                      <div className="content-box no-top">
                        <div className="settings-form address-grid">
                          <label className="cep-field">CEP<input value={empresaCep} onChange={e => setEmpresaCep(mascararCep(e.target.value))} placeholder="00000-000" inputMode="numeric" /></label>
                          <label className="street-field">Endereço<input value={empresaEndereco} onChange={e => setEmpresaEndereco(e.target.value)} placeholder="Rua, avenida, travessa..." /></label>
                          <label>Número<input value={empresaNumero} onChange={e => setEmpresaNumero(e.target.value)} placeholder="Nº" /></label>
                          <label>Complemento<input value={empresaComplemento} onChange={e => setEmpresaComplemento(e.target.value)} placeholder="Sala, bloco, complemento" /></label>
                          <label>Bairro<input value={empresaBairro} onChange={e => setEmpresaBairro(e.target.value)} placeholder="Bairro" /></label>
                          <label>Cidade<input value={empresaCidade} onChange={e => setEmpresaCidade(e.target.value)} placeholder="Cidade" /></label>
                          <label>UF<input value={empresaEstado} onChange={e => setEmpresaEstado(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase())} placeholder="UF" maxLength={2} /></label>
                        </div>
                      </div>
                    </div>

                    <div className="company-section">
                      <div className="section-title"><h4>Responsável pela conta</h4><p>Dados pessoais utilizados para acesso e administração do sistema.</p></div>
                      <div className="content-box no-top">
                        <div className="settings-form two-cols">
                          <label>Nome do responsável *<input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" required /></label>
                          <label>Celular do responsável<input value={telefone} onChange={e => setTelefone(mascararTelefone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" /></label>
                          <label className="full-field">E-mail de acesso *<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" required /></label>
                        </div>
                      </div>
                    </div>

                    <div className="content-actions"><button className="primary settings-save" disabled={salvandoPerfil}>{salvandoPerfil ? "Salvando..." : "Salvar alterações"}</button></div>
                  </form>
                )}

                {abaAtiva === "whatsapp" && (
                  <div>
                    <div className="content-head">
                      <span>INTEGRAÇÃO</span>
                      <h3>WhatsApp</h3>
                      <p>Conecte o número da empresa para enviar avisos automáticos aos inquilinos.</p>
                    </div>
                    {carregandoWhatsapp ? <div className="content-box whatsapp-loading">Consultando conexão...</div> : whatsapp?.status === "conectado" ? (
                      <>
                        <div className="connection-card connected">
                          <div className="connection-main">
                            <span className="connection-logo"><Icon name="whatsapp" size={25} /></span>
                            <div><div className="status-label"><span className="status-dot" /> CONECTADO</div><h4>WhatsApp conectado</h4><p>{whatsapp.numero_exibicao || "Número autorizado pela Meta"}</p></div>
                          </div>
                          {whatsapp.nome_conta && <div className="account-chip">Conta: <strong>{whatsapp.nome_conta}</strong></div>}
                        </div>
                        <div className="automation-box">
                          <div className="automation-head"><h4>Automações de cobrança</h4><p>Mensagens que o Aluguel Fácil pode enviar automaticamente.</p></div>
                          <div className="automation-grid">
                            <div><b>✓</b><span><strong>5 dias antes</strong><small>Lembrete antes do vencimento</small></span></div>
                            <div><b>✓</b><span><strong>No vencimento</strong><small>Aviso no dia programado</small></span></div>
                            <div><b>✓</b><span><strong>5 dias depois</strong><small>Somente se continuar pendente</small></span></div>
                            <div><b>✓</b><span><strong>Pagamento confirmado</strong><small>Confirmação após registrar a baixa</small></span></div>
                          </div>
                        </div>
                        <div className="content-actions left">
                          <button type="button" className="secondary" onClick={sincronizarTemplatesWhatsapp} disabled={sincronizandoTemplates}>
                            {sincronizandoTemplates ? "Preparando modelos..." : "Preparar modelos padrão"}
                          </button>
                          <button type="button" className="danger whatsapp-disconnect" onClick={desconectarWhatsApp} disabled={conectandoWhatsapp}>{conectandoWhatsapp ? "Desconectando..." : "Desconectar WhatsApp"}</button>
                        </div>
                      </>
                    ) : (
                      <div className="connection-card empty">
                        <span className="connection-logo"><Icon name="whatsapp" size={28} /></span>
                        <div className="empty-copy"><div className="status-label offline"><span className="status-dot" /> NÃO CONECTADO</div><h4>Conecte o WhatsApp da empresa</h4><p>Cada empresa conecta o próprio número. A conexão fica vinculada somente a esta empresa.</p></div>
                        <div className="connect-actions">
                          <button type="button" className="primary" onClick={conectarWhatsApp} disabled={conectandoWhatsapp}>{conectandoWhatsapp ? "Conectando..." : "Conectar WhatsApp"}</button>
                          {process.env.NEXT_PUBLIC_WHATSAPP_PERMITIR_TESTE === "true" && <button type="button" className="secondary" onClick={conectarWhatsAppTeste} disabled={conectandoWhatsapp}>Usar número de teste da Meta</button>}
                        </div>
                      </div>
                    )}

                  {process.env.NEXT_PUBLIC_WHATSAPP_PERMITIR_TESTE === "true" && (
                    <div className="review-test-box">
                      <div>
                        <div className="status-label offline"><span className="status-dot" /> TESTE PARA ANÁLISE DA META</div>
                        <h4>Enviar mensagem de teste</h4>
                        <p>Use este recurso durante a gravação da análise do app. Informe um número autorizado a receber mensagens e envie diretamente pelo AlugueFácil.</p>
                      </div>
                      <div className="review-test-actions">
                        <input
                          value={telefoneTesteWhatsapp}
                          onChange={e => setTelefoneTesteWhatsapp(mascararTelefone(e.target.value))}
                          placeholder="(00) 00000-0000"
                          inputMode="tel"
                          aria-label="WhatsApp destinatário do teste"
                        />
                        <button type="button" className="primary" onClick={enviarMensagemTesteWhatsapp} disabled={enviandoTesteWhatsapp}>
                          {enviandoTesteWhatsapp ? "Enviando..." : "Enviar mensagem de teste"}
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                )}

                {abaAtiva === "seguranca" && (
                  <form onSubmit={alterarSenha}>
                    <div className="content-head"><span>CONTA</span><h3>Segurança</h3><p>Altere a senha utilizada para acessar o Aluguel Fácil.</p></div>
                    <div className="content-box password-box">
                      <div className="settings-form">
                        <label>Nova senha<div className="settings-password"><input type={mostrarSenha ? "text" : "password"} value={novaSenha} onChange={e => setNovaSenha(e.target.value)} minLength={6} autoComplete="new-password" required /><button type="button" className="settings-eye" onClick={() => setMostrarSenha(v => !v)} aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}><Icon name={mostrarSenha ? "eyeOff" : "eye"} size={18} /></button></div></label>
                        <label>Confirmar nova senha<div className="settings-password"><input type={mostrarConfirmacao ? "text" : "password"} value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)} minLength={6} autoComplete="new-password" required /><button type="button" className="settings-eye" onClick={() => setMostrarConfirmacao(v => !v)} aria-label={mostrarConfirmacao ? "Ocultar senha" : "Mostrar senha"}><Icon name={mostrarConfirmacao ? "eyeOff" : "eye"} size={18} /></button></div></label>
                      </div>
                    </div>
                    <div className="content-actions"><button className="primary settings-save" disabled={salvandoSenha}>{salvandoSenha ? "Alterando..." : "Alterar senha"}</button></div>
                  </form>
                )}
              </section>
            </div>
          )}

          {erro && <div className="error settings-message">{erro}</div>}
          {mensagem && <div className="settings-success settings-message">{mensagem}</div>}
        </div>

        <style jsx>{`
          .settings-page{display:grid;gap:20px}.settings-heading{border-left:4px solid var(--ga-primary);padding:2px 0 2px 14px}.settings-kicker,.content-head>span{display:block;color:var(--ga-primary);font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.settings-heading h2{margin:3px 0 2px;font-size:29px;line-height:1.15;color:var(--ga-text)}.settings-heading p,.content-head p{margin:4px 0 0;color:var(--ga-text-soft);font-size:13px}.settings-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;align-items:start}.settings-nav,.settings-content{background:#fff;border:1px solid var(--ga-border);border-radius:14px;box-shadow:var(--ga-shadow)}.settings-nav{padding:8px;display:grid;gap:5px}.settings-nav button{width:100%;border:0!important;background:transparent!important;color:var(--ga-text)!important;display:flex!important;align-items:center!important;gap:10px!important;text-align:left;padding:10px 11px!important;min-height:46px!important;box-shadow:none!important}.settings-nav button:hover{background:var(--ga-primary-soft)!important}.settings-nav button.active{background:var(--ga-primary)!important;color:#fff!important}.settings-nav-icon{width:27px;height:27px;display:grid;place-items:center;border-radius:7px;background:rgba(25,118,210,.08)}.settings-nav button.active .settings-nav-icon{background:rgba(255,255,255,.16)}.settings-nav-status{margin-left:auto;width:8px;height:8px;border-radius:50%;background:#94a3b8}.settings-nav-status.online{background:#22c55e}.settings-nav-divider{height:1px;background:var(--ga-border);margin:5px 3px}.settings-content{min-height:430px;padding:20px}.content-head{padding-bottom:17px;border-bottom:1px solid var(--ga-border)}.content-head h3{margin:5px 0 0;font-size:22px;color:var(--ga-text)}.content-box{margin-top:18px;padding:17px;border:1px solid var(--ga-border);border-radius:12px;background:#fff}.settings-form{display:grid;gap:15px}.settings-form.two-cols{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.settings-form label{display:grid;gap:7px}.content-actions{display:flex;justify-content:flex-end;padding-top:18px}.content-actions.left{justify-content:flex-start}.settings-save{min-width:155px}.settings-password{position:relative}.settings-password input{padding-right:48px!important}.settings-eye{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:34px!important;min-width:34px!important;min-height:34px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;display:grid!important;place-items:center!important}.settings-eye:hover{background:#eef4f9!important}.password-box{max-width:700px}.connection-card{margin-top:18px;border:1px solid var(--ga-border);border-radius:13px;padding:18px;display:flex;align-items:center;gap:15px;background:var(--ga-surface-soft)}.connection-card.connected{border-color:#b9e5ca;background:#f5fcf8}.connection-main{display:flex;align-items:center;gap:14px;flex:1}.connection-logo{width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:#e9f8ef;color:#137333}.connection-card h4,.automation-box h4{margin:4px 0 2px;font-size:16px;color:var(--ga-text)}.connection-card p,.automation-box p{margin:0;color:var(--ga-text-soft);font-size:13px}.status-label{display:flex;align-items:center;gap:7px;color:#18794e;font-size:10px;font-weight:850;letter-spacing:.08em}.status-label.offline{color:#64748b}.status-dot{width:8px;height:8px;border-radius:50%;background:#22c55e}.status-label.offline .status-dot{background:#94a3b8}.account-chip{padding:8px 11px;border:1px solid #cfe9d8;background:#fff;border-radius:8px;color:#475569;font-size:12px}.automation-box{margin-top:14px;border:1px solid var(--ga-border);border-radius:13px;padding:17px}.automation-head{padding-bottom:13px;border-bottom:1px solid var(--ga-border)}.automation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:13px}.automation-grid>div{display:flex;gap:10px;align-items:flex-start;padding:12px;background:var(--ga-surface-soft);border-radius:9px}.automation-grid b{color:#16a34a}.automation-grid span{display:grid;gap:2px}.automation-grid strong{font-size:13px;color:var(--ga-text)}.automation-grid small{font-size:12px;color:var(--ga-text-soft)}.connection-card.empty{align-items:flex-start}.empty-copy{flex:1}.connect-actions{display:flex;gap:8px;align-self:center}.whatsapp-disconnect{background:#dc2626!important;color:#fff!important;border-color:#dc2626!important}.review-test-box{margin-top:14px;border:1px dashed #93c5fd;border-radius:13px;padding:17px;background:#f8fbff;display:grid;gap:14px}.review-test-box h4{margin:5px 0 3px;font-size:16px;color:var(--ga-text)}.review-test-box p{margin:0;color:var(--ga-text-soft);font-size:13px}.review-test-actions{display:grid;grid-template-columns:minmax(220px,320px) auto;gap:10px;align-items:center}.review-test-actions input{width:100%}.settings-success{color:#166534;background:#ecfdf3;border:1px solid #b7e4c7;border-radius:8px;padding:11px 12px;font-size:14px}.settings-message{margin:0}.settings-loading,.whatsapp-loading{color:#64748b}.company-section{margin-top:20px}.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:9px}.section-title h4{margin:0;color:var(--ga-text);font-size:15px}.section-title p{margin:0;color:var(--ga-text-soft);font-size:12px}.content-box.no-top{margin-top:0}.address-grid{grid-template-columns:180px minmax(260px,2fr) 130px minmax(190px,1fr);gap:16px}.address-grid .street-field{grid-column:span 2}.full-field{grid-column:1/-1}
          @media(max-width:900px){.review-test-actions{grid-template-columns:1fr}.settings-layout{grid-template-columns:1fr}.settings-nav{grid-template-columns:1fr 1fr 1fr}.settings-nav-divider{display:none}.settings-nav button{justify-content:center!important}.settings-nav-status{display:none}.settings-content{min-height:0}.settings-form.two-cols,.automation-grid,.address-grid{grid-template-columns:1fr}.address-grid .street-field,.full-field{grid-column:auto}.section-title{align-items:flex-start;flex-direction:column;gap:3px}.connection-card{flex-direction:column;align-items:stretch}.connect-actions{align-self:stretch;flex-direction:column}.content-actions .settings-save{width:100%}}
          @media(max-width:620px){.settings-nav{grid-template-columns:1fr}.settings-nav button{justify-content:flex-start!important}.settings-content{padding:15px}.content-actions{justify-content:stretch}.content-actions button{width:100%}}
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
