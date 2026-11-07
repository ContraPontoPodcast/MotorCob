// "Hoje" do cliente: a pílula leva só o rótulo curto (nunca o texto longo do motor) e o motivo inteiro fica no title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotivoHoje, partirMotivoHoje } from './motivo-hoje';

const LONGO = 'sem ação: giro sem passo hoje (ou pausado aguardando enriquecimento)';

test('partirMotivoHoje: com ação, sem ação (com motivo), não avaliado e texto desconhecido', () => {
	assert.deepEqual(partirMotivoHoje('com ação hoje'), { rotulo: 'Com ação', detalhe: '', tom: 'ok' });
	assert.deepEqual(partirMotivoHoje(LONGO), { rotulo: 'Sem ação', detalhe: 'giro sem passo hoje (ou pausado aguardando enriquecimento)', tom: 'atencao' });
	assert.deepEqual(partirMotivoHoje('não avaliado hoje'), { rotulo: 'Não avaliado', detalhe: '', tom: 'neutro' });
	assert.equal(partirMotivoHoje('outra coisa').detalhe, 'outra coisa');
});

test('MotivoHoje compacto: pílula curta sem quebra, motivo cortado e texto inteiro no title', () => {
	const s = renderToStaticMarkup(<MotivoHoje motivo={LONGO} compacto />);
	const pilula = s.match(/<span[^>]*rounded-full[^>]*>([^<]*)<\/span>/);
	assert.ok(pilula, s);
	assert.equal(pilula[1], 'Sem ação');
	assert.match(pilula[0], /whitespace-nowrap/);
	assert.match(s, /class="block w-full truncate[^"]*">giro sem passo hoje/);
	assert.match(s, /title="sem ação: giro sem passo hoje \(ou pausado aguardando enriquecimento\)"/);
	// só tokens do tema (vale no claro e no escuro)
	assert.ok(!/#[0-9a-f]{6}/i.test(s), s);
});

test('MotivoHoje vazio mostra traço', () => {
	assert.match(renderToStaticMarkup(<MotivoHoje motivo={null} />), />—</);
});
