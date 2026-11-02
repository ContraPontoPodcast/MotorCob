// Rótulos legíveis das colunas/atributos de persona (Personas): nunca mostrar o nome técnico da coluna.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTULO_ATRIBUTO_PERSONA, humanizarChave, rotuloAtributoPersona } from '@/lib/personas';

test('personas: colunas conhecidas usam o rótulo do mapa central', () => {
	assert.equal(rotuloAtributoPersona('faixa_idade'), 'Faixa de idade');
	assert.equal(rotuloAtributoPersona('tem_whatsapp'), 'Tem WhatsApp');
	assert.equal(rotuloAtributoPersona('faixa_saldo'), 'Faixa de saldo');
	assert.equal(rotuloAtributoPersona('faixa_atraso'), 'Faixa de atraso');
	assert.equal(rotuloAtributoPersona('ddd'), 'DDD');
	assert.equal(rotuloAtributoPersona(' TEM_EMAIL '), 'Tem e-mail');
});

test('personas: nenhum rótulo do mapa tem cara de nome técnico', () => {
	for (const [chave, rotulo] of Object.entries(ROTULO_ATRIBUTO_PERSONA)) {
		assert.ok(!rotulo.includes('_'), `${chave} → ${rotulo}`);
		assert.equal(rotulo.charAt(0), rotulo.charAt(0).toUpperCase(), `${chave} → ${rotulo}`);
	}
});

test('personas: chave desconhecida vira texto humanizado', () => {
	assert.equal(rotuloAtributoPersona('canal_preferido'), 'Canal preferido');
	assert.equal(rotuloAtributoPersona('qtd__acordos_ativos'), 'Qtd acordos ativos');
	assert.equal(rotuloAtributoPersona('UF_NASC'), 'UF NASC');
	assert.equal(humanizarChave('_x_'), 'X');
	assert.equal(humanizarChave(''), '');
});
