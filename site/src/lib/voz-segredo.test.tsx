// Referência da senha do tronco (Console › Agente virtual › tronco): só voz/... cabe no que a VM lê do cofre
// (motorcx-voz-*). Tronco já salvo com outra referência continua salvando enquanto ela não muda (como no banco, SQL 67).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipsMotivo, ipsPendentes, lerIps, segredoTroncoOk, senhaTroncoMotivo } from '@/lib/voz';

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

test('SQL 103: senha do tronco (a mesma regra da Edge Function segredo-tronco-voz)', () => {
	assert.equal(senhaTroncoMotivo('Senha-Ficticia;123'), null);
	assert.match(senhaTroncoMotivo('curta') ?? '', /de 8 a 128/);
	assert.match(senhaTroncoMotivo('x'.repeat(129)) ?? '', /de 8 a 128/);
	assert.match(senhaTroncoMotivo('linha\nquebrada') ?? '', /quebra de linha/);
	assert.match(senhaTroncoMotivo(' com-espaco') ?? '', /espaço/);
});

test('SQL 104: IPs da operadora para o firewall (forma e tamanho; a regra completa é do banco e da VM)', () => {
	assert.deepEqual(lerIps(' 200.1.1.1\n200.2.2.0/24, 200.1.1.1;'), ['200.1.1.1', '200.2.2.0/24']);
	assert.equal(ipsMotivo(['200.1.1.1', '200.2.2.0/24']), null);
	assert.match(ipsMotivo(['200.2.0.0/16']) ?? '', /até \/24/);
	assert.match(ipsMotivo(['0.0.0.0/0']) ?? '', /até \/24/);
	assert.match(ipsMotivo(['300.1.1.1']) ?? '', /não é um IPv4/);
	assert.match(ipsMotivo(['sbc.operadora.com']) ?? '', /não é um IPv4/);
	assert.match(ipsMotivo(Array.from({ length: 21 }, (_, i) => `200.1.1.${i}`)) ?? '', /No máximo 20/);
	assert.deepEqual(ipsPendentes({ ips_operadora: ['200.1.1.1/32', '200.2.2.0/24'], ips_liberados: ['200.2.2.0/24'] }), ['200.1.1.1/32']);
	assert.deepEqual(ipsPendentes(null), []);
});
