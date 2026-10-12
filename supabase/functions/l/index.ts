// Edge Function l: encurtador de links do MotorCob. https://<domínio curto>/<código> → registra o clique → destino.
// Publicar com "Verify JWT" DESLIGADO (quem clica não tem login). A chave service_role vem só da variável de
// ambiente do servidor; o banco só deixa esta função chamar registrar_clique.
import { codigoDoCaminho, destinoSeguro, dispositivo } from "./regras.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cab = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

// o Supabase não serve HTML pelas funções (troca para text/plain): as mensagens vão como texto simples
const pagina = (texto: string, status: number) =>
  new Response(texto, { status, headers: { ...cab, "Content-Type": "text/plain; charset=utf-8" } });

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
