"use client";

import "../ui-standard.css";

import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabase";

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function competenciaAtual() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

function formatarData(data) {
  if (!data) return "";
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR");
}

export default function ControleMensal() {
  const [mes, setMes] = useState(competenciaAtual());
  const [apartamentos, setApartamentos] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [recebimentos, setRecebimentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    carregar();
  }, [mes]);

  async function carregar() {
    setCarregando(true);
    setErro("");

    const competencia = `${mes}-01`;

    const [apt, con, rec] = await Promise.all([
      supabase
        .from("apartamentos")
        .select(`
          id,
          numero,
          situacao,
          predio_id,
          predios(id,nome,endereco)
        `)
        .order("numero"),
      supabase
        .from("contratos")
        .select(`
          id,
          apartamento_id,
          valor_aluguel,
          data_inicio,
          data_fim,
          status,
          inquilinos(id,nome,status)
        `)
        .order("data_inicio"),
      supabase
        .from("recebimentos")
        .select(`
          id,
          contrato_id,
          competencia,
          valor_previsto,
          valor_recebido,
          data_pagamento,
          status
        `)
        .eq("competencia", competencia)
    ]);

    const falha = apt.error || con.error || rec.error;
    if (falha) {
      setErro(falha.message);
      setApartamentos([]);
      setContratos([]);
      setRecebimentos([]);
      setCarregando(false);
      return;
    }

    setApartamentos(apt.data || []);
    setContratos(con.data || []);
    setRecebimentos(rec.data || []);
    setCarregando(false);
  }

  const linhas = useMemo(() => {
    const porContrato = new Map(
      recebimentos.map((r) => [r.contrato_id, r])
    );

    const contratosDoMes = contratos.filter((c) => {
      const inicio = c.data_inicio?.slice(0, 7);
      const fim = c.data_fim?.slice(0, 7);
      return (!inicio || inicio <= mes) && (!fim || fim >= mes);
    });

    const contratoPorApartamento = new Map();
    contratosDoMes.forEach((contrato) => {
      const atual = contratoPorApartamento.get(contrato.apartamento_id);

      // Se houver mais de um registro, prioriza o contrato ativo.
      if (!atual || contrato.status === "ativo") {
        contratoPorApartamento.set(contrato.apartamento_id, contrato);
      }
    });

    return apartamentos
      .filter((a) => a.predios)
      .map((a) => {
        const contrato = contratoPorApartamento.get(a.id);
        const recebimento = contrato ? porContrato.get(contrato.id) : null;

        return {
          contratoId: contrato?.id || `sem-contrato-${a.id}`,
          predioId: a.predios.id,
          predioNome: a.predios.nome,
          predioEndereco: a.predios.endereco || "",
          apartamento: a.numero || "",
          inquilino: contrato?.inquilinos?.nome || "—",
          valor: contrato
            ? (recebimento?.valor_previsto ?? contrato.valor_aluguel ?? 0)
            : null,
          dataPagamento: recebimento?.data_pagamento || "",
          pago:
            recebimento?.status === "pago" ||
            Number(recebimento?.valor_recebido || 0) > 0
        };
      })
      .sort((a, b) => {
        const predio = a.predioNome.localeCompare(b.predioNome, "pt-BR");
        if (predio !== 0) return predio;
        return String(a.apartamento).localeCompare(String(b.apartamento), "pt-BR", {
          numeric: true
        });
      });
  }, [apartamentos, contratos, recebimentos, mes]);

  const grupos = useMemo(() => {
    const mapa = new Map();

    linhas.forEach((linha) => {
      if (!mapa.has(linha.predioId)) {
        mapa.set(linha.predioId, {
          id: linha.predioId,
          nome: linha.predioNome,
          endereco: linha.predioEndereco,
          linhas: []
        });
      }
      mapa.get(linha.predioId).linhas.push(linha);
    });

    return Array.from(mapa.values());
  }, [linhas]);

  function imprimir() {
    window.print();
  }

  return (
    <AuthGuard>
      <AppShell>
        <style>{`
          .controle-mensal-header{
            display:flex;
            justify-content:space-between;
            align-items:end;
            gap:12px;
            margin-bottom:14px;
            flex-wrap:wrap;
          }
          .controle-mensal-header h2{margin:0 0 2px;font-size:20px;line-height:1.15}
          .controle-mensal-header p{margin:0;color:#64748b;font-size:12px}
          .controle-mensal-actions{
            display:flex;
            align-items:end;
            gap:8px;
            flex-wrap:wrap;
          }
          .controle-mensal-actions label{
            display:grid;
            gap:4px;
            font-weight:600;
            font-size:12px;
          }
          .controle-mensal-actions input{
            min-height:34px;
            padding:6px 9px;
            border:1px solid #cbd5e1;
            border-radius:8px;
          }
          .controle-mensal-predio{
            margin-bottom:24px;
            break-inside:avoid;
          }
          .controle-mensal-predio-head{
            margin-bottom:10px;
          }
          .controle-mensal-predio-head h3{
            margin:0;
            font-size:20px;
          }
          .controle-mensal-predio-head div{
            color:#64748b;
            font-size:14px;
            margin-top:3px;
          }
          .controle-mensal-table{
            width:100%;
            border-collapse:collapse;
          }
          .controle-mensal-table th,
          .controle-mensal-table td{
            border:1px solid #cbd5e1;
            padding:10px;
            text-align:left;
          }
          .controle-mensal-table th{
            background:#eef4fa;
            font-weight:700;
          }
          .controle-mensal-data{
            min-width:120px;
            height:28px;
            border-bottom:1px solid #64748b;
            display:inline-block;
          }
          .controle-mensal-check{
            width:22px;
            height:22px;
            border:2px solid #475569;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            font-weight:900;
            font-size:16px;
          }

          .controle-mensal-grid{
            display:grid;
            grid-template-columns:1fr;
            gap:6px;
            align-items:start;
          }
          .controle-mensal-predio{
            margin-bottom:0;
            padding:7px 8px;
          }
          .controle-mensal-predio-head{
            margin-bottom:4px;
          }
          .controle-mensal-predio-head h3{
            font-size:14px;
            line-height:1.1;
          }
          .controle-mensal-predio-head div{
            font-size:10px;
            margin-top:1px;
            line-height:1.1;
          }
          .controle-mensal-table{
            font-size:10px;
          }
          .controle-mensal-table th,
          .controle-mensal-table td{
            padding:4px 5px;
            line-height:1.15;
          }
          .controle-mensal-data{
            min-width:68px;
            height:16px;
          }
          .controle-mensal-check{
            width:15px;
            height:15px;
            font-size:11px;
            border-width:1.5px;
          }


          @media screen{
            .controle-mensal-predio.panel{
              border-radius:8px;
              box-shadow:0 2px 8px rgba(30,60,90,.04);
            }

            .controle-mensal-table th{
              font-size:10px;
              padding-top:5px;
              padding-bottom:5px;
            }

            .controle-mensal-table td{
              font-size:11px;
            }

            .controle-mensal-actions .primary{
              min-height:34px;
              padding:6px 11px;
              font-size:12px;
            }
          }

          .controle-mensal-page-footer{
            display:none;
          }

          .controle-print-header{
            display:none;
          }

          @media print{
            @page{
              size:A4 portrait;
              margin:10mm 9mm 12mm 9mm;

              @bottom-center{
                content:"Página " counter(page) " de " counter(pages);
                font-size:9px;
                color:#475569;
              }
            }

            .sidebar,
            .controle-mensal-actions,
            .logout-button,
            .controle-mensal-header,
            .controle-mensal-page-footer{
              display:none !important;
            }

            html,
            body{
              margin:0 !important;
              padding:0 !important;
              background:#fff !important;
              -webkit-print-color-adjust:exact;
              print-color-adjust:exact;
            }

            .app-shell{
              display:block !important;
            }

            .content{
              margin:0 !important;
              padding:0 !important;
              width:100% !important;
              max-width:none !important;
            }

            .controle-print-header{
              display:block !important;
              text-align:center;
              margin:0 0 7px 0;
            }

            .controle-print-header h2{
              margin:0;
              font-size:18px;
              line-height:1.15;
              color:#0f2d52;
            }

            .controle-print-header div{
              margin-top:2px;
              font-size:10px;
              line-height:1.2;
              color:#64748b;
            }

            .controle-mensal-grid{
              display:block !important;
            }

            .controle-mensal-predio{
              display:block !important;
              margin:0 !important;
              padding:0 !important;
              border:0 !important;
              border-radius:0 !important;
              box-shadow:none !important;
              background:transparent !important;
              break-inside:auto !important;
              page-break-inside:auto !important;
            }

            .controle-mensal-predio-head{
              margin:0 !important;
              padding:4px 6px 3px !important;
              border:1px solid #cbd5e1 !important;
              border-bottom:0 !important;
              background:#f8fafc !important;
              break-after:avoid !important;
              page-break-after:avoid !important;
            }

            .controle-mensal-predio-head h3{
              margin:0 !important;
              font-size:11px !important;
              line-height:1.12 !important;
              color:#0f2d52 !important;
            }

            .controle-mensal-predio-head div{
              margin-top:1px !important;
              font-size:8px !important;
              line-height:1.1 !important;
              color:#64748b !important;
            }

            .controle-mensal-table{
              width:100% !important;
              border-collapse:collapse !important;
              table-layout:fixed !important;
              margin:0 0 4px 0 !important;
              font-size:9px !important;
              break-inside:auto !important;
              page-break-inside:auto !important;
            }

            .controle-mensal-table thead{
              display:table-header-group !important;
            }

            .controle-mensal-table tbody{
              display:table-row-group !important;
            }

            .controle-mensal-table tr{
              break-inside:avoid !important;
              page-break-inside:avoid !important;
            }

            .controle-mensal-table th,
            .controle-mensal-table td{
              box-sizing:border-box !important;
              border:1px solid #cbd5e1 !important;
              padding:3px 5px !important;
              line-height:1.1 !important;
              vertical-align:middle !important;
              height:auto !important;
            }

            .controle-mensal-table th{
              background:#eef4fa !important;
              font-weight:700 !important;
            }

            .controle-mensal-table th:nth-child(1),
            .controle-mensal-table td:nth-child(1){
              width:11% !important;
            }

            .controle-mensal-table th:nth-child(2),
            .controle-mensal-table td:nth-child(2){
              width:39% !important;
            }

            .controle-mensal-table th:nth-child(3),
            .controle-mensal-table td:nth-child(3){
              width:15% !important;
            }

            .controle-mensal-table th:nth-child(4),
            .controle-mensal-table td:nth-child(4){
              width:24% !important;
            }

            .controle-mensal-table th:nth-child(5),
            .controle-mensal-table td:nth-child(5){
              width:11% !important;
              text-align:center !important;
            }

            .controle-mensal-data{
              min-width:72px !important;
              width:72px !important;
              height:13px !important;
              border-bottom:1px solid #64748b !important;
            }

            .controle-mensal-check{
              width:14px !important;
              height:14px !important;
              font-size:10px !important;
              border-width:1px !important;
            }

            .error{
              display:none !important;
            }
          }
        `}</style>

        <div className="controle-print-header" aria-hidden="true">
          <h2>Controle Mensal</h2>
          <div>Mês de referência: {mes.split("-").reverse().join("/")}</div>
        </div>

        <div className="controle-mensal-header">
          <div>
            <h2>Controle Mensal</h2>
            <p>Folha para acompanhamento manual dos aluguéis</p>
          </div>

          <div className="controle-mensal-actions">
            <label>
              Mês
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              />
            </label>

            <button className="primary" onClick={imprimir}>
              Imprimir / Salvar PDF
            </button>
          </div>
        </div>

        {erro && <div className="error">{erro}</div>}

        {carregando && (
          <div className="panel">Carregando controle mensal...</div>
        )}

        {!carregando && grupos.length === 0 && (
          <div className="panel">
            Nenhum contrato encontrado para este mês.
          </div>
        )}

        {!carregando && grupos.length > 0 && (
          <div className="controle-mensal-grid">
            {grupos.map((grupo) => (
              <section className="panel controle-mensal-predio" key={grupo.id}>
                <div className="controle-mensal-predio-head">
                  <h3>{grupo.nome}</h3>
                  {grupo.endereco && <div>{grupo.endereco}</div>}
                </div>

                <table className="controle-mensal-table">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Apto</th>
                      <th>Inquilino</th>
                      <th style={{ width: 130 }}>Aluguel</th>
                      <th style={{ width: 150 }}>Data do pagamento</th>
                      <th style={{ width: 70, textAlign: "center" }}>Pago</th>
                    </tr>
                  </thead>

                  <tbody>
                    {grupo.linhas.map((linha) => (
                      <tr key={linha.contratoId}>
                        <td>{linha.apartamento || "—"}</td>
                        <td>{linha.inquilino}</td>
                        <td>{linha.valor == null ? "—" : moeda(linha.valor)}</td>
                        <td>
                          {linha.dataPagamento ? (
                            formatarData(linha.dataPagamento)
                          ) : (
                            <span className="controle-mensal-data" />
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className="controle-mensal-check">
                            {linha.pago ? "✓" : ""}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

              </section>
            ))}
          </div>
        )}


      </AppShell>
    </AuthGuard>
  );
}
