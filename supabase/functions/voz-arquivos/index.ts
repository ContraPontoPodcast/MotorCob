// Edge Function voz-arquivos: a VM de voz (acesso próprio, SQL 57) baixa a Lista do dia do bucket saidas e sobe o
// retorno no bucket entradas SEM ter a chave do servidor; a geração de fluxo (SQL 58) apaga os anexos que o banco já
// liberou (entradas ou chamados). Ela manda um bilhete de uso único que o banco emitiu
// (voz_vm.bilhete_arquivo) para UM caminho validado lá; aqui o bilhete é trocado pela operação
// (consumir_bilhete_voz, só service_role) e o Storage é chamado com a chave que só existe no ambiente da função.
// Publicar com "Verify JWT" DESLIGADO (quem chama não tem login do Supabase; a autorização é o bilhete).
//   POST /functions/v1/voz-arquivos   x-voz-bilhete: <64 hex>   x-voz-operacao: baixar | enviar | apagar
import { bilheteDoCabecalho, operacaoDoCabecalho, sha256Hex, tamanhoAceito, urlObjeto, usoValido } from "./regras.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cab = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const servidor = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };
const texto = (t: string, status: number) =>
  new Response(t, { status, headers: { ...cab, "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return texto("use POST", 405);
  const bilhete = bilheteDoCabecalho(req.headers);
  const pedida = operacaoDoCabecalho(req.headers);
  if (!bilhete || !pedida) return texto("bilhete ou operação ausente", 401);
  if (pedida === "enviar" && !tamanhoAceito(req.headers.get("content-length"))) return texto("arquivo acima de 20 MB", 413);

  const r = await fetch(`${URL_SB}/rest/v1/rpc/consumir_bilhete_voz`, {
    method: "POST",
    headers: { ...servidor, "Content-Type": "application/json" },
    body: JSON.stringify({ bilhete_hash: await sha256Hex(bilhete) }),
  });
  if (!r.ok) return texto("banco indisponível", 503);
  const uso = usoValido(await r.json(), pedida);
  if (!uso) return texto("bilhete inválido, vencido ou já usado", 403);
  const alvo = urlObjeto(URL_SB, uso.bucket, uso.caminho);

  if (uso.operacao === "baixar") {
    const s = await fetch(alvo, { headers: servidor });
    if (!s.ok) return texto("arquivo não encontrado", s.status === 400 || s.status === 404 ? 404 : 502);
    return new Response(s.body, { status: 200, headers: { ...cab, "Content-Type": "application/octet-stream" } });
  }
  if (uso.operacao === "enviar") {
    const corpo = new Uint8Array(await req.arrayBuffer());
    if (!tamanhoAceito(String(corpo.byteLength), corpo.byteLength)) return texto("arquivo vazio ou acima de 20 MB", 413);
    const s = await fetch(alvo, {
      method: "POST",
      headers: { ...servidor, "Content-Type": "text/csv", "x-upsert": "false" },
      body: corpo,
    });
    return s.ok ? texto("ok", 201) : texto("falha ao gravar", s.status === 409 ? 409 : 502);
  }
  const s = await fetch(`${URL_SB}/storage/v1/object/${uso.bucket}`, {
    method: "DELETE",
    headers: { ...servidor, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [uso.caminho] }),
  });
  return s.ok ? texto("ok", 200) : texto("falha ao apagar", 502);
});
