"use client";

import "../ui-standard.css";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

export default function RedefinirSenha() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessaoValida, setSessaoValida] = useState(null);

  useEffect(() => {
    let ativo = true;

    async function verificar() {
      const { data } = await supabase.auth.getSession();

      if (ativo) {
        setSessaoValida(!!data.session);
      }
    }

    verificar();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!ativo) return;

      if (event === "PASSWORD_RECOVERY" || session) {
        setSessaoValida(true);
      }
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, []);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    setMensagem("");

    if (senha.length < 6) {
      return setErro("A nova senha deve ter pelo menos 6 caracteres.");
    }

    if (senha !== confirmacao) {
      return setErro("As senhas informadas não são iguais.");
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: senha
      });

      if (error) throw error;

      setMensagem("Senha alterada com sucesso. Você já pode entrar com a nova senha.");
      setSenha("");
      setConfirmacao("");

      setTimeout(async () => {
        await supabase.auth.signOut({ scope: "local" });
        router.replace("/login");
        router.refresh();
      }, 1800);
    } catch (e) {
      setErro(
        e.message ||
          "Não foi possível alterar a senha. Solicite um novo link de recuperação."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="reset-page">
      <div className="reset-card">
        <img
          src="/alugue-facil-logo.svg"
          alt="Alugue Fácil"
          className="reset-brand-logo"
        />
        <h1>Redefinir senha</h1>
        <p>Crie uma nova senha para acessar sua conta.</p>

        {sessaoValida === false && (
          <div className="error reset-message">
            Este link de recuperação é inválido ou expirou. Volte ao login e solicite um novo link.
          </div>
        )}

        {sessaoValida === null && (
          <div className="reset-loading">Validando link de recuperação...</div>
        )}

        {sessaoValida && (
          <form onSubmit={salvar}>
            <label>
              Nova senha
              <div className="password-field">
                <input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
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

            <label>
              Confirmar nova senha
              <div className="password-field">
                <input
                  type={mostrarConfirmacao ? "text" : "password"}
                  value={confirmacao}
                  onChange={e => setConfirmacao(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setMostrarConfirmacao(v => !v)}
                  aria-label={mostrarConfirmacao ? "Ocultar senha" : "Mostrar senha"}
                  title={mostrarConfirmacao ? "Ocultar senha" : "Mostrar senha"}
                >
                  <Icon name={mostrarConfirmacao ? "eyeOff" : "eye"} size={18} />
                </button>
              </div>
            </label>

            {erro && <div className="error reset-message">{erro}</div>}
            {mensagem && <div className="reset-success reset-message">{mensagem}</div>}

            <button className="primary" disabled={loading || !!mensagem}>
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}

        <button
          type="button"
          className="back-button"
          onClick={() => router.replace("/login")}
        >
          ← Voltar para o login
        </button>
      </div>

      <style jsx>{`
        .reset-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 28px 16px;
          background:
            radial-gradient(circle at top left, rgba(23,79,122,.10), transparent 34%),
            #f4f7fb;
        }

        .reset-card {
          width: min(440px, 100%);
          padding: 30px;
          background: #fff;
          border: 1px solid #d5e0ec;
          border-radius: 14px;
          box-shadow: 0 16px 40px rgba(15,35,63,.10);
          color: #10233f;
        }

        .reset-brand-logo {
          width: 245px;
          max-width: 88%;
          height: auto;
          display: block;
          margin: 0 auto 14px;
        }

        h1 {
          margin: 0;
          text-align: center;
          font-size: 28px;
          line-height: 1.15;
          font-weight: 800;
          letter-spacing: -.02em;
        }

        p {
          margin: 7px 0 22px;
          text-align: center;
          color: #5f7087;
          font-size: 14px;
        }

        form {
          display: grid;
          gap: 15px;
        }

        label {
          display: grid;
          gap: 7px;
        }

        form .primary {
          width: 100%;
          min-height: 44px !important;
          margin-top: 2px;
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

        .reset-message {
          margin: 0 !important;
        }

        .reset-success {
          padding: 11px 12px;
          border-radius: 8px;
          background: #ecfdf3;
          border: 1px solid #b7e4c7;
          color: #166534;
          font-size: 14px;
          line-height: 1.4;
        }

        .reset-loading {
          padding: 12px;
          text-align: center;
          color: #5f7087;
          font-size: 14px;
        }

        .back-button {
          display: block;
          margin: 18px auto 0;
          min-height: auto !important;
          padding: 2px 0 !important;
          border: 0 !important;
          background: transparent !important;
          color: #174f7a !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          cursor: pointer;
        }

        .back-button:hover {
          text-decoration: underline;
        }

        @media (max-width: 520px) {
          .reset-card {
            padding: 23px 18px;
          }

          h1 {
            font-size: 25px;
          }
        }
      `}</style>
    </div>
  );
}
