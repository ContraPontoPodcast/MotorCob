// Edge Function retorno-mensageria: recebe os avisos dos fornecedores da Mensageria (entrega, falha, resposta do
// cliente, bounce e abertura) e grava em mensageria_eventos para o motor aplicar (nuvem/retornos.py).
// * Endereço de cada fornecedor: .../functions/v1/retorno-mensageria/{zenvia|infobip|sinch|locaweb}?t=<RETORNO_TOKEN>
// * Publicar com "Verify JWT" DESLIGADO (quem chama é o fornecedor). O token da URL é conferido aqui; sem ele, 401.
// * Nada de número ou e-mail do cliente no banco: a resposta vai só com o hash do número e o texto.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Evento, FORNECEDORES, iguais, infobip, lerCorpo, locaweb, sinch, zenvia } from "./regras.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const TOKEN = Deno.env.get("RETORNO_TOKEN") ?? "";
const resp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const forn = url.pathname.split("/").filter(Boolean).pop() as (typeof FORNECEDORES)[number];
  if (!FORNECEDORES.includes(forn)) return resp({ erro: "fornecedor desconhecido" }, 404);
  const token = url.searchParams.get("t") ?? req.headers.get("x-retorno-token") ?? "";
  if (!TOKEN || !iguais(token, TOKEN)) return resp({ erro: "não autorizado" }, 401);
  if (req.method === "GET") return resp({ ok: true });                  // teste do endereço no painel do fornecedor
  if (req.method !== "POST") return resp({ erro: "use POST" }, 405);
  const texto = await req.text();
  if (texto.length > 2_000_000) return resp({ erro: "aviso grande demais" }, 413);
  const corpo = lerCorpo(texto, req.headers.get("Content-Type"));
  let eventos: Evento[] = [];
  try {
    eventos = forn === "zenvia" ? await zenvia(corpo) : forn === "infobip" ? await infobip(corpo)
      : forn === "sinch" ? await sinch(corpo) : locaweb(corpo);
  } catch (e) {
    console.error("retorno", forn, (e as Error).message);
    return resp({ ignorado: true });                                    // formato desconhecido: não pede reenvio
  }
  if (!eventos.length) return resp({ ignorado: true });
  const linhas = eventos.map((e) => ({ ...e, ocorrido_em: e.ocorrido_em ?? new Date().toISOString() }));
  const { error } = await admin.from("mensageria_eventos")
    .upsert(linhas, { onConflict: "fornecedor,evento_id", ignoreDuplicates: true });
  if (error) {
    console.error("retorno", forn, error.message);
    return resp({ erro: "falha ao gravar" }, 500);                      // o fornecedor tenta de novo
  }
  return resp({ recebidos: linhas.length });
});
