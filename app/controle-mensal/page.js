"use client";

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
            gap:16px;
            margin-bottom:20px;
            flex-wrap:wrap;
          }
          .controle-mensal-header h2{margin:0 0 4px}
          .controle-mensal-header p{margin:0;color:#64748b}
          .controle-mensal-actions{
            display:flex;
            align-items:end;
            gap:10px;
            flex-wrap:wrap;
          }
          .controle-mensal-actions label{
            display:grid;
            gap:6px;
            font-weight:600;
          }
          .controle-mensal-actions input{
            min-height:40px;
            padding:8px 10px;
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
            gap:8px;
            align-items:start;
          }
          .controle-mensal-predio{
            margin-bottom:0;
            padding:10px;
          }
          .controle-mensal-predio-head{
            margin-bottom:6px;
          }
          .controle-mensal-predio-head h3{
            font-size:15px;
            line-height:1.15;
          }
          .controle-mensal-predio-head div{
            font-size:10px;
            margin-top:2px;
            line-height:1.2;
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
            min-width:70px;
            height:18px;
          }
          .controle-mensal-check{
            width:16px;
            height:16px;
            font-size:12px;
            border-width:1.5px;
          }


          .controle-mensal-page-footer{
            display:none;
          }

          @media print{
            @page{size:A4 portrait;margin:15mm}
            .sidebar,
            .controle-mensal-actions,
            .logout-button{
              display:none !important;
            }
            .app-shell{
              display:block !important;
            }
            .content{
              margin:0 !important;
              padding:0 !important;
              width:100% !important;
            }
            body{
              background:white !important;
              counter-reset: page;
            }
            .controle-mensal-page-footer{
              display:block !important;
              position:fixed;
              left:0;
              right:0;
              bottom:-8mm;
              text-align:center;
              font-size:10px;
              color:#475569;
            }
            .controle-mensal-page-footer::after{
              content:" " counter(page);
            }
            .controle-mensal-header{
              margin-bottom:14px;
            }
            .controle-mensal-grid{
              display:block !important;
            }
            .controle-mensal-predio{
              break-inside:auto;
              page-break-inside:auto;
              padding:8px !important;
              margin:0 0 8px 0 !important;
              box-shadow:none !important;
            }
            .controle-mensal-predio-head{
              margin-bottom:4px !important;
            }
            .controle-mensal-predio-head h3{
              font-size:16px !important;
            }
            .controle-mensal-predio-head div{
              font-size:11px !important;
            }
            .controle-mensal-table{
              font-size:11px !important;
              width:100% !important;
            }
            .controle-mensal-table thead{
              display:table-header-group;
            }
            .controle-mensal-table tr{
              break-inside:avoid;
              page-break-inside:avoid;
            }
            .controle-mensal-table th,
            .controle-mensal-table td{
              padding:6px 7px !important;
            }
            .controle-mensal-data{
              min-width:85px !important;
              height:20px !important;
            }
            .controle-mensal-check{
              width:18px !important;
              height:18px !important;
              font-size:13px !important;
            }
          }
        `}</style>

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

        <div className="controle-mensal-page-footer" aria-hidden="true">
          Página
        </div>

      </AppShell>
    </AuthGuard>
  );
}
