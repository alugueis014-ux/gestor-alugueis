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

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);

  const [carregando, setCarregando] = useState(true);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  useEffect(() => {
    carregar();
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
        .select("id,nome")
        .eq("id", idEmpresa)
        .single();

      if (empresaError) throw empresaError;

      setEmpresaId(idEmpresa);
      setEmail(user.email || "");
      setNome(user.user_metadata?.nome || "");
      setTelefone(user.user_metadata?.telefone || "");
      setEmpresaNome(empresa?.nome || "");
    } catch (e) {
      setErro(e.message || "Não foi possível carregar as configurações.");
    } finally {
      setCarregando(false);
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
        .update({ nome: empresaNome.trim() })
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
          <div className="page-header settings-header">
            <div>
              <h2>Configurações</h2>
              <p>Gerencie seus dados de acesso e as informações do residencial.</p>
            </div>
          </div>

          {carregando ? (
            <div className="panel settings-loading">Carregando configurações...</div>
          ) : (
            <div className="settings-grid">
              <form className="panel settings-card" onSubmit={salvarPerfil}>
                <div className="settings-title">
                  <span className="settings-icon"><Icon name="user" size={21} /></span>
                  <div>
                    <h3>Perfil e residencial</h3>
                    <p>Informações utilizadas no seu acesso e no sistema.</p>
                  </div>
                </div>

                <div className="settings-form">
                  <label>
                    Seu nome
                    <input
                      value={nome}
                      onChange={e => setNome(e.target.value)}
                      placeholder="Seu nome"
                      required
                    />
                  </label>

                  <label>
                    Celular / WhatsApp
                    <input
                      value={telefone}
                      onChange={e => setTelefone(e.target.value)}
                      placeholder="(00) 00000-0000"
                      inputMode="tel"
                    />
                  </label>

                  <label>
                    E-mail de acesso
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="seuemail@exemplo.com"
                      required
                    />
                  </label>

                  <label>
                    Nome do residencial / empresa
                    <input
                      value={empresaNome}
                      onChange={e => setEmpresaNome(e.target.value)}
                      placeholder="Nome do residencial"
                      required
                    />
                  </label>
                </div>

                <button className="primary settings-save" disabled={salvandoPerfil}>
                  {salvandoPerfil ? "Salvando..." : "Salvar alterações"}
                </button>
              </form>

              <form className="panel settings-card" onSubmit={alterarSenha}>
                <div className="settings-title">
                  <span className="settings-icon"><Icon name="lock" size={21} /></span>
                  <div>
                    <h3>Alterar senha</h3>
                    <p>Defina uma nova senha para entrar no sistema.</p>
                  </div>
                </div>

                <div className="settings-form">
                  <label>
                    Nova senha
                    <div className="settings-password">
                      <input
                        type={mostrarSenha ? "text" : "password"}
                        value={novaSenha}
                        onChange={e => setNovaSenha(e.target.value)}
                        minLength={6}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="settings-eye"
                        onClick={() => setMostrarSenha(v => !v)}
                        title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                        aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                      >
                        <Icon name={mostrarSenha ? "eyeOff" : "eye"} size={18} />
                      </button>
                    </div>
                  </label>

                  <label>
                    Confirmar nova senha
                    <div className="settings-password">
                      <input
                        type={mostrarConfirmacao ? "text" : "password"}
                        value={confirmarSenha}
                        onChange={e => setConfirmarSenha(e.target.value)}
                        minLength={6}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="settings-eye"
                        onClick={() => setMostrarConfirmacao(v => !v)}
                        title={mostrarConfirmacao ? "Ocultar senha" : "Mostrar senha"}
                        aria-label={mostrarConfirmacao ? "Ocultar senha" : "Mostrar senha"}
                      >
                        <Icon name={mostrarConfirmacao ? "eyeOff" : "eye"} size={18} />
                      </button>
                    </div>
                  </label>
                </div>

                <button className="primary settings-save" disabled={salvandoSenha}>
                  {salvandoSenha ? "Alterando..." : "Alterar senha"}
                </button>
              </form>
            </div>
          )}

          {erro && <div className="error settings-message">{erro}</div>}
          {mensagem && <div className="settings-success settings-message">{mensagem}</div>}
        </div>

        <style jsx>{`
          .settings-page {
            display: grid;
            gap: 18px;
          }

          .settings-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }

          .settings-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr);
            gap: 18px;
            align-items: start;
          }

          .settings-card {
            display: grid;
            gap: 20px;
          }

          .settings-title {
            display: flex;
            align-items: center;
            gap: 12px;
            padding-bottom: 14px;
            border-bottom: 1px solid #e4ebf2;
          }

          .settings-icon {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            background: #e8f1fb;
            border-radius: 11px;
            font-size: 21px;
          }

          .settings-title h3 {
            margin: 0;
            font-size: 18px;
          }

          .settings-title p {
            margin: 4px 0 0;
            color: #64748b;
            font-size: 13px;
          }

          .settings-form {
            display: grid;
            gap: 14px;
          }

          .settings-form label {
            display: grid;
            gap: 7px;
          }

          .settings-save {
            width: fit-content;
            min-width: 160px;
          }

          .settings-password {
            position: relative;
          }

          .settings-password input {
            padding-right: 48px !important;
          }

          .settings-eye {
            position: absolute;
            right: 9px;
            top: 50%;
            transform: translateY(-50%);
            width: 34px !important;
            min-width: 34px !important;
            min-height: 34px !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            display: grid !important;
            place-items: center !important;
            font-size: 18px !important;
          }

          .settings-eye:hover {
            background: #eef4f9 !important;
          }

          .settings-success {
            color: #166534;
            background: #ecfdf3;
            border: 1px solid #b7e4c7;
            border-radius: 8px;
            padding: 11px 12px;
            font-size: 14px;
          }

          .settings-message {
            margin: 0;
          }

          .settings-loading {
            color: #64748b;
          }

          @media (max-width: 900px) {
            .settings-grid {
              grid-template-columns: 1fr;
            }

            .settings-save {
              width: 100%;
            }
          }
        `}</style>
      </AppShell>
    </AuthGuard>
  );
}
