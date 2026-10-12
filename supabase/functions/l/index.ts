// Edge Function l: encurtador de links do MotorCob. https://<domínio curto>/<código> → registra o clique → destino.
// Publicar com "Verify JWT" DESLIGADO (quem clica não tem login). A chave service_role vem só da variável de
// ambiente do servidor; o banco só deixa esta função chamar registrar_clique.
import { codigoDoCaminho, destinoSeguro, dispositivo } from "./regras.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cab = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

const pagina = (titulo: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<title>${titulo}</title><body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;` +
    `min-height:90vh;color:#1D1D1F"><p>${titulo}</p></body>`,
    { status, headers: { ...cab, "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const codigo = codigoDoCaminho(new URL(req.url).pathname);
  if (!codigo) return pagina("Link inválido.", 404);
  const r = await fetch(`${URL_SB}/rest/v1/rpc/registrar_clique`, {
    method: "POST",
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo, dispositivo: dispositivo(req.method, req.headers.get("user-agent")) }),
  });
  if (!r.ok) return pagina("Não foi possível abrir o link agora. Tente de novo em instantes.", 503);
  const destino = destinoSeguro(await r.json());
  if (!destino) return pagina("Este link expirou.", 410);
  return new Response(null, { status: 302, headers: { ...cab, Location: destino } });
});
