"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";
import { obterEmpresaId } from "../../lib/empresa";
import { assinarAtualizacoes, normalizarTransferenciasRecebimentos, notificarAtualizacao } from "../../lib/sincronizacao";


function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function vencimentoDaCompetencia(competencia, dia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(
    Math.min(Number(dia), ultimoDia)
  ).padStart(2, "0")}`;
}

function statusExibido(recebimento) {
  if (recebimento.status === "pago") return "Pago";
  if (recebimento.status === "cancelado") return "Estornado";
  return hojeISO() > recebimento.data_vencimento ? "Atrasado" : "Pendente";
}


function normalizarTexto(valor = "") {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMEROS_PT = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezassete: 17, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900, mil: 1000
};

function numeroPorExtenso(valor = "") {
  const tokens = normalizarTexto(valor)
    .split(" ")
    .filter(Boolean)
    .filter(t => t !== "e");

  if (!tokens.length) return null;

  let total = 0;
  let atual = 0;
  let encontrou = false;

  for (const token of tokens) {
    if (!(token in NUMEROS_PT)) continue;
    encontrou = true;
    const n = NUMEROS_PT[token];

    if (token === "mil") {
      atual = (atual || 1) * 1000;
      total += atual;
      atual = 0;
    } else {
      atual += n;
    }
  }

  return encontrou ? total + atual : null;
}

function extrairValorVoz(frase = "") {
  const normal = normalizarTexto(frase);

  const numero = normal.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*reais?)?/i);
  if (numero) {
    return Number(numero[1].replace(".", "").replace(",", "."));
  }

  const antesDeReais = normal.match(/(?:receber|recebi|recebimento)?[\s\S]*?\bde\b[\s\S]*?\b(.+?)\s+reais?\b/);
  if (antesDeReais?.[1]) {
    const palavras = antesDeReais[1].split(" ");
    for (let i = 0; i < palavras.length; i++) {
      const tentativa = numeroPorExtenso(palavras.slice(i).join(" "));
      if (tentativa !== null && tentativa > 0) return tentativa;
    }
  }

  const tentativa = numeroPorExtenso(normal);
  return tentativa && tentativa > 0 ? tentativa : null;
}

function extrairDataVoz(frase = "") {
  const normal = normalizarTexto(frase);
  const hoje = new Date();

  if (/\bhoje\b/.test(normal)) return hojeISO();

  const meses = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
  };

  let dia = null;
  let mesNumero = null;
  let ano = hoje.getFullYear();

  const padraoNumerico = normal.match(/\bdia\s+(\d{1,2})(?:\s+(?:do\s+mes|mes|de)\s+)(\d{1,2})(?:\s+(?:de\s+)?(\d{4}))?/);
  if (padraoNumerico) {
    dia = Number(padraoNumerico[1]);
    mesNumero = Number(padraoNumerico[2]);
    if (padraoNumerico[3]) ano = Number(padraoNumerico[3]);
  }

  if (!dia) {
    const padraoNome = normal.match(/\bdia\s+(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/);
    if (padraoNome) {
      dia = Number(padraoNome[1]);
      mesNumero = meses[padraoNome[2]];
      if (padraoNome[3]) ano = Number(padraoNome[3]);
    }
  }

  if (!dia || !mesNumero || mesNumero < 1 || mesNumero > 12) return hojeISO();

  const ultimoDia = new Date(ano, mesNumero, 0).getDate();
  dia = Math.min(Math.max(dia, 1), ultimoDia);

  return `${ano}-${String(mesNumero).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function extrairNomeVoz(frase = "", valor = null) {
  let normal = normalizarTexto(frase)
    .replace(/^(receber|recebi|recebimento|dar baixa|baixa)\s*/i, "")
    .replace(/^(de|do|da)\s+/i, "");

  if (valor !== null) {
    const digitos = String(valor).replace(".", "[.,]?");
    normal = normal.replace(new RegExp(`\\b${digitos}\\b[\\s\\S]*$`), "").trim();
  }

  normal = normal
    .replace(/\b(?:zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas|mil|e)\b[\s\S]*$/i, "")
    .replace(/\breais?\b[\s\S]*$/i, "")
    .replace(/\bdia\s+\d{1,2}[\s\S]*$/i, "")
    .trim();

  return normal;
}

export default function Recebimentos() {
  const agora = new Date();
  const [mes, setMes] = useState(
    `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`
  );
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [nomeEmpresa, setNomeEmpresa] = useState("LOCADOR");
  const [modal, setModal] = useState(null);
  const [modalReceber, setModalReceber] = useState(null);
  const [salvandoReceber, setSalvandoReceber] = useState(false);
  const [formReceber, setFormReceber] = useState({
    valor_recebido: "",
    data_pagamento: hojeISO(),
    forma_pagamento: "pix"
  });
  const [ouvindo, setOuvindo] = useState(false);
  const [textoVoz, setTextoVoz] = useState("");
  const [modalVoz, setModalVoz] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [form, setForm] = useState({
    valor_previsto: "",
    valor_recebido: "",
    data_pagamento: "",
    forma_pagamento: "",
    multa: "0",
    juros: "0",
    desconto: "0",
    observacoes: ""
  });

  useEffect(() => {
    const agora = new Date();
    const mesAtual = `${agora.getFullYear()}-${String(
      agora.getMonth() + 1
    ).padStart(2, "0")}`;

    // Só gera automaticamente as cobranças do mês atual.
    // Mês futuro pode ser consultado, mas não será criado antes do dia 1º.
    if (mes === mesAtual) {
      prepararMes();
    } else {
      carregar();
    }
  }, [mes]);

  useEffect(() => {
    return assinarAtualizacoes(() => {
      prepararMes();
    });
  }, [mes]);

  async function prepararMes() {
    setCarregando(true);
    setErro("");

    try {
      const empresaId = await obterEmpresaId();

      const { data: empresa, error: empresaError } = await supabase
        .from("empresas")
        .select("nome")
        .eq("id", empresaId)
        .single();

      if (empresaError) throw empresaError;
      setNomeEmpresa(empresa?.nome || "LOCADOR");

      const { data: contratos, error: contratosError } = await supabase
        .from("contratos")
        .select("id,apartamento_id,valor_aluguel,dia_vencimento,data_inicio,data_fim,status")
        .eq("empresa_id", empresaId);

      if (contratosError) throw contratosError;

      const validos = (contratos || []).filter(c => {
        const inicio = c.data_inicio?.slice(0, 7);
        const fim = c.data_fim?.slice(0, 7);

        return (
          c.status === "ativo" &&
          (!inicio || inicio <= mes) &&
          (!fim || fim >= mes)
        );
      });

      // Mesmo que existam dados antigos inconsistentes, gera no máximo
      // UMA cobrança por apartamento no mês atual.
      const porApartamento = new Map();

      for (const contrato of validos) {
        if (!contrato.apartamento_id) continue;

        const atual = porApartamento.get(contrato.apartamento_id);
        if (
          !atual ||
          String(contrato.data_inicio || "") > String(atual.data_inicio || "")
        ) {
          porApartamento.set(contrato.apartamento_id, contrato);
        }
      }

      const contratosParaCobrar = Array.from(porApartamento.values());

      if (contratosParaCobrar.length > 0) {
        const registros = contratosParaCobrar.map(c => ({
          empresa_id: empresaId,
          contrato_id: c.id,
          competencia: `${mes}-01`,
          data_vencimento: vencimentoDaCompetencia(mes, c.dia_vencimento),
          valor_previsto: Number(c.valor_aluguel),
          valor_recebido: 0,
          multa: 0,
          juros: 0,
          desconto: 0,
          status: "pendente"
        }));

        const { error: upsertError } = await supabase
          .from("recebimentos")
          .upsert(registros, {
            onConflict: "contrato_id,competencia",
            ignoreDuplicates: true
          });

        if (upsertError) throw upsertError;
      }

      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível preparar as cobranças do mês.");
      setCarregando(false);
    }
  }

  async function carregar() {
    setCarregando(true);
    setErro("");

    try {
      const empresaId = await obterEmpresaId();

      const { data, error } = await supabase
        .from("recebimentos")
        .select(`
          *,
          contratos!inner(
            id,
            empresa_id,
            inquilino_id,
            apartamento_id,
            status,
            data_inicio,
            data_fim,
            inquilinos(id,nome,cpf,telefone),
            apartamentos(id,numero,predios(id,nome,endereco))
          )
        `)
        .eq("empresa_id", empresaId)
        .eq("contratos.empresa_id", empresaId)
        .eq("competencia", `${mes}-01`)
        .order("data_vencimento");

      if (error) throw error;

      // Evita duplicidade antiga na tela de Recebimentos.
      // Para o mesmo apartamento + competência:
      // 1) se houver pago, mantém o pago;
      // 2) caso contrário, prioriza contrato ativo;
      // 3) em empate, prioriza contrato com início mais recente.
      const mapa = new Map();

      const dadosNormalizados = normalizarTransferenciasRecebimentos(data || []);

      for (const r of dadosNormalizados) {
        const apartamentoId =
          r.contratos?.apartamentos?.id ||
          r.contratos?.apartamento_id ||
          r.id;

        const chave = `${apartamentoId}|${r.competencia}`;
        const atual = mapa.get(chave);

        if (!atual) {
          mapa.set(chave, r);
          continue;
        }

        const pontuar = item => {
          const status = String(item.status || "").toLowerCase();
          const previsto = Number(item.valor_previsto || 0);
          const recebido = Number(item.valor_recebido || 0);

          const pago =
            status === "pago" || (previsto > 0 && recebido >= previsto)
              ? 1000000000
              : 0;

          const ativo =
            String(item.contratos?.status || "").toLowerCase() === "ativo"
              ? 100000000
              : 0;

          const inicio =
            Number(
              String(item.contratos?.data_inicio || "")
                .replace(/-/g, "")
            ) || 0;

          return pago + ativo + inicio;
        };

        if (pontuar(r) > pontuar(atual)) {
          mapa.set(chave, r);
        }
      }

      setLista(Array.from(mapa.values()));
    } catch (e) {
      setErro(e.message || "Não foi possível carregar os recebimentos.");
      setLista([]);
    } finally {
      setCarregando(false);
    }
  }


  const linhas = useMemo(
    () =>
      lista.map(r => ({
        ...r,
        statusTela: statusExibido(r),
        inquilino: r.contratos?.inquilinos,
        apartamento: r.contratos?.apartamentos,
        predio: r.contratos?.apartamentos?.predios
      })),
    [lista]
  );

  const resumoStatus = useMemo(() => {
    const resumo = {
      pago: { quantidade: 0, valor: 0 },
      pendente: { quantidade: 0, valor: 0 },
      atrasado: { quantidade: 0, valor: 0 }
    };

    for (const r of linhas) {
      const totalDevido =
        Number(r.valor_previsto || 0) +
        Number(r.multa || 0) +
        Number(r.juros || 0) -
        Number(r.desconto || 0);

      const recebido = Number(r.valor_recebido || 0);
      const aberto = Math.max(0, totalDevido - recebido);

      if (r.statusTela === "Pago") {
        resumo.pago.quantidade += 1;
        resumo.pago.valor += recebido;
      } else if (r.statusTela === "Atrasado") {
        resumo.atrasado.quantidade += 1;
        resumo.atrasado.valor += aberto;
      } else if (r.statusTela === "Pendente") {
        resumo.pendente.quantidade += 1;
        resumo.pendente.valor += aberto;
      }
    }

    return resumo;
  }, [linhas]);

  const linhasFiltradas = useMemo(() => {
    if (filtroStatus === "pago") {
      return linhas.filter(r => r.statusTela === "Pago");
    }
    if (filtroStatus === "pendente") {
      return linhas.filter(r => r.statusTela === "Pendente");
    }
    if (filtroStatus === "atrasado") {
      return linhas.filter(r => r.statusTela === "Atrasado");
    }
    return linhas;
  }, [linhas, filtroStatus]);

  function alternarFiltroStatus(status) {
    setFiltroStatus(atual => atual === status ? "todos" : status);
  }

  const grupos = useMemo(() => {
    const mapa = new Map();
    linhasFiltradas.forEach((r) => {
      const id = r.predio?.id || "sem-predio";
      if (!mapa.has(id)) {
        mapa.set(id, {
          id,
          nome: r.predio?.nome || "Sem imóvel",
          endereco: r.predio?.endereco || "",
          linhas: []
        });
      }
      mapa.get(id).linhas.push(r);
    });
    return Array.from(mapa.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    );
  }, [linhasFiltradas]);

  function abrirReceber(r, opcoes = {}) {
    setErro("");
    setModalVoz(null);
    setModalReceber(r);
    setFormReceber({
      valor_recebido: String(
        opcoes.valor_recebido ?? r.valor_previsto ?? ""
      ),
      data_pagamento: opcoes.data_pagamento || hojeISO(),
      forma_pagamento: opcoes.forma_pagamento || "pix"
    });
  }

  function processarComandoVoz(transcricao) {
    const frase = transcricao?.trim();
    if (!frase) {
      setErro("Não foi possível entender o comando de voz.");
      return;
    }

    setTextoVoz(frase);

    const valor = extrairValorVoz(frase);
    const dataPagamento = extrairDataVoz(frase);
    const nomeFalado = extrairNomeVoz(frase, valor);

    if (!valor || valor <= 0) {
      setErro(
        `Entendi "${frase}", mas não consegui identificar o valor. Tente: "Receber de João, quatrocentos reais".`
      );
      return;
    }

    if (!nomeFalado) {
      setErro(
        `Entendi "${frase}", mas não consegui identificar o inquilino.`
      );
      return;
    }

    const nomeNormal = normalizarTexto(nomeFalado);
    const pendentes = linhas.filter(r => r.statusTela !== "Pago");

    let candidatos = pendentes.filter(r => {
      const nome = normalizarTexto(r.inquilino?.nome || "");
      return nome.includes(nomeNormal) || nomeNormal.includes(nome);
    });

    if (!candidatos.length) {
      const primeiraPalavra = nomeNormal.split(" ")[0];
      candidatos = pendentes.filter(r => {
        const nome = normalizarTexto(r.inquilino?.nome || "");
        return nome.split(" ").includes(primeiraPalavra);
      });
    }

    if (!candidatos.length) {
      setErro(
        `Não encontrei cobrança pendente para "${nomeFalado}" em ${mes}.`
      );
      return;
    }

    // Remove duplicidades VISUAIS do seletor por voz.
    // Mesmo que existam dois contratos/recebimentos diferentes no banco,
    // se eles representam o mesmo inquilino + imóvel + apartamento + mês + valor,
    // mostramos apenas uma opção para evitar confusão.
    const candidatosUnicos = Array.from(
      new Map(
        candidatos.map(r => {
          const chaveVisual = [
            normalizarTexto(r.inquilino?.nome || ""),
            normalizarTexto(r.predio?.nome || ""),
            String(r.apartamento?.numero || ""),
            String(r.competencia || `${mes}-01`),
            Number(r.valor_previsto || 0).toFixed(2)
          ].join("|");

          return [chaveVisual, r];
        })
      ).values()
    );

    if (candidatosUnicos.length === 1) {
      abrirReceber(candidatosUnicos[0], {
        valor_recebido: valor,
        data_pagamento: dataPagamento
      });
      return;
    }

    setModalVoz({
      frase,
      valor,
      data_pagamento: dataPagamento,
      nomeFalado,
      candidatos: candidatosUnicos
    });
  }

  async function iniciarRecebimentoPorVoz() {
    setErro("");
    setTextoVoz("");

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErro(
        "O reconhecimento de voz não está disponível neste navegador. Teste no Google Chrome."
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErro(
        "Este navegador não disponibilizou acesso ao microfone para esta página. Use o Chrome em localhost ou HTTPS."
      );
      return;
    }

    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const faixasAudio = stream.getAudioTracks();
      if (!faixasAudio.length) {
        throw new Error("Nenhum microfone disponível.");
      }

      const reconhecimento = new SpeechRecognition();
      reconhecimento.lang = "pt-BR";
      reconhecimento.interimResults = false;
      reconhecimento.maxAlternatives = 1;
      reconhecimento.continuous = false;

      reconhecimento.onstart = () => setOuvindo(true);
      reconhecimento.onaudiostart = () => setOuvindo(true);

      reconhecimento.onresult = evento => {
        const transcricao = evento.results?.[0]?.[0]?.transcript || "";
        processarComandoVoz(transcricao);
      };

      reconhecimento.onerror = evento => {
        const codigo = evento?.error || "desconhecido";
        const detalhe = evento?.message ? `: ${evento.message}` : "";

        if (codigo === "no-speech") {
          setErro("Nenhuma fala foi detectada. Tente falar mais perto do microfone.");
          return;
        }

        if (codigo === "audio-capture") {
          setErro(
            "O Chrome não conseguiu capturar o áudio do microfone. Verifique se outro programa está usando o dispositivo."
          );
          return;
        }

        if (codigo === "network") {
          setErro(
            "O microfone foi autorizado, mas o serviço de reconhecimento de voz do navegador não respondeu. Verifique a internet e tente novamente."
          );
          return;
        }

        if (codigo === "not-allowed" || codigo === "service-not-allowed") {
          setErro(
            `O microfone está autorizado, mas o Chrome bloqueou o serviço de reconhecimento de voz (${codigo}${detalhe}). Atualize a página e tente novamente. Se persistir, teste também no site online em HTTPS.`
          );
          return;
        }

        setErro(
          `O microfone foi aberto, mas o reconhecimento de voz falhou (${codigo}${detalhe}).`
        );
      };

      reconhecimento.onend = () => {
        setOuvindo(false);

        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          stream = null;
        }
      };

      try {
        reconhecimento.start();
      } catch (e) {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          stream = null;
        }

        setOuvindo(false);
        setErro(
          `O microfone foi autorizado, mas não foi possível iniciar o reconhecimento de voz: ${e.message || "erro desconhecido"}.`
        );
      }
    } catch (e) {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      setOuvindo(false);

      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setErro(
          "O navegador não autorizou o acesso ao microfone. Clique no ícone ao lado do endereço e permita o microfone."
        );
      } else if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
        setErro("Nenhum microfone foi encontrado neste computador.");
      } else if (e?.name === "NotReadableError" || e?.name === "TrackStartError") {
        setErro(
          "O microfone existe, mas não pôde ser aberto. Feche outros programas que possam estar usando o microfone e tente novamente."
        );
      } else {
        setErro(
          `Não foi possível abrir o microfone: ${e?.message || e?.name || "erro desconhecido"}.`
        );
      }
    }
  }

  async function confirmarRecebimento(e) {
    e.preventDefault();
    if (!modalReceber) return;

    const valor = Number(formReceber.valor_recebido || 0);
    if (valor <= 0) {
      return setErro("Informe o valor recebido.");
    }
    if (!formReceber.data_pagamento) {
      return setErro("Informe a data do pagamento.");
    }

    const totalDevido =
      Number(modalReceber.valor_previsto || 0) +
      Number(modalReceber.multa || 0) +
      Number(modalReceber.juros || 0) -
      Number(modalReceber.desconto || 0);

    if (valor > totalDevido) {
      const confirmarMaior = confirm(
        `O valor recebido (${moeda(valor)}) é maior que o valor devido (${moeda(totalDevido)}). Deseja registrar mesmo assim?`
      );
      if (!confirmarMaior) return;
    }

    setSalvandoReceber(true);
    setErro("");

    try {
      const { error } = await supabase
        .from("recebimentos")
        .update({
          valor_recebido: valor,
          data_pagamento: formReceber.data_pagamento,
          forma_pagamento: formReceber.forma_pagamento || null,
          status: valor >= totalDevido ? "pago" : "pendente",
          atualizado_em: new Date().toISOString()
        })
        .eq("id", modalReceber.id);

      if (error) throw error;

      setModalReceber(null);
      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível registrar o pagamento.");
    } finally {
      setSalvandoReceber(false);
    }
  }

  function abrirEditar(r) {
    setModal(r);
    setForm({
      valor_previsto: String(r.valor_previsto || ""),
      valor_recebido: String(r.valor_recebido || ""),
      data_pagamento: r.data_pagamento || "",
      forma_pagamento: r.forma_pagamento || "",
      multa: String(r.multa || 0),
      juros: String(r.juros || 0),
      desconto: String(r.desconto || 0),
      observacoes: r.observacoes || ""
    });
  }

  async function salvarEdicao(e) {
    e.preventDefault();

    const valorRecebido = Number(form.valor_recebido || 0);
    const totalDevido =
      Number(form.valor_previsto || 0) +
      Number(form.multa || 0) +
      Number(form.juros || 0) -
      Number(form.desconto || 0);

    if (valorRecebido > totalDevido) {
      const confirmarMaior = confirm(
        `O valor recebido (${moeda(valorRecebido)}) é maior que o valor devido (${moeda(totalDevido)}). Deseja salvar mesmo assim?`
      );
      if (!confirmarMaior) return;
    }

    const pago =
      valorRecebido >= totalDevido &&
      totalDevido >= 0 &&
      !!form.data_pagamento;

    const { error } = await supabase
      .from("recebimentos")
      .update({
        valor_previsto: Number(form.valor_previsto || 0),
        valor_recebido: Number(form.valor_recebido || 0),
        data_pagamento: form.data_pagamento || null,
        forma_pagamento: form.forma_pagamento || null,
        multa: Number(form.multa || 0),
        juros: Number(form.juros || 0),
        desconto: Number(form.desconto || 0),
        observacoes: form.observacoes || null,
        status: pago ? "pago" : "pendente",
        atualizado_em: new Date().toISOString()
      })
      .eq("id", modal.id);

    if (error) return setErro(error.message);

    setModal(null);
    await carregar();
  }

  async function estornar(r) {
    if (!confirm(`Estornar o recebimento de ${r.inquilino?.nome || "inquilino"}?`)) {
      return;
    }

    const { error } = await supabase
      .from("recebimentos")
      .update({
        valor_recebido: 0,
        data_pagamento: null,
        forma_pagamento: null,
        multa: 0,
        juros: 0,
        desconto: 0,
        status: "pendente",
        atualizado_em: new Date().toISOString()
      })
      .eq("id", r.id);

    if (error) return setErro(error.message);
    await carregar();
  }

  async function excluirTodos() {
    if (lista.length === 0) return;

    const competencia = `${mes}-01`;
    const mesFormatado = mes.split("-").reverse().join("/");

    if (
      !confirm(
        `Excluir TODAS as cobranças de ${mesFormatado}?\n\n` +
        `Serão excluídos ${lista.length} recebimento(s), inclusive os que estiverem pagos.\n` +
        `Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }

    const empresaId = await obterEmpresaId();

    const { error } = await supabase
      .from("recebimentos")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("competencia", competencia);

    if (error) {
      setErro(error.message);
      return;
    }

    await carregar();
  }

  async function excluir(r) {
    if (!confirm(`Excluir definitivamente esta cobrança de ${r.inquilino?.nome || "inquilino"}?`)) {
      return;
    }

    const { error } = await supabase
      .from("recebimentos")
      .delete()
      .eq("id", r.id);

    if (error) return setErro(error.message);
    await carregar();
  }

  function recibo(r) {
    if (r.statusTela !== "Pago") {
      alert("O recibo só pode ser gerado após o pagamento.");
      return;
    }

    const janela = window.open("", "_blank");
    if (!janela) return;

    const dataPagamento = r.data_pagamento
      ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
      : "";

    janela.document.write(`
      <html>
      <head>
        <title>Recibo de Aluguel</title>
        <style>
          body{font-family:Arial,sans-serif;padding:45px;line-height:1.65;color:#111}
          h2{text-align:center;margin-bottom:35px}
          .linha{margin-top:80px;border-top:1px solid #111;width:320px;text-align:center}
          @media print{button{display:none}}
        </style>
      </head>
      <body>
        <h2>RECIBO DE ALUGUEL</h2>
        <p>
          Recebi de <b>${r.inquilino?.nome || ""}</b> a quantia de
          <b>${moeda(r.valor_recebido)}</b>, referente ao aluguel do imóvel
          <b>${r.predio?.nome || ""}</b>, apartamento
          <b>${r.apartamento?.numero || ""}</b>, competência
          <b>${mes.split("-").reverse().join("/")}</b>.
        </p>
        <p>Forma de pagamento: <b>${r.forma_pagamento || "Não informada"}</b>.</p>
        <p>Princesa Isabel-PB, ${dataPagamento}.</p>
        <div class="linha">${nomeEmpresa}<br>LOCADOR</div>
        <script>window.onload=()=>window.print()<\/script>
      </body>
      </html>
    `);

    janela.document.close();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="receipts-header">
          <h2>Recebimentos</h2>

          <div className="receipts-header-actions">
            <button
              type="button"
              className={`secondary voice-receive-button ${ouvindo ? "listening" : ""}`}
              onClick={iniciarRecebimentoPorVoz}
              disabled={ouvindo || carregando}
              title="Registrar recebimento por comando de voz"
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <path d="M12 17v5" />
                <path d="M8 22h8" />
              </svg>
              {ouvindo ? "Ouvindo..." : "Receber por voz"}
            </button>

            <input
              type="month"
              value={mes}
              onChange={e => setMes(e.target.value)}
            />
            <button
              type="button"
              className="danger"
              onClick={excluirTodos}
              disabled={carregando || lista.length === 0}
              title="Excluir todas as cobranças do mês selecionado"
            >
              Excluir todos
            </button>
          </div>
        </div>

        <div className="receipts-filter-cards" aria-label="Filtrar recebimentos por status">
          <button
            type="button"
            className={`receipts-filter-card paid ${filtroStatus === "pago" ? "active" : ""}`}
            onClick={() => alternarFiltroStatus("pago")}
            aria-pressed={filtroStatus === "pago"}
          >
            <span className="receipts-filter-card-label">Pagos</span>
            <strong>{resumoStatus.pago.quantidade}</strong>
            <small>{moeda(resumoStatus.pago.valor)}</small>
          </button>

          <button
            type="button"
            className={`receipts-filter-card pending ${filtroStatus === "pendente" ? "active" : ""}`}
            onClick={() => alternarFiltroStatus("pendente")}
            aria-pressed={filtroStatus === "pendente"}
          >
            <span className="receipts-filter-card-label">Pendentes</span>
            <strong>{resumoStatus.pendente.quantidade}</strong>
            <small>{moeda(resumoStatus.pendente.valor)}</small>
          </button>

          <button
            type="button"
            className={`receipts-filter-card overdue ${filtroStatus === "atrasado" ? "active" : ""}`}
            onClick={() => alternarFiltroStatus("atrasado")}
            aria-pressed={filtroStatus === "atrasado"}
          >
            <span className="receipts-filter-card-label">Atrasados</span>
            <strong>{resumoStatus.atrasado.quantidade}</strong>
            <small>{moeda(resumoStatus.atrasado.valor)}</small>
          </button>
        </div>

        {filtroStatus !== "todos" && (
          <div className="receipts-filter-active">
            Filtro ativo: <strong>
              {filtroStatus === "pago"
                ? "Pagos"
                : filtroStatus === "pendente"
                  ? "Pendentes"
                  : "Atrasados"}
            </strong>
            <button type="button" onClick={() => setFiltroStatus("todos")}>
              Mostrar todos
            </button>
          </div>
        )}

        {erro && <div className="error">{erro}</div>}

        {textoVoz && !erro && (
          <div className="voice-transcript">
            Comando reconhecido: “{textoVoz}”
          </div>
        )}

        {!carregando && linhasFiltradas.length === 0 && (
          <div className="receipts-empty">
            {linhas.length === 0
              ? "Nenhum recebimento gerado para este mês."
              : "Nenhum recebimento encontrado neste filtro."}
          </div>
        )}

        {carregando && (
          <div className="receipts-empty">Carregando...</div>
        )}

        {!carregando && linhasFiltradas.length > 0 && (
          <div className="receipts-buildings">
            {grupos.map(grupo => (
              <section className="receipts-building" key={grupo.id}>
                <div className="receipts-building-head">
                  <h3>{grupo.nome}</h3>
                  {grupo.endereco && <p>{grupo.endereco}</p>}
                </div>
                <div className="receipts-table-wrap">
                  <table className="receipts-table">
                    <thead>
                      <tr>
                        <th>Mês</th><th>Apto</th><th>Inquilino</th>
                        <th>Previsto</th><th>Recebido</th><th>Data</th>
                        <th>Status</th><th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.linhas.map(r => (
                        <tr key={r.id}>
                          <td>{mes}</td>
                          <td>{r.apartamento?.numero || "-"}</td>
                          <td>{r.inquilino?.nome || "-"}</td>
                          <td>{moeda(r.valor_previsto)}</td>
                          <td>{moeda(r.valor_recebido)}</td>
                          <td>{r.data_pagamento
                            ? new Date(`${r.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")
                            : ""}</td>
                          <td><span className={`receipts-status ${r.statusTela.toLowerCase()}`}>{r.statusTela}</span></td>
                          <td>
                            <div className="receipts-actions">
                              {r.statusTela !== "Pago" && (
                                <button className="primary" onClick={() => abrirReceber(r)}>
                                  Receber
                                </button>
                              )}
                              <button className="secondary" onClick={() => estornar(r)}>Estornar</button>
                              <button className="secondary" onClick={() => recibo(r)}>Recibo</button>
                              <button className="danger" onClick={() => excluir(r)}>Excluir</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}

        <style jsx>{`
          .receipts-header-actions{
            display:flex;
            gap:8px;
            align-items:center;
            justify-content:flex-end;
            flex-wrap:nowrap;
          }
          .receipts-header-actions input{
            width:220px;
            min-width:220px;
          }
          .receipts-header-actions .danger{flex:0 0 auto}
          .voice-receive-button{
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:7px;
            min-width:155px;
          }
          .voice-receive-button.listening{
            border-color:#dc2626 !important;
            color:#b91c1c !important;
            background:#fff1f2 !important;
          }
          .voice-transcript{
            margin:0 0 14px;
            padding:10px 12px;
            border:1px solid #bfdbfe;
            border-radius:9px;
            background:#eff6ff;
            color:#1e3a5f;
            font-size:13px;
          }
          .receipts-buildings{display:grid;gap:18px}
          .receipts-building{background:#fff;border:1px solid #dbe3ee;border-radius:12px;overflow:hidden}
          .receipts-building-head{padding:14px 16px 10px;border-bottom:1px solid #e5eaf1}
          .receipts-building-head h3{margin:0;font-size:18px}
          .receipts-building-head p{margin:4px 0 0;color:#64748b;font-size:13px}
          .receipts-building .receipts-table-wrap{margin:0;border:0;border-radius:0;overflow-x:auto}
          .receipts-building .receipts-table{
            width:100%;
            min-width:1180px;
            table-layout:fixed;
          }
          .receipts-building .receipts-table th,
          .receipts-building .receipts-table td{
            box-sizing:border-box;
            vertical-align:middle;
          }
          .receipts-building .receipts-table th:nth-child(1),
          .receipts-building .receipts-table td:nth-child(1){
            width:10%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(2),
          .receipts-building .receipts-table td:nth-child(2){
            width:10%;
            white-space:normal;
            overflow-wrap:anywhere;
          }
          .receipts-building .receipts-table th:nth-child(3),
          .receipts-building .receipts-table td:nth-child(3){
            width:22%;
            white-space:normal;
            overflow-wrap:anywhere;
            line-height:1.35;
          }
          .receipts-building .receipts-table th:nth-child(4),
          .receipts-building .receipts-table td:nth-child(4){
            width:12%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(5),
          .receipts-building .receipts-table td:nth-child(5){
            width:12%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(6),
          .receipts-building .receipts-table td:nth-child(6){
            width:11%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(7),
          .receipts-building .receipts-table td:nth-child(7){
            width:10%;
            white-space:nowrap;
          }
          .receipts-building .receipts-table th:nth-child(8),
          .receipts-building .receipts-table td:nth-child(8){
            width:23%;
            white-space:nowrap;
          }
          .receipts-building .receipts-actions{
            display:flex;
            gap:6px;
            flex-wrap:nowrap;
            align-items:center;
          }
          .voice-choice-modal{width:min(720px,calc(100vw - 32px)) !important}
          .voice-command-summary{
            display:flex;
            gap:18px;
            flex-wrap:wrap;
            padding:14px 20px;
            background:#f8fbff;
            border-bottom:1px solid #e5eaf1;
            color:#334155;
            font-size:13px;
          }
          .voice-candidates{
            display:grid;
            gap:9px;
            padding:16px 20px;
          }
          .voice-candidate{
            width:100%;
            min-height:68px !important;
            padding:12px 13px !important;
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:14px;
            text-align:left;
            border:1px solid #d8e4f0 !important;
            border-radius:10px !important;
            background:#fff !important;
            color:#0f2d52 !important;
          }
          .voice-candidate:hover{
            background:#f8fbff !important;
            border-color:#1976d2 !important;
          }
          .voice-candidate-main,
          .voice-candidate-values{
            display:grid;
            gap:4px;
          }
          .voice-candidate-main span,
          .voice-candidate-values span{
            font-size:12px;
            color:#64748b;
          }
          .voice-candidate-values{
            justify-items:end;
          }
          .voice-value-warning{
            margin:14px 20px 0;
            padding:11px 12px;
            border:1px solid #f5c66b;
            border-radius:9px;
            background:#fff8e7;
            color:#7c4a03;
            font-size:13px;
            line-height:1.45;
          }
          @media (max-width:760px){
            .receipts-header-actions{
              width:100%;
              flex-wrap:wrap;
              justify-content:flex-start;
            }
            .receipts-header-actions input,
            .voice-receive-button{
              width:100%;
              min-width:0;
            }
            .voice-candidate{
              align-items:flex-start;
              flex-direction:column;
            }
            .voice-candidate-values{
              justify-items:start;
            }
          }
        `}</style>

        {modalVoz && (
          <div className="receipts-modal-bg">
            <div className="receipts-modal voice-choice-modal">
              <div className="receipts-modal-head">
                <div>
                  <h3>Selecione o inquilino</h3>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                    Encontrei mais de uma cobrança para “{modalVoz.nomeFalado}”.
                  </div>
                </div>
                <button type="button" onClick={() => setModalVoz(null)}>×</button>
              </div>

              <div className="voice-command-summary">
                <span><strong>Valor:</strong> {moeda(modalVoz.valor)}</span>
                <span>
                  <strong>Data:</strong>{" "}
                  {new Date(`${modalVoz.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")}
                </span>
              </div>

              <div className="voice-candidates">
                {modalVoz.candidatos.map(r => (
                  <button
                    type="button"
                    className="voice-candidate"
                    key={r.id}
                    onClick={() =>
                      abrirReceber(r, {
                        valor_recebido: modalVoz.valor,
                        data_pagamento: modalVoz.data_pagamento
                      })
                    }
                  >
                    <div className="voice-candidate-main">
                      <strong>{r.inquilino?.nome || "Sem nome"}</strong>
                      <span>
                        {r.predio?.nome || "Sem imóvel"} — Apto {r.apartamento?.numero || "-"}
                      </span>
                    </div>
                    <div className="voice-candidate-values">
                      <span>Previsto: {moeda(r.valor_previsto)}</span>
                      <span className={`receipts-status ${r.statusTela.toLowerCase()}`}>
                        {r.statusTela}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="receipts-modal-actions">
                <button type="button" className="secondary" onClick={() => setModalVoz(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {modalReceber && (
          <div className="receipts-modal-bg">
            <form className="receipts-modal" onSubmit={confirmarRecebimento}>
              <div className="receipts-modal-head">
                <div>
                  <h3>Registrar pagamento</h3>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                    {modalReceber.inquilino?.nome || "-"} — Apto {modalReceber.apartamento?.numero || "-"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalReceber(null)}
                  disabled={salvandoReceber}
                >
                  ×
                </button>
              </div>

              <div className="receipts-form-grid">
                <label>
                  Valor recebido
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formReceber.valor_recebido}
                    onChange={e =>
                      setFormReceber({ ...formReceber, valor_recebido: e.target.value })
                    }
                    required
                    autoFocus
                  />
                </label>

                <label>
                  Data do pagamento
                  <input
                    type="date"
                    value={formReceber.data_pagamento}
                    onChange={e =>
                      setFormReceber({ ...formReceber, data_pagamento: e.target.value })
                    }
                    required
                  />
                </label>

                <label className="receipts-full">
                  Forma de pagamento
                  <select
                    value={formReceber.forma_pagamento}
                    onChange={e =>
                      setFormReceber({ ...formReceber, forma_pagamento: e.target.value })
                    }
                  >
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                    <option value="cartao">Cartão</option>
                    <option value="boleto">Boleto</option>
                    <option value="outro">Outro</option>
                  </select>
                </label>
              </div>

              {Number(formReceber.valor_recebido || 0) > 0 &&
                Number(formReceber.valor_recebido || 0) !== Number(modalReceber.valor_previsto || 0) && (
                  <div className="voice-value-warning">
                    <strong>Atenção:</strong> o valor previsto é {moeda(modalReceber.valor_previsto)} e
                    você está registrando {moeda(formReceber.valor_recebido)}.
                    {Number(formReceber.valor_recebido || 0) < Number(modalReceber.valor_previsto || 0)
                      ? " Confirme se deseja registrar este valor como pagamento recebido."
                      : " Confirme se o valor informado está correto."}
                  </div>
                )}

              {erro && <div className="error" style={{ marginTop: 12 }}>{erro}</div>}

              <div className="receipts-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModalReceber(null)}
                  disabled={salvandoReceber}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={salvandoReceber}>
                  {salvandoReceber ? "Registrando..." : "Confirmar pagamento"}
                </button>
              </div>
            </form>
          </div>
        )}

      </AppShell>
    </AuthGuard>
  );
}
