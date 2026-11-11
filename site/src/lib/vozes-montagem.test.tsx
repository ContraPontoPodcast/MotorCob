// Voz do agente por empresa (Console › Agente virtual › Voz do agente): nomes amigáveis das vozes liberadas na VM.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOZES_MONTAGEM, nomeVoz } from '@/lib/voz';

test('vozes: quatro liberadas, a primeira é a padrão, sem repetir', () => {
	assert.equal(VOZES_MONTAGEM.length, 4);
	assert.equal(VOZES_MONTAGEM[0].nome, 'Voz 1 (padrão)');
	assert.equal(new Set(VOZES_MONTAGEM.map(v => v.id)).size, 4);
	assert.ok(VOZES_MONTAGEM.every(v => /^[A-Za-z0-9_-]{2,80}$/.test(v.id)));
});

test('vozes: nome da voz guardada', () => {
	assert.equal(nomeVoz(null), 'Voz 1 (padrão)');
	assert.equal(nomeVoz(''), 'Voz 1 (padrão)');
	assert.equal(nomeVoz('RGymW84CSmfVugnA5tvA'), 'Voz 2');
	assert.equal(nomeVoz('4J31DrhygVjvFsoj7BsM'), 'Voz 4');
	assert.match(nomeVoz('outraQualquer'), /não liberada/);
});
