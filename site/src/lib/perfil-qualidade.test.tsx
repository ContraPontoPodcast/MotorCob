// Perfil Qualidade (SQL 89; npm test): só a área Speech Analytics. Rotas liberadas, contrato das Gravações, padrão de
// permissões igual ao do banco, ⌘K só com o Speech e a conta, e o perfil na lista de convite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contratoDaRota, rotaLiberadaSoSpeech } from './area-rota';
import { PERFIS_INFO, PERMISSOES_QUALIDADE, PERMISSOES_SPEECH, nomePerfil, padraoDoPerfil, perfilPodeTer, perfilSoSpeech } from './perfis-info';
import { ATALHOS, filtrarAtalhos } from '@/components/workspace/workspace-command-palette';

const SQL89 = readFileSync('../supabase/migrations/20270125000001_perfil_qualidade.sql', 'utf8');
const lista = (fn: string) => {
	const m = SQL89.match(new RegExp(`function public\\.${fn}\\(\\) returns text\\[\\][\\s\\S]*?array\\[([^\\]]*)\\]`));
	return (m?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
};

test('Qualidade: só o Speech Analytics e a própria conta', () => {
	for (const r of ['/speech-analytics', '/speech-analytics/qualidade', '/speech-analytics/gravacoes', '/conta', '/conta/seguranca']) {
		assert.ok(rotaLiberadaSoSpeech(r), r);
	}
	for (const r of ['/inicio', '/fila', '/clientes', '/voz', '/voz/agente', '/mensageria', '/jornada', '/relatorios', '/empresa',
		'/empresa/pessoas', '/suporte', '/console', '/speech-analyticsx', '/contas', '/docs']) {
		assert.ok(!rotaLiberadaSoSpeech(r), r);
	}
});

test('Qualidade: as Gravações ficam no Speech (pedem o módulo speech_analytics, não a Cobrança)', () => {
	assert.equal(contratoDaRota('/speech-analytics/gravacoes'), 'cobranca');
	assert.equal(contratoDaRota('/speech-analytics/gravacoes', true), 'speech');
	assert.equal(contratoDaRota('/speech-analytics', true), 'speech');
	assert.equal(contratoDaRota('/fila', true), 'cobranca');
});

test('Qualidade: padrão e teto de permissões iguais aos do banco', () => {
	assert.deepEqual([...PERMISSOES_SPEECH].sort(), lista('permissoes_speech').sort());
	assert.deepEqual([...PERMISSOES_QUALIDADE].sort(), lista('permissoes_qualidade').sort());
	assert.ok(!PERMISSOES_QUALIDADE.includes('editar_checklist'), 'editar o checklist fica com o Admin');
	assert.equal(padraoDoPerfil('qualidade', 'ver_alertas', { qualidade: false }), true);
	assert.equal(padraoDoPerfil('qualidade', 'baixar_listas', { baixar_listas: true }), false);
	assert.equal(padraoDoPerfil('gestao', 'ver_alertas', { gestao: true }), true);
	assert.equal(perfilPodeTer('qualidade', 'editar_checklist'), true);
	assert.equal(perfilPodeTer('qualidade', 'ver_clientes'), false);
	assert.equal(perfilPodeTer('operacao', 'ver_clientes'), true);
});

test('Qualidade: perfil na lista de convite e na troca de perfil', () => {
	const q = PERFIS_INFO.find(p => p.id === 'qualidade');
	assert.ok(q);
	assert.match(q.desc, /só a área Speech Analytics/);
	assert.equal(nomePerfil('qualidade'), 'Qualidade');
	assert.equal(perfilSoSpeech({ papel: 'qualidade', equipe: false }), true);
	assert.equal(perfilSoSpeech({ papel: 'qualidade', equipe: true }), false);
	assert.equal(perfilSoSpeech({ papel: 'gestao', equipe: false }), false);
});

test('Qualidade: ⌘K só com o Speech, as Gravações e a conta', () => {
	const perms = ['ouvir_gravacoes', 'ver_transcricoes'];
	const ids = filtrarAtalhos(ATALHOS, '', perms, { cobranca: false, jornada: false, mensageria: false, speech: true, soSpeech: true }).map(a => a.id);
	assert.deepEqual(ids.sort(), ['2fa', 'conta', 'entrada-gravacoes', 'gravacoes', 'speech'].sort());
	const semModulo = filtrarAtalhos(ATALHOS, '', perms, { cobranca: false, jornada: false, mensageria: false, speech: false, soSpeech: true }).map(a => a.id);
	assert.deepEqual(semModulo.sort(), ['2fa', 'conta', 'gravacoes'].sort());
	assert.ok(!filtrarAtalhos(ATALHOS, 'chamado', perms, { cobranca: true, jornada: true, mensageria: true, speech: true, soSpeech: true }).length);
});
