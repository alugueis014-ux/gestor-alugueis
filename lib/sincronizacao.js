import { supabase } from "./supabase";

export const EVENTO_DADOS_ATUALIZADOS = "alugue-facil:dados-atualizados";
const STORAGE_EVENT_KEY = "alugue-facil:dados-atualizados";

export function notificarAtualizacao(modulo = "geral", detalhes = {}) {
  if (typeof window === "undefined") return;

  const payload = { modulo, detalhes, em: Date.now() };

  window.dispatchEvent(
    new CustomEvent(EVENTO_DADOS_ATUALIZADOS, { detail: payload })
  );

  try {
    localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(payload));
  } catch (_) {}
}

export function assinarAtualizacoes(callback) {
  if (typeof window === "undefined") return () => {};

  const executar = () => {
    try { callback(); } catch (_) {}
  };

  const onCustom = () => executar();
  const onStorage = (event) => {
    if (event.key === STORAGE_EVENT_KEY) executar();
  };
  const onFocus = () => executar();
  const onVisibility = () => {
    if (document.visibilityState === "visible") executar();
  };

  window.addEventListener(EVENTO_DADOS_ATUALIZADOS, onCustom);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener(EVENTO_DADOS_ATUALIZADOS, onCustom);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

function competenciaAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

function vencimentoDaCompetencia(competencia, dia) {
  const [ano, mes] = competencia.slice(0, 7).split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const d = Math.min(Math.max(Number(dia) || 1, 1), ultimoDia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function sincronizarValorContratoAberto({
  empresaId,
  contratoId,
  valorAluguel
}) {
  if (!empresaId || !contratoId) return;

  const { error } = await supabase
    .from("recebimentos")
    .update({
      valor_previsto: Number(valorAluguel || 0),
      atualizado_em: new Date().toISOString()
    })
    .eq("empresa_id", empresaId)
    .eq("contrato_id", contratoId)
    .gte("competencia", competenciaAtual())
    .neq("status", "pago")
    .neq("status", "cancelado");

  if (error) throw error;
}

export async function sincronizarEncerramentoContrato({
  empresaId,
  contratoId,
  dataFim
}) {
  if (!empresaId || !contratoId || !dataFim) return;

  const mesFim = `${String(dataFim).slice(0, 7)}-01`;

  const { error } = await supabase
    .from("recebimentos")
    .update({
      status: "cancelado",
      atualizado_em: new Date().toISOString()
    })
    .eq("empresa_id", empresaId)
    .eq("contrato_id", contratoId)
    .gt("competencia", mesFim)
    .neq("status", "pago");

  if (error) throw error;
}

export async function garantirCobrancaMesAtual({
  empresaId,
  contratoId
}) {
  if (!empresaId || !contratoId) return;

  const competencia = competenciaAtual();

  const { data: contrato, error: contratoError } = await supabase
    .from("contratos")
    .select("id,empresa_id,apartamento_id,valor_aluguel,dia_vencimento,data_inicio,status")
    .eq("id", contratoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (contratoError) throw contratoError;
  if (!contrato || contrato.status !== "ativo") return;

  const mesInicio = contrato.data_inicio?.slice(0, 7);
  const mesAtual = competencia.slice(0, 7);
  if (mesInicio && mesInicio > mesAtual) return;

  const { data: existente, error: existenteError } = await supabase
    .from("recebimentos")
    .select("id,contrato_id,contratos!inner(apartamento_id)")
    .eq("empresa_id", empresaId)
    .eq("competencia", competencia)
    .eq("contratos.apartamento_id", contrato.apartamento_id)
    .neq("status", "cancelado")
    .limit(1)
    .maybeSingle();

  if (existenteError) throw existenteError;
  if (existente) return;

  const { error } = await supabase
    .from("recebimentos")
    .insert({
      empresa_id: empresaId,
      contrato_id: contrato.id,
      competencia,
      data_vencimento: vencimentoDaCompetencia(competencia, contrato.dia_vencimento),
      valor_previsto: Number(contrato.valor_aluguel || 0),
      valor_recebido: 0,
      multa: 0,
      juros: 0,
      desconto: 0,
      status: "pendente"
    });

  if (
    error &&
    !/duplicate|unique|já existe uma cobrança|already exists/i.test(error.message || "")
  ) {
    throw error;
  }
}


function contratoDoRecebimento(item) {
  return item?.contratos || item?.contrato || null;
}

function inquilinoIdDoRecebimento(item) {
  const contrato = contratoDoRecebimento(item);
  return (
    contrato?.inquilino_id ||
    contrato?.inquilinos?.id ||
    item?.inquilino_id ||
    null
  );
}

function apartamentoIdDoRecebimento(item) {
  const contrato = contratoDoRecebimento(item);
  return (
    contrato?.apartamento_id ||
    contrato?.apartamentos?.id ||
    item?.apartamento_id ||
    null
  );
}

function estaPago(item) {
  const previsto = Number(item?.valor_previsto || 0);
  const recebido = Number(item?.valor_recebido || 0);
  return (
    String(item?.status || "").toLowerCase() === "pago" ||
    (previsto > 0 && recebido >= previsto)
  );
}

/*
  Normaliza registros antigos de TRANSFERÊNCIA apenas para leitura/exibição.

  Regra segura:
  - mesmo inquilino;
  - mesma empresa;
  - mesma competência;
  - contrato antigo encerrado;
  - novo contrato começa EXATAMENTE na data em que o antigo termina;
  - apartamentos diferentes.

  Isso NÃO confunde com um inquilino que possui dois imóveis simultaneamente,
  porque nesse caso não existe a sequência encerramento -> início na mesma data.
*/
export function normalizarTransferenciasRecebimentos(lista = []) {
  const itens = Array.isArray(lista) ? lista : [];
  const porGrupo = new Map();

  for (const item of itens) {
    const inquilinoId = inquilinoIdDoRecebimento(item);
    if (!inquilinoId) continue;

    const chave = `${item.empresa_id || ""}|${inquilinoId}|${item.competencia || ""}`;

    if (!porGrupo.has(chave)) porGrupo.set(chave, []);
    porGrupo.get(chave).push(item);
  }

  const removidos = new Set();
  const substitutos = new Map();

  for (const grupo of porGrupo.values()) {
    for (const antigo of grupo) {
      const contratoAntigo = contratoDoRecebimento(antigo);
      if (!contratoAntigo?.data_fim) continue;

      const statusContratoAntigo = String(
        contratoAntigo.status || ""
      ).toLowerCase();

      if (statusContratoAntigo === "ativo") continue;

      const aptAntigo = apartamentoIdDoRecebimento(antigo);

      const destino = grupo
        .filter((novo) => {
          if (novo.id === antigo.id) return false;

          const contratoNovo = contratoDoRecebimento(novo);
          const aptNovo = apartamentoIdDoRecebimento(novo);

          return (
            !!contratoNovo?.data_inicio &&
            contratoNovo.data_inicio === contratoAntigo.data_fim &&
            !!aptNovo &&
            !!aptAntigo &&
            aptNovo !== aptAntigo
          );
        })
        .sort((a, b) => {
          const ativoA =
            String(contratoDoRecebimento(a)?.status || "").toLowerCase() === "ativo"
              ? 1
              : 0;
          const ativoB =
            String(contratoDoRecebimento(b)?.status || "").toLowerCase() === "ativo"
              ? 1
              : 0;

          if (ativoA !== ativoB) return ativoB - ativoA;

          return String(
            contratoDoRecebimento(b)?.data_inicio || ""
          ).localeCompare(
            String(contratoDoRecebimento(a)?.data_inicio || "")
          );
        })[0];

      if (!destino) continue;

      const usarFinanceiroAntigo =
        estaPago(antigo) ||
        Number(antigo.valor_recebido || 0) >
          Number(destino.valor_recebido || 0);

      const mesclado = usarFinanceiroAntigo
        ? {
            ...destino,
            valor_previsto: antigo.valor_previsto,
            valor_recebido: antigo.valor_recebido,
            data_pagamento: antigo.data_pagamento,
            forma_pagamento: antigo.forma_pagamento,
            multa: antigo.multa,
            juros: antigo.juros,
            desconto: antigo.desconto,
            observacoes:
              destino.observacoes ||
              antigo.observacoes ||
              null,
            status: estaPago(antigo) ? "pago" : destino.status,
            origem_transferencia_recebimento_id: antigo.id
          }
        : destino;

      removidos.add(antigo.id);
      substitutos.set(destino.id, mesclado);
    }
  }

  return itens
    .filter((item) => !removidos.has(item.id))
    .map((item) => substitutos.get(item.id) || item);
}

/*
  Ao transferir um inquilino no mesmo mês, o recebimento da competência
  acompanha o NOVO contrato, em vez de criar duas cobranças em dois imóveis.
*/
export async function migrarRecebimentoTransferencia({
  empresaId,
  contratoOrigemId,
  contratoDestinoId,
  dataTransferencia
}) {
  if (
    !empresaId ||
    !contratoOrigemId ||
    !contratoDestinoId ||
    !dataTransferencia
  ) {
    return;
  }

  const competencia = `${String(dataTransferencia).slice(0, 7)}-01`;

  const { data: registros, error } = await supabase
    .from("recebimentos")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("competencia", competencia)
    .in("contrato_id", [contratoOrigemId, contratoDestinoId]);

  if (error) throw error;

  const origem = (registros || []).find(
    (r) => r.contrato_id === contratoOrigemId
  );
  const destino = (registros || []).find(
    (r) => r.contrato_id === contratoDestinoId
  );

  if (!origem) return;

  // Caso ideal: ainda não existe cobrança do destino.
  // Apenas move a cobrança da competência para o novo contrato.
  if (!destino) {
    const { error: moverError } = await supabase
      .from("recebimentos")
      .update({
        contrato_id: contratoDestinoId,
        atualizado_em: new Date().toISOString()
      })
      .eq("id", origem.id)
      .eq("empresa_id", empresaId);

    if (moverError) throw moverError;
    return;
  }

  // Se uma cobrança pendente do destino já foi criada, consolida as duas.
  const origemPago = estaPago(origem);
  const usarOrigem =
    origemPago ||
    Number(origem.valor_recebido || 0) >
      Number(destino.valor_recebido || 0);

  if (usarOrigem) {
    const { error: atualizarError } = await supabase
      .from("recebimentos")
      .update({
        valor_previsto: origem.valor_previsto,
        valor_recebido: origem.valor_recebido,
        data_pagamento: origem.data_pagamento,
        forma_pagamento: origem.forma_pagamento,
        multa: origem.multa,
        juros: origem.juros,
        desconto: origem.desconto,
        observacoes: destino.observacoes || origem.observacoes || null,
        status: origemPago ? "pago" : destino.status,
        atualizado_em: new Date().toISOString()
      })
      .eq("id", destino.id)
      .eq("empresa_id", empresaId);

    if (atualizarError) throw atualizarError;
  }

  const { error: excluirError } = await supabase
    .from("recebimentos")
    .delete()
    .eq("id", origem.id)
    .eq("empresa_id", empresaId);

  if (excluirError) throw excluirError;
}
