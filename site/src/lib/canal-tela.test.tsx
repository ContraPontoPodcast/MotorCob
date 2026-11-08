// Tela do canal (npm test): seções por canal (SPEC §4.3), nada da configuração de antes ficou sem lugar (§4.2), salvar
// por seção só grava os campos dela (empresa e carteira, com a herança), resumos de uma frase, permissão editar_canais,
// Importar playbook só na visão geral, AvisoIdentidade onde se edita mensagem e nenhuma cor fixa na tela nova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { CanalTela } from './canais-config';
import {
	ajustesCarteiraSecao, CAMPOS_CARTEIRA, CAMPOS_SECAO, DE_PARA, lerLinha, linhaEmpresaSecao, padraoCanal, quemExecuta,
	resumoCustos, resumoEnvio, resumoLista, resumoRetorno, SECOES, secoesDoCanal, tipoRetorno, type SecaoId,
} from './canal-tela';
import { CANAIS_TELA } from './estado-canais';

const tela = readFileSync('src/components/canais/canal-tela.tsx', 'utf8');
const SQL86 = readFileSync('../supabase/migrations/20270122000001_canal_tela.sql', 'utf8');

test('seções por canal = matriz do SPEC §4.3', () => {
	const m = (c: string, q: Parameters<typeof secoesDoCanal>[1]) => secoesDoCanal(c, q, false).join(',');
	assert.equal(m('sms', 'motorcx'), 'envio,mensagens,retorno,custos,conexao');
	assert.equal(m('whatsapp', 'motorcx'), 'envio,mensagens,retorno,custos,conexao');
	assert.equal(m('rcs', 'motorcx'), 'envio,mensagens,retorno,custos,conexao');
	assert.equal(m('sms', 'lista'), 'envio,mensagens,lista,retorno,custos');
	assert.equal(m('email', 'lista'), 'envio,lista,retorno,custos');
	assert.equal(m('agente_voz', 'lista'), 'envio,mensagens,lista,retorno,custos');
	assert.equal(m('agente_voz', 'voz_motorcx'), 'envio,mensagens,custos');
	assert.equal(m('discador', 'lista'), 'envio,lista,retorno,custos');
	assert.equal(m('discador', 'voz_motorcx'), 'envio,custos');
	// na carteira: sem mensagens nem conexão (são da empresa); lista e retorno ficam (são por carteira)
	assert.equal(secoesDoCanal('sms', 'motorcx', true).join(','), 'envio,retorno,custos');
	assert.equal(secoesDoCanal('discador', 'lista', true).join(','), 'envio,lista,retorno,custos');
});

test('quem executa: a mesma regra do estado_canais (SQL 84)', () => {
	assert.equal(quemExecuta('sms', null, ['sms'], false), 'motorcx');
	assert.equal(quemExecuta('sms', null, [], false), 'lista');
	assert.equal(quemExecuta('sms', 'lista', ['sms'], false), 'lista');
	assert.equal(quemExecuta('discador', null, [], true), 'voz_motorcx');
	assert.equal(quemExecuta('agente_voz', 'motorcx', ['sms'], false), 'lista');
});

test('nada se perde: todo campo da linha do canal tem seção, e todo destino existe', () => {
	const campos = Object.keys(padraoCanal('sms')).filter(k => k !== 'canal');
	const comSecao = new Set<string>([...CAMPOS_SECAO.envio, ...CAMPOS_SECAO.custos]);
	for (const k of [...campos, 'quem_envia']) assert.ok(comSecao.has(k), `campo sem seção: ${k}`);
	for (const k of CAMPOS_CARTEIRA) assert.ok(comSecao.has(k), `campo da carteira sem seção: ${k}`);
	const existem = new Set<string>();
	for (const c of CANAIS_TELA) for (const q of ['motorcx', 'lista', 'voz_motorcx'] as const) for (const cart of [false, true]) secoesDoCanal(c, q, cart).forEach(s => existem.add(s));
	for (const d of DE_PARA) if (!['topo', 'visao_geral', 'frases'].includes(d.onde)) assert.ok(existem.has(d.onde), `destino sem seção: ${d.item}`);
	assert.ok(DE_PARA.length >= 17);
	// cada seção com formulário tem "Salvar <seção>"
	for (const s of ['envio', 'retorno', 'custos'] as SecaoId[]) assert.match(SECOES[s].salvar ?? '', /^Salvar /);
});

test('salvar por seção (empresa) grava só os campos da seção', () => {
	const r: CanalTela = { ...padraoCanal('discador'), custo: 0.12, capacidade_dia: 500, janela_inicio: '09:00', numeros_por_cliente: 1, respeitar_nao_perturbe: 'sim' };
	const envio = linhaEmpresaSecao(7, 'discador', r, CAMPOS_SECAO.envio);
	assert.deepEqual(Object.keys(envio).sort(), ['canal', 'empresa_id', 'janela_fim', 'janela_inicio', 'numeros_por_cliente', 'respeitar_nao_perturbe', 'sabado', 'tentativas_dia']);
	assert.equal(envio.numeros_por_cliente, null); // 1 = padrão
	assert.equal(envio.respeitar_nao_perturbe, true);
	assert.ok(!('ativo' in envio), 'ativo só no Pausar/Retomar');
	const custos = linhaEmpresaSecao(7, 'discador', r, CAMPOS_SECAO.custos);
	assert.deepEqual(Object.keys(custos).sort(), ['canal', 'capacidade_dia', 'custo', 'empresa_id']);
	// quem envia só nos digitais
	assert.equal(linhaEmpresaSecao(7, 'sms', { ...padraoCanal('sms'), quem_envia: 'lista' }, CAMPOS_SECAO.envio).quem_envia, 'lista');
	assert.ok(!('quem_envia' in linhaEmpresaSecao(7, 'discador', { ...padraoCanal('discador'), quem_envia: 'lista' }, CAMPOS_SECAO.envio)));
	assert.equal(linhaEmpresaSecao(7, 'sms', padraoCanal('sms'), CAMPOS_SECAO.envio).tentativas_dia, null);
});

test('salvar por seção (carteira): o ajuste das outras seções fica, "voltar ao da empresa" tira a chave', () => {
	const salvo = { ...lerLinha('sms', { janela_inicio: '10:00', capacidade_dia: 300, sabado: false }) };
	const sobSalvos = ['janela_inicio', 'capacidade_dia'];
	// salvar Regras de envio mudando o sábado não perde a capacidade (de Custos)
	const r = { ...salvo, sabado: true };
	assert.deepEqual(ajustesCarteiraSecao('sms', CAMPOS_SECAO.envio, salvo, sobSalvos, r, [...sobSalvos, 'sabado']),
		{ janela_inicio: '10:00', sabado: true, capacidade_dia: 300 });
	// voltar ao da empresa no horário (sai do rascunho) mantém a capacidade
	assert.deepEqual(ajustesCarteiraSecao('sms', CAMPOS_SECAO.envio, salvo, sobSalvos, salvo, ['capacidade_dia']), { capacidade_dia: 300 });
	// salvar Custos voltando a capacidade não mexe no horário
	assert.deepEqual(ajustesCarteiraSecao('sms', CAMPOS_SECAO.custos, salvo, sobSalvos, salvo, ['janela_inicio']), { janela_inicio: '10:00' });
	// ajuste nulo herda: a chave sai
	assert.deepEqual(ajustesCarteiraSecao('sms', CAMPOS_SECAO.custos, salvo, sobSalvos, { ...salvo, capacidade_dia: null }, sobSalvos), { janela_inicio: '10:00' });
	// desligar só nesta carteira
	assert.deepEqual(ajustesCarteiraSecao('sms', CAMPOS_SECAO.envio, salvo, [], { ...salvo, ativo: false }, ['ativo']), { ativo: false });
});

test('resumos de uma frase', () => {
	const r = { ...padraoCanal('sms'), janela_inicio: '09:00' };
	assert.equal(resumoEnvio('sms', r, { carteira: false, quem: 'motorcx', aprovarLotes: false }),
		'Seg–sex 09:00–20:00 · sábado até 14:00 · 1 número por cliente · Não Perturbe: padrão · o lote sai sozinho');
	assert.match(resumoEnvio('discador', { ...padraoCanal('discador'), numeros_por_cliente: 99 }, { carteira: false, quem: 'lista' }), /3 tentativas por dia · todos os números/);
	assert.match(resumoEnvio('sms', { ...r, ativo: false }, { carteira: true, quem: 'motorcx' }), /^desligado nesta carteira/);
	assert.equal(resumoCustos({ ...r, custo: 0.08, capacidade_dia: 50000 }, { carteira: false, centro: 'Cobrança SMS' }),
		'R$ 0,08 por ação · até 50.000 por dia · centro de custo “Cobrança SMS”');
	assert.equal(resumoCustos(r, { carteira: true }), 'sem limite por dia');
	assert.match(resumoRetorno('sms', null), /^Número inexistente: suspensão escalonada · 3 falhas seguidas pausam por 30 dias · .*50%.*\(sugestão MotorCX\)$/);
	assert.match(resumoRetorno('discador', { temporarios_pausa: 0 }), /falha temporária não pausa/);
	assert.match(resumoRetorno('email', null), /^Hard bounce: tirar de vez/);
	assert.equal(resumoLista({ mapeado: null, semMapear: 2, ultimaLista: 'hoje (40 números)' }), 'Última lista: hoje (40 números) · retorno ainda não chegou · 2 códigos sem mapear');
	assert.equal(tipoRetorno('agente_voz'), 'canal_voz');
	assert.equal(tipoRetorno('whatsapp'), 'canal_whatsapp');
});

test('permissão: editar_canais para editar, editar_credores no retorno, só leitura sem elas', () => {
	assert.match(tela, /usePermissao\(PERM\.editarCanais\)/);
	assert.match(tela, /usePermissao\(PERM\.editarCredores\)/);
	assert.doesNotMatch(tela, /useAllowed/);
	assert.match(tela, /\{podeCanais && \(pausado/); // Pausar/Retomar só com editar_canais
	assert.match(tela, /Só leitura/);
});

test('Testar agora aparece desligado com "em breve" (PR 9)', () => {
	assert.match(tela, /<Botao tipo="secundario" disabled>Testar agora<\/Botao>/);
	assert.match(tela, /em breve/);
});

test('Importar playbook existe uma vez, no topo da visão geral', () => {
	const achados = execSync('grep -rl "ImportarPlaybookModal" src --include=*.tsx').toString().trim().split('\n').filter(f => !f.endsWith('importar-playbook.tsx') && !f.endsWith('.test.tsx'));
	assert.deepEqual(achados, ['src/components/canais/visao-geral.tsx']);
});

test('mensagens editadas na tela do canal passam pelo editor com o AvisoIdentidade', () => {
	assert.match(tela, /<FrasesTab canal=\{p\.canal\} \/>/);
	assert.match(readFileSync('src/components/canais/frases.tsx', 'utf8'), /<AvisoIdentidade/);
});

test('tela nova sem cor fixa (só tokens do tema)', () => {
	for (const f of ['src/components/canais/canal-tela.tsx', 'src/components/canais/frases-pagina.tsx']) {
		const s = readFileSync(f, 'utf8').replace(/text-white/g, '');
		assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b|bg-white|bg-slate|text-slate/, f);
	}
});

test('SQL 86: pausado desde guardado e a carteira com editar_canais', () => {
	assert.match(SQL86, /add column if not exists pausado_em timestamptz/);
	assert.match(SQL86, /coalesce\(ce0\.pausado_em, ce0\.atualizado_em\)/);
	assert.match(SQL86, /create policy credor_canais_gravar[\s\S]*pode\('editar_canais'\)/);
	assert.doesNotMatch(SQL86.split('-- ================================================================ 3.')[1], /tem_papel/);
});
