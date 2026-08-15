import { supabase } from "./supabase";

export async function obterEmpresaAtual({ incluirNome = false } = {}) {
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError || !auth?.user) {
    throw new Error("Sessão inválida. Entre novamente no sistema.");
  }

  const campos = incluirNome ? "empresa_id, empresas(nome)" : "empresa_id";

  let consulta = await supabase
    .from("empresa_usuarios")
    .select(campos)
    .eq("usuario_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  if (
    consulta.error &&
    /usuario_id|column|schema cache/i.test(consulta.error.message || "")
  ) {
    consulta = await supabase
      .from("empresa_usuarios")
      .select(campos)
      .eq("user_id", auth.user.id)
      .limit(1)
      .maybeSingle();
  }

  if (consulta.error) throw consulta.error;

  if (!consulta.data?.empresa_id) {
    throw new Error("Usuário não está vinculado a nenhuma empresa.");
  }

  const nome = incluirNome
    ? (
        Array.isArray(consulta.data.empresas)
          ? consulta.data.empresas[0]?.nome
          : consulta.data.empresas?.nome
      ) || ""
    : "";

  return {
    userId: auth.user.id,
    email: auth.user.email || "",
    empresaId: consulta.data.empresa_id,
    empresaNome: nome
  };
}

export async function obterEmpresaId() {
  const contexto = await obterEmpresaAtual();
  return contexto.empresaId;
}
