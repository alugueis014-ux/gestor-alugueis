"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function dataBR(data) {
  if (!data) return "Prazo indeterminado";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

export default function Contratos() {
  const [contratos, setContratos] = useState([]);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [contratoUpload, setContratoUpload] = useState(null);
  const inputArquivo = useRef(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");

    const { data, error } = await supabase
      .from("contratos")
      .select(`
        *,
        inquilinos(id,nome,cpf,telefone,email),
        apartamentos(id,numero,predio_id,predios(id,nome,endereco)),
        anexos(id,nome_arquivo,caminho_arquivo,tipo_arquivo,criado_em)
      `)
      .order("data_inicio", { ascending: false });

    if (error) setErro(error.message);
    setContratos(data || []);
    setCarregando(false);
  }

  const filtrados = useMemo(() => {
    return contratos.filter(c => {
      const texto = [
        c.inquilinos?.nome,
        c.inquilinos?.cpf,
        c.apartamentos?.numero,
        c.apartamentos?.predios?.nome
      ].join(" ").toLowerCase();

      return (
        texto.includes(busca.toLowerCase()) &&
        (!status || c.status === status)
      );
    });
  }, [contratos, busca, status]);

  const ativos = contratos.filter(c => c.status === "ativo").length;
  const encerrados = contratos.filter(c => c.status === "encerrado").length;
  const vencendo = contratos.filter(c => {
    if (c.status !== "ativo" || !c.data_fim) return false;
    const hoje = new Date();
    const fim = new Date(`${c.data_fim}T23:59:59`);
    const dias = Math.ceil((fim - hoje) / 86400000);
    return dias >= 0 && dias <= 30;
  }).length;

  function visualizar(c) {
    const i = c.inquilinos || {};
    const a = c.apartamentos || {};
    const p = a.predios || {};
    const inicio = dataBR(c.data_inicio);
    const fim = c.data_fim ? dataBR(c.data_fim) : "prazo indeterminado";

    const janela = window.open("", "_blank");
    if (!janela) {
      alert("Permita pop-ups no navegador para visualizar o contrato.");
      return;
    }

    janela.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Contrato - ${i.nome || ""}</title>
<style>
@page{size:A4;margin:1.45cm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.28;color:#111;margin:0}
h1,h2{text-align:center;margin:0}
h1{font-size:15pt}
h2{font-size:12pt;margin-top:4px;margin-bottom:12px}
p{margin:5px 0;text-align:justify}
.dados{border:1px solid #555;padding:8px;margin:8px 0 10px}
.dados p{text-align:left}
.clausula strong{display:block;margin-top:7px}
.assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:25px;text-align:center}
.linha{border-top:1px solid #111;padding-top:5px;margin-top:32px}
.testemunha{width:48%;margin:28px auto 0;text-align:center}
@media print{button{display:none}}
</style>
</head>
<body>
<h1>RESIDENCIAL ARMANDO DE GINO</h1>
<h2>CONTRATO DE LOCAÇÃO RESIDENCIAL</h2>

<div class="dados">
<p><b>LOCAL:</b> PRINCESA ISABEL-PB &nbsp;&nbsp; <b>DATA:</b> ${inicio}</p>
<p><b>LOCADOR:</b> ARMANDO DE GINO</p>
<p><b>LOCATÁRIO:</b> ${i.nome || ""} &nbsp;&nbsp; <b>CPF:</b> ${i.cpf || "Não informado"}</p>
<p><b>IMÓVEL:</b> ${p.nome || ""} &nbsp;&nbsp; <b>APARTAMENTO:</b> ${a.numero || ""}</p>
<p><b>VALOR DO ALUGUEL:</b> ${moeda(c.valor_aluguel)} &nbsp;&nbsp; <b>VENCIMENTO:</b> dia ${c.dia_vencimento} de cada mês.</p>
<p><b>VIGÊNCIA:</b> de ${inicio} até ${fim}.</p>
</div>

<p class="clausula"><strong>1. PAGAMENTO E CONSERVAÇÃO</strong>
O LOCATÁRIO compromete-se a efetuar o pagamento do aluguel na data estabelecida e a conservar o imóvel durante toda a locação.</p>

<p class="clausula"><strong>2. MAU USO E DEVOLUÇÃO</strong>
Em caso de mau uso, danos ou alterações indevidas, o LOCATÁRIO deverá providenciar os reparos necessários e devolver o apartamento nas mesmas condições em que o recebeu, ressalvado apenas o desgaste natural decorrente do uso normal.</p>

<p class="clausula"><strong>3. COMUNICAÇÃO DE PROBLEMAS</strong>
O LOCATÁRIO deverá comunicar ao LOCADOR qualquer problema estrutural ou situação que necessite de reparo no imóvel.</p>

<p class="clausula"><strong>4. ALTERAÇÃO DO VALOR DO ALUGUEL</strong>
O valor do aluguel poderá ser alterado pelo LOCADOR, mediante comunicação prévia ao LOCATÁRIO, por escrito ou por meio eletrônico, antes da entrada em vigor do novo valor.</p>

<p class="clausula"><strong>5. DISPOSIÇÕES GERAIS</strong>
As partes declaram que leram, compreenderam e concordam com todas as condições deste contrato, comprometendo-se a cumpri-las integralmente.</p>

<div class="assinaturas">
<div class="linha"><b>ARMANDO DE GINO</b><br>LOCADOR</div>
<div class="linha"><b>${i.nome || "LOCATÁRIO"}</b><br>LOCATÁRIO</div>
</div>

<div class="testemunha">
<div class="linha"><b>TESTEMUNHA</b><br>CPF: ______________________________</div>
</div>

<script>window.onload=()=>window.print();<\/script>
</body>
</html>`);
    janela.document.close();
  }

  async function encerrar(c) {
    if (!confirm(`Encerrar o contrato de ${c.inquilinos?.nome || "inquilino"}?`)) return;

    const hoje = new Date().toISOString().slice(0, 10);

    const { error } = await supabase
      .from("contratos")
      .update({ status: "encerrado", data_fim: c.data_fim || hoje })
      .eq("id", c.id);

    if (error) return setErro(error.message);

    await supabase
      .from("apartamentos")
      .update({ situacao: "disponivel" })
      .eq("id", c.apartamento_id);

    await supabase
      .from("inquilinos")
      .update({ status: "inativo", data_saida: hoje })
      .eq("id", c.inquilino_id);

    await carregar();
  }

  function selecionarArquivo(c) {
    setContratoUpload(c);
    inputArquivo.current?.click();
  }

  async function enviarArquivo(event) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo || !contratoUpload) return;

    if (arquivo.size > 10 * 1024 * 1024) {
      return alert("O arquivo deve ter no máximo 10 MB.");
    }

    setEnviando(true);
    setErro("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sessão inválida.");

      const extensao = arquivo.name.split(".").pop() || "arquivo";
      const caminho = `${auth.user.id}/${contratoUpload.id}/${Date.now()}.${extensao}`;

      const { error: uploadError } = await supabase.storage
        .from("contratos")
        .upload(caminho, arquivo);

      if (uploadError) throw uploadError;

      const { error: anexoError } = await supabase.from("anexos").insert({
        proprietario_id: auth.user.id,
        inquilino_id: contratoUpload.inquilino_id,
        contrato_id: contratoUpload.id,
        nome_arquivo: arquivo.name,
        caminho_arquivo: caminho,
        tipo_arquivo: arquivo.type || null,
        tamanho_bytes: arquivo.size
      });

      if (anexoError) throw anexoError;
      await carregar();
    } catch (e) {
      setErro(e.message || "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
      setContratoUpload(null);
    }
  }

  async function verAnexo(anexo) {
    const { data, error } = await supabase.storage
      .from("contratos")
      .createSignedUrl(anexo.caminho_arquivo, 300);

    if (error) return setErro(error.message);
    window.open(data.signedUrl, "_blank");
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="contracts-header">
          <div>
            <h2>Contratos</h2>
            <p>Controle dos contratos de locação</p>
          </div>
        </div>

        <div className="contracts-cards">
          <div className="contracts-card">
            <span>Contratos ativos</span><strong>{ativos}</strong>
          </div>
          <div className="contracts-card warning">
            <span>Vencendo em 30 dias</span><strong>{vencendo}</strong>
          </div>
          <div className="contracts-card muted-card">
            <span>Contratos encerrados</span><strong>{encerrados}</strong>
          </div>
        </div>

        <div className="contracts-toolbar">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar inquilino, prédio ou apartamento"
          />
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="ativo">Ativos</option>
            <option value="encerrado">Encerrados</option>
          </select>
        </div>

        {erro && <div className="error">{erro}</div>}

        <input
          ref={inputArquivo}
          type="file"
          accept=".pdf,image/*"
          hidden
          onChange={enviarArquivo}
        />

        <div className="panel table-wrap contracts-table-panel">
          <table className="contracts-table">
            <thead>
              <tr>
                <th>Inquilino</th>
                <th>Prédio</th>
                <th>Apartamento</th>
                <th>Valor</th>
                <th>Vencimento</th>
                <th>Período</th>
                <th>Status</th>
                <th>Anexo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan="9" className="empty-row">Carregando...</td></tr>
              )}

              {!carregando && filtrados.length === 0 && (
                <tr>
                  <td colSpan="9" className="empty-row">
                    Nenhum contrato encontrado.
                  </td>
                </tr>
              )}

              {filtrados.map(c => {
                const anexo = c.anexos?.[c.anexos.length - 1];

                return (
                  <tr key={c.id}>
                    <td><strong>{c.inquilinos?.nome || "-"}</strong></td>
                    <td>{c.apartamentos?.predios?.nome || "-"}</td>
                    <td>{c.apartamentos?.numero || "-"}</td>
                    <td>{moeda(c.valor_aluguel)}</td>
                    <td>Dia {c.dia_vencimento}</td>
                    <td>{dataBR(c.data_inicio)} até {c.data_fim ? dataBR(c.data_fim) : "indeterminado"}</td>
                    <td>
                      <span className={`badge ${c.status}`}>
                        {c.status === "ativo" ? "Ativo" : "Encerrado"}
                      </span>
                    </td>
                    <td>
                      {anexo ? (
                        <button className="link-button" onClick={() => verAnexo(anexo)}>
                          Ver anexo
                        </button>
                      ) : "Sem anexo"}
                    </td>
                    <td>
                      <div className="contract-actions">
                        <button className="secondary" onClick={() => visualizar(c)}>
                          Visualizar
                        </button>
                        <button
                          className="secondary"
                          disabled={enviando}
                          onClick={() => selecionarArquivo(c)}
                        >
                          {enviando && contratoUpload?.id === c.id ? "Enviando..." : "Anexar"}
                        </button>
                        {c.status === "ativo" && (
                          <button className="danger" onClick={() => encerrar(c)}>
                            Encerrar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
