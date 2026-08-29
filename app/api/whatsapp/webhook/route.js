import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(challenge || "", { status: 200 });
  }

  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(request) {
  // Mantemos o webhook aceitando eventos da Meta para a integração ficar pronta
  // para confirmações de entrega/leitura e respostas do cliente em um próximo bloco.
  await request.json().catch(() => null);
  return NextResponse.json({ ok: true });
}
