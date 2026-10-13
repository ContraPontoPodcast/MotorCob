import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashNumero, iguais, infobip, lerCorpo, locaweb, normalizar, sinch, zenvia } from "./regras.ts";

const h = (n: string) => createHash("sha256").update(n).digest("hex");

test("hash do número igual ao do motor (sem o 55)", async () => {
  assert.equal(normalizar("+55 (11) 98765-4321"), "11987654321");
  assert.equal(normalizar("11987654321"), "11987654321");
  assert.equal(await hashNumero("5511987654321"), h("11987654321"));
});

test("Zenvia: status e resposta", async () => {
  const st = await zenvia({ id: "ev1", type: "MESSAGE_STATUS", channel: "sms", message: { id: "m1" },
    messageStatus: { code: "NOT_DELIVERED", timestamp: "2026-10-14T13:00:00Z", causes: [{ reason: "INVALID_NUMBER", details: "número inexistente" }] } });
  assert.deepEqual(st, [{ fornecedor: "zenvia", evento_id: "ev1", id_externo: "m1", tipo: "falhou", canal: "sms",
    motivo: "INVALID_NUMBER: número inexistente", ocorrido_em: "2026-10-14T13:00:00.000Z" }]);
  assert.equal((await zenvia({ id: "ev2", type: "MESSAGE_STATUS", messageStatus: { code: "SENT" }, message: { id: "m1" } }))[0].tipo, "enviado");
  assert.deepEqual(await zenvia({ id: "ev3", type: "MESSAGE_STATUS", messageStatus: { code: "CLICKED" }, message: { id: "m1" } }), []);
  const r = await zenvia({ id: "ev4", type: "MESSAGE", channel: "sms", message: { direction: "IN", from: "5511987654321",
    contents: [{ type: "text", text: "Me manda o boleto" }] } });
  assert.equal(r[0].tipo, "resposta");
  assert.equal(r[0].de_hash, h("11987654321"));
  assert.equal(r[0].texto, "Me manda o boleto");
  assert.equal(JSON.stringify(r).includes("98765"), false);              // o número não vai para o banco
});

test("Infobip: entrega em lote e resposta", async () => {
  const r = await infobip({ results: [
    { messageId: "a", status: { groupName: "DELIVERED", name: "DELIVERED_TO_HANDSET" }, doneAt: "2026-10-14T13:00:00.000+0000" },
    { messageId: "b", status: { groupName: "UNDELIVERABLE", name: "UNDELIVERABLE_NOT_DELIVERED", description: "Message sent not delivered" } },
    { messageId: "c", status: { groupName: "PENDING", name: "PENDING_ENROUTE" } },
    { messageId: "d", from: "5521912345678", to: "29090", text: "SAIR", receivedAt: "2026-10-14T13:01:00.000+0000" },
  ] });
  assert.deepEqual(r.map((e) => e.tipo), ["entregue", "falhou", "enviado", "resposta"]);
  assert.equal(r[0].evento_id, "a:DELIVERED_TO_HANDSET");
  assert.equal(r[1].motivo, "Message sent not delivered");
  assert.equal(r[3].de_hash, h("21912345678"));
});

test("Sinch: relatório por destinatário e resposta", async () => {
  const r = await sinch({ type: "recipient_delivery_report_sms", batch_id: "B1", recipient: "+5511987654321", code: 401,
    status: "Dispatched", at: "2026-10-14T13:00:00Z" });
  assert.deepEqual([r[0].tipo, r[0].id_externo, r[0].evento_id], ["enviado", "B1", "B1:Dispatched:401"]);
  assert.equal(JSON.stringify(r).includes("98765"), false);
  assert.equal((await sinch({ type: "recipient_delivery_report_sms", batch_id: "B1", status: "Failed", code: 402 }))[0].motivo, "Failed (código 402)");
  assert.deepEqual(await sinch({ type: "recipient_delivery_report_sms", batch_id: "B1", status: "Queued" }), []);
  assert.equal((await sinch({ type: "mo_text", id: "mo1", from: "+5511987654321", body: "ok" }))[0].tipo, "resposta");
});

test("Locaweb: bounce permanente, temporário e abertura (formulário)", () => {
  const corpo = lerCorpo("bounce_code=550&bounce_description=User+unknown&x-smtplw=777&to=ana%40exemplo.com",
    "application/x-www-form-urlencoded");
  const b = locaweb(corpo);
  assert.deepEqual([b[0].tipo, b[0].bounce, b[0].id_externo], ["bounce", "permanente", "777"]);
  assert.equal(JSON.stringify(b).includes("ana@"), false);              // o e-mail não vai para o banco
  assert.equal(locaweb({ "x-smtplw": "778", bounce_code: "452", bounce_description: "mailbox full" })[0].bounce, "temporario");
  assert.equal(locaweb({ "x-smtplw": "779", opened_at: "2026-10-14 10:00:00" })[0].tipo, "abertura");
  assert.deepEqual(locaweb({ opened_at: "x" }), []);
});

test("token da URL em tempo constante", () => {
  assert.equal(iguais("abc", "abc"), true);
  assert.equal(iguais("abc", "abd"), false);
  assert.equal(iguais("", ""), false);
});
