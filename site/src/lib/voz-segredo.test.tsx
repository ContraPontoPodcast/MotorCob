// Referência da senha do tronco (Console › Agente virtual › tronco): só voz/... cabe no que a VM lê do cofre
// (motorcx-voz-*). Tronco já salvo com outra referência continua salvando enquanto ela não muda (como no banco, SQL 67).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segredoTroncoOk } from '@/lib/voz';

test('tronco: a referência da senha começa com voz/', () => {
	assert.equal(segredoTroncoOk('voz/trunk/aurora-opc'), true);
	assert.equal(segredoTroncoOk(' voz/alfa/sp-2 '), true);
	assert.equal(segredoTroncoOk('sip/aurora-opc'), false);
	assert.equal(segredoTroncoOk('voz/'), false);
	assert.equal(segredoTroncoOk('voz/com espaço'), false);
	assert.equal(segredoTroncoOk('motorcx-voz-trunk-1'), false);
});

test('tronco: referência antiga só passa se não mudou', () => {
	assert.equal(segredoTroncoOk('sip/aurora-opc', 'sip/aurora-opc'), true);
	assert.equal(segredoTroncoOk('sip/aurora-opd', 'sip/aurora-opc'), false);
	assert.equal(segredoTroncoOk('', ''), false);
});
