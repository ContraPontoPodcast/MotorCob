// SQL 113 · Telefonia T4: campos que a operadora pede (E.164, prefixo opcional, DTMF, cabeçalho da bina, liga para).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CABECALHOS_BINA, DTMFS, FORMATOS_DISCAGEM, LIGA_PARA, RE_REALM, prefixoOk, prefixoRota } from '@/lib/voz';

test('tronco: formatos incluem +55 (E.164) e os campos novos têm os mesmos códigos do banco', () => {
	assert.deepEqual(FORMATOS_DISCAGEM.map(f => f.id), ['tech_ddd_numero', 'tech_0_csp_ddd_numero', 'tech_55_ddd_numero', 'tech_e164']);
	assert.deepEqual(DTMFS.map(d => d.id), ['auto', 'rfc4733', 'inband', 'info']);
	assert.deepEqual(CABECALHOS_BINA.map(d => d.id), ['from_pai', 'from', 'rpid']);
	assert.deepEqual(LIGA_PARA.find(l => l.id === 'movel')?.tipos, ['movel_vc1', 'movel_vc2_vc3']);
});

test('prefixo da operadora é opcional e a rota sem prefixo mostra "—"', () => {
	assert.equal(prefixoOk(''), true);
	assert.equal(prefixoOk('1021'), true);
	assert.equal(prefixoOk('123456789'), false);
	assert.equal(prefixoOk('12a'), false);
	assert.equal(prefixoRota({ tech_prefix: '04412345', enviar_prefixo: false }), '—');
	assert.equal(prefixoRota({ tech_prefix: '1021', enviar_prefixo: true }), '1021');
});

test('realm: nome de host', () => {
	assert.equal(RE_REALM.test('sip.operadora.example'), true);
	assert.equal(RE_REALM.test('a b'), false);
});
