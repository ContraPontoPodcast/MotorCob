// Regras do encurtador de links (sem dependência do Supabase, para testar com node --test).

export const CODIGO = /^[A-Za-z0-9]{7,12}$/;

// o código é o último pedaço do caminho: /l/Ab12Cd34, /functions/v1/l/Ab12Cd34 ou /Ab12Cd34 (domínio curto)
export function codigoDoCaminho(caminho: string): string | null {
  const ultimo = caminho.replace(/\/+$/, "").split("/").pop() ?? "";
  return CODIGO.test(ultimo) ? ultimo : null;
}

// prévias de link (WhatsApp, redes, antivírus de e-mail) abrem o endereço sozinhas: contam como robô, não como clique
const ROBOS = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin|twitter|curl|wget|python|go-http|headless|scanner|safelinks|proofpoint|mimecast/i;

export function dispositivo(metodo: string, agente: string | null): "celular" | "computador" | "robo" | "outro" {
  const a = agente ?? "";
  if (metodo !== "GET" || !a || ROBOS.test(a)) return "robo";
  if (/android|iphone|ipad|mobile/i.test(a)) return "celular";
  if (/windows|macintosh|linux|cros/i.test(a)) return "computador";
  return "outro";
}

export function destinoSeguro(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
