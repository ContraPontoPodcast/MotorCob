// SQL 83 · B6/B7 (npm test): a abertura avisa gravação e assistente virtual e nunca diz o credor nem a dívida antes de
// confirmar o titular; o prompt padrão do roteiro e as fixturas do fluxo seguem a mesma trava.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FALA_PADRAO_ROTEIRO, PROMPT_PADRAO_ROTEIRO, aberturaFixa, promptCredorAntesIdentidade } from './voz';
import { definicaoV5 } from '@/components/fluxo/fixturas';

const SENSIVEL = /\{\{\s*(credor|saldo|dias_atraso|vencimento)\s*\}\}|credor|d[íi]vida|d[ée]bito|contrato|em aberto/i;

test('abertura: aviso de gravação (se ligado), assistente virtual e só a pergunta de identificação', () => {
	assert.equal(aberturaFixa(true), 'Olá! Esta ligação é gravada. Sou o assistente virtual da {{assessoria}}. Falo com {{primeiro_nome}}?');
	assert.equal(aberturaFixa(false), 'Olá! Sou o assistente virtual da {{assessoria}}. Falo com {{primeiro_nome}}?');
	assert.doesNotMatch(aberturaFixa(true), SENSIVEL);
});

test('prompt padrão do roteiro: credor só depois de confirmar o titular', () => {
	assert.equal(promptCredorAntesIdentidade(PROMPT_PADRAO_ROTEIRO), false);
	assert.ok(PROMPT_PADRAO_ROTEIRO.indexOf('{{credor}}') > PROMPT_PADRAO_ROTEIRO.indexOf('titular'));
	assert.match(PROMPT_PADRAO_ROTEIRO, /Falo com \{\{primeiro_nome\}\}\?/);
	assert.match(FALA_PADRAO_ROTEIRO, /\{\{credor\}\}/);          // dita depois da confirmação (rótulo da tela)
	// o padrão antigo (e cópias dele) recebe o aviso na tela
	assert.equal(promptCredorAntesIdentidade('Você é o agente virtual da {{assessoria}}, em nome de {{credor}}. Seja cordial. Confirme que fala com o titular.'), true);
	assert.equal(promptCredorAntesIdentidade('Fale em nome de {{ credor }}.'), true);
	assert.equal(promptCredorAntesIdentidade('Confirme o titular e depois diga que fala em nome de {{credor}}.'), false);
});

test('fixturas do fluxo: abertura sem credor e conversa de demonstração sem o credor antes da identidade', () => {
	const n1 = definicaoV5().blocos.find(b => b.id === 'N1');
	assert.doesNotMatch(String(n1?.params.fala), SENSIVEL);
	const fonte = readFileSync(join(process.cwd(), 'src', 'components', 'fluxo', 'fixturas.ts'), 'utf8');   // npm test roda em site/
	assert.doesNotMatch(fonte, /em nome d[eoa] \{\{credor\}\}|em nome do Varejo Aurora/);
});
