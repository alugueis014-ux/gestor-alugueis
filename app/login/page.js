"use client";

import "../ui-standard.css";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

export default function Login() {
  const router = useRouter();

  const [modo, setModo] = useState("entrar");
  const [nome, setNome] = useState("");
  const [empresaNome, setEmpresaNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(false);

  function limparMensagens() {
    setErro("");
    setMensagem("");
  }

  function mudarModo(novoModo) {
    setModo(novoModo);
    limparMensagens();
    setSenha("");
  }

  async function entrar(e) {
    e.preventDefault();
    limparMensagens();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha
      });

      if (error) {
        throw new Error("E-mail ou senha inválidos.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setErro(e.message || "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function criarConta(e) {
    e.preventDefault();
    limparMensagens();

    if (!nome.trim()) return setErro("Informe seu nome.");
    if (!empresaNome.trim()) {
      return setErro("Informe o nome da empresa ou residencial.");
    }
    if (senha.length < 6) {
      return setErro("A senha deve ter pelo menos 6 caracteres.");
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: senha,
        options: {
          data: {
            nome: nome.trim(),
            empresa_nome: empresaNome.trim()
          }
        }
      });

      if (error) {
        throw new Error(error.message || "Não foi possível criar a conta.");
      }

      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setMensagem(
        "Conta criada. Verifique seu e-mail para confirmar o cadastro e depois entre no sistema."
      );
      setModo("entrar");
      setSenha("");
    } catch (e) {
      setErro(e.message || "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
    }
  }

  async function recuperarSenha(e) {
    e.preventDefault();
    limparMensagens();

    if (!email.trim()) {
      return setErro("Informe o e-mail da sua conta.");
    }

    setLoading(true);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/redefinir-senha`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo }
      );

      if (error) throw error;

      setMensagem(
        "Enviamos um link de recuperação para o seu e-mail. Abra a mensagem e clique no link para criar uma nova senha."
      );
    } catch (e) {
      setErro(
        e.message || "Não foi possível enviar o e-mail de recuperação."
      );
    } finally {
      setLoading(false);
    }
  }

  const titulo =
    modo === "entrar"
      ? "Acesse sua conta"
      : modo === "cadastro"
        ? "Crie sua conta de gestão"
        : "Recupere sua senha";

  return (
    <div className="login-page auth-page">
      <div className="login-card auth-card">
        <div className="auth-brand">
          <img
            src="/alugue-facil-logo.svg"
            alt="Alugue Fácil"
            className="auth-brand-logo"
          />
          <p>{titulo}</p>
        </div>

        {modo !== "recuperar" && (
          <div className="login-tabs">
            <button
              type="button"
              className={modo === "entrar" ? "login-tab active" : "login-tab"}
              onClick={() => mudarModo("entrar")}
            >
              Entrar
            </button>

            <button
              type="button"
              className={modo === "cadastro" ? "login-tab active" : "login-tab"}
              onClick={() => mudarModo("cadastro")}
            >
              Criar conta
            </button>
          </div>
        )}

        <form
          className="auth-form"
          onSubmit={
            modo === "entrar"
              ? entrar
              : modo === "cadastro"
                ? criarConta
                : recuperarSenha
          }
        >
          {modo === "cadastro" && (
            <>
              <label>
                Seu nome
                <input
                  type="text"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Digite seu nome"
                  required
                />
              </label>

              <label>
                Empresa / Residencial
                <input
                  type="text"
                  value={empresaNome}
                  onChange={e => setEmpresaNome(e.target.value)}
                  placeholder="Ex.: Residencial São José"
                  required
                />
              </label>
            </>
          )}

          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              autoComplete="email"
              required
            />
          </label>

          {modo !== "recuperar" && (
            <label>
              Senha
              <div className="password-field">
                <input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="Digite sua senha"
                  minLength={6}
                  autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setMostrarSenha(v => !v)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                >
                  <Icon name={mostrarSenha ? "eyeOff" : "eye"} size={18} />
                </button>
              </div>
            </label>
          )}

          {modo === "entrar" && (
            <div className="forgot-row">
              <button
                type="button"
                className="forgot-button"
                onClick={() => mudarModo("recuperar")}
              >
                Esqueci minha senha
              </button>
            </div>
          )}

          {erro && <div className="error auth-message">{erro}</div>}

          {mensagem && (
            <div className="login-success auth-message">{mensagem}</div>
          )}

          <button className="primary auth-submit" disabled={loading}>
            {loading
              ? modo === "entrar"
                ? "Entrando..."
                : modo === "cadastro"
                  ? "Criando conta..."
                  : "Enviando..."
              : modo === "entrar"
                ? "Entrar"
                : modo === "cadastro"
                  ? "Criar minha conta"
                  : "Enviar link de recuperação"}
          </button>

          {modo === "recuperar" && (
            <button
              type="button"
              className="back-login"
              onClick={() => mudarModo("entrar")}
              disabled={loading}
            >
              ← Voltar para o login
            </button>
          )}
        </form>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 28px 16px;
          background:
            radial-gradient(circle at top left, rgba(23,79,122,.10), transparent 34%),
            #f4f7fb;
        }

        .auth-card {
          width: min(440px, 100%);
          padding: 30px;
        }

        .auth-brand {
          text-align: center;
          margin-bottom: 22px;
        }

        .auth-brand-logo {
          width: 245px;
          max-width: 88%;
          height: auto;
          display: block;
          margin: 0 auto 6px;
        }

        .auth-brand p {
          margin: 7px 0 0;
          color: #5f7087;
          font-size: 14px;
        }

        .login-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin: 0 0 22px;
          padding: 5px;
          background: #eef3f8;
          border-radius: 10px;
        }

        .login-tab {
          min-height: 40px !important;
          border: 0 !important;
          border-radius: 8px !important;
          padding: 9px 12px !important;
          background: transparent !important;
          color: #52677a !important;
          font-weight: 700 !important;
          cursor: pointer;
        }

        .login-tab.active {
          background: #fff !important;
          color: #17324d !important;
          box-shadow: 0 2px 7px rgba(30,60,90,.12);
        }

        .auth-form {
          display: grid;
          gap: 15px;
        }

        .auth-form label {
          display: grid;
          gap: 7px;
          margin: 0;
        }


        .password-field {
          position: relative;
        }

        .password-field input {
          padding-right: 46px !important;
        }

        .password-toggle {
          position: absolute;
          top: 50%;
          right: 10px;
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
          cursor: pointer;
        }

        .password-toggle:hover {
          background: #eef4f9 !important;
          border-radius: 8px !important;
        }

        .forgot-row {
          display: flex;
          justify-content: flex-end;
          margin-top: -5px;
        }

        .forgot-button,
        .back-login {
          min-height: auto !important;
          padding: 2px 0 !important;
          border: 0 !important;
          background: transparent !important;
          color: #174f7a !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          cursor: pointer;
        }

        .forgot-button:hover,
        .back-login:hover {
          text-decoration: underline;
        }

        .auth-message {
          margin: 0 !important;
        }

        .login-success {
          padding: 11px 12px;
          border-radius: 8px;
          background: #ecfdf3;
          border: 1px solid #b7e4c7;
          color: #166534;
          font-size: 14px;
          line-height: 1.4;
        }

        .auth-submit {
          width: 100%;
          margin-top: 2px;
          min-height: 44px !important;
        }

        .back-login {
          justify-self: center;
          margin-top: 2px;
        }

        @media (max-width: 520px) {
          .auth-card {
            padding: 23px 18px;
          }

          .auth-brand h1 {
            font-size: 25px;
          }
        }
      `}</style>
    </div>
  );
}
