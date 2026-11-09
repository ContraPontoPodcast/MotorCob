// Agente de voz e Speech Analytics na Contratação (SQL 87; npm test): as duas chaves com o texto aprovado, nas duas
// telas (cadastro novo e edição), gravadas em empresa_modulos; a área Speech Analytics passa a depender do módulo
// speech_analytics (as Gravações seguem com a Cobrança); "Avisar o Admin" pede speech_analytics; ⌘K e Assistente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linhasModulos, MODULOS_VAZIO, MODULOS_VOZ, nomesModulos } from './contratacao-modulos';
import { alvoDoPedido, areaDoContrato, contratoDaRota } from './area-rota';
import { ABAS } from './abas';
import { rotaDaAcao } from './assistente';
import { ATALHOS, filtrarAtalhos } from '@/components/workspace/workspace-command-palette';

const tela = readFileSync('src/components/workspace/empresa/contratacao-empresa.tsx', 'utf8');
const SQL87 = readFileSync('../supabase/migrations/20270123000001_modulos_voz_speech.sql', 'utf8');

test('Contratação: as duas chaves com o texto aprovado, no cadastro novo e na edição', () => {
	assert.deepEqual(MODULOS_VOZ, [
		{ id: 'agente_voz', nome: 'Agente de voz', desc: 'O agente de IA liga, conversa e transfere para os seus operadores.' },
		{ id: 'speech_analytics', nome: 'Speech Analytics', desc: 'Análise das ligações do agente e do discador: notas, motivos, alertas.' },
	]);
	// uma lista para o cadastro novo (Secao "Módulos") e outra para a edição (PainelEdicao "Motor e módulos")
	assert.equal(tela.match(/MODULOS_VOZ\.map\(m => <SwitchLinha/g)?.length, 2);
	// as duas gravações (salvarTudo e salvarMotorModulos) usam as mesmas linhas
	assert.equal(tela.match(/linhasModulos\(/g)?.length, 2);
	assert.ok(!/modulo: 'enriquecimento'/.test(tela), 'as linhas ficam só em lib/contratacao-modulos.ts');
});

test('Contratação: grava as sete linhas de empresa_modulos e mostra os nomes no resumo', () => {
	const linhas = linhasModulos('7', { ...MODULOS_VAZIO, agente_voz: true, mensageria: true }, ['sms']);
	assert.deepEqual(linhas.map(l => l.modulo), ['orquestracao', 'jornada', 'mensageria', 'api', 'enriquecimento', 'agente_voz', 'speech_analytics']);
	assert.deepEqual(linhas.filter(l => l.ativo).map(l => l.modulo), ['mensageria', 'agente_voz']);
	assert.ok(linhas.every(l => l.empresa_id === '7'));
	assert.deepEqual(linhas.find(l => l.modulo === 'mensageria')?.canais, ['sms']);
	assert.deepEqual(linhas.find(l => l.modulo === 'speech_analytics')?.canais, []);
	assert.deepEqual(nomesModulos({ ...MODULOS_VAZIO, orquestracao: true, agente_voz: true, speech_analytics: true }), ['Orquestração', 'Agente de voz', 'Speech Analytics']);
	assert.deepEqual(nomesModulos(MODULOS_VAZIO), []);
	// o banco aceita os dois módulos (o check do SQL 87)
	assert.match(SQL87, /'agente_voz', 'speech_analytics'\)\);/);
});

test('Speech Analytics depende do módulo; Gravações seguem com a Cobrança; Agente Voz/CX com a Cobrança', () => {
	assert.equal(areaDoContrato('speech'), 'speech');
	assert.equal(areaDoContrato('voz'), 'cobranca');
	for (const r of ['/speech-analytics', '/speech-analytics/alertas', '/speech-analytics/entrada', '/speech-analytics/entrada/enviar', '/insights-voz', '/envios/gravacoes-discador']) {
		assert.equal(contratoDaRota(r), 'speech', r);
	}
	for (const r of ['/speech-analytics/gravacoes', '/gravacoes', '/voz', '/voz/agente', '/fila']) assert.equal(contratoDaRota(r), 'cobranca', r);
	assert.equal(contratoDaRota('/relatorios'), null);
	assert.equal(alvoDoPedido('speech'), 'speech_analytics');
	assert.equal(alvoDoPedido('cobranca'), 'cobranca');
	const abas = ABAS.speech!.grupos.flatMap(g => g.abas);
	assert.deepEqual(abas.map(a => [a.nome, a.requerArea ?? null]), [['Visão geral', 'speech'], ['Gravações', null], ['Entrada de gravações', 'speech']]);
});

test('⌘K e Assistente: Speech Analytics só com o módulo; Gravações com a Cobrança', () => {
	const perms = ['ouvir_gravacoes'];
	const ids = (areas: Parameters<typeof filtrarAtalhos>[3]) => filtrarAtalhos(ATALHOS, '', perms, areas).map(a => a.id);
	const semSpeech = ids({ cobranca: true, jornada: false, mensageria: false, speech: false });
	assert.ok(!semSpeech.includes('speech') && !semSpeech.includes('entrada-gravacoes'));
	assert.ok(semSpeech.includes('gravacoes') && semSpeech.includes('agente-voz-cx'));
	const comSpeech = ids({ cobranca: false, jornada: false, mensageria: false, speech: true });
	assert.ok(comSpeech.includes('speech') && comSpeech.includes('entrada-gravacoes') && !comSpeech.includes('gravacoes'));
	// Assistente: as telas do agente continuam com a Cobrança, com ou sem o Speech
	assert.equal(rotaDaAcao('abrir_agente_virtual', [], undefined, { cobranca: true, jornada: false, mensageria: false, speech: false }), '/voz/agente');
});

test('banco: voz_config.speech_analytics segue o módulo, backfill e Avisar o Admin', () => {
	assert.match(SQL87, /create trigger speech_do_modulo after insert or update of ativo or delete on public\.empresa_modulos/);
	assert.match(SQL87, /create trigger modulo_do_speech after insert or update of speech_analytics on public\.voz_config/);
	assert.match(SQL87, /from public\.voz_config c\s+where c\.speech_analytics\s+on conflict \(empresa_id, modulo\) do update set ativo = true/);
	assert.match(SQL87, /'mensageria', 'speech_analytics'\) then/);
	assert.ok(!/preco\s*=|precos_empresa/.test(SQL87.replace(/--.*$/gm, '')), 'nenhum preço muda');
});
