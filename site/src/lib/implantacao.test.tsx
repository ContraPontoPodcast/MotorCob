// Assistente de implantação (SQL 74) e mapeamento da carga geral: regras puras da tela.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
	CANAIS_ASSISTENTE, FERIADOS, FRASES_PADRAO_SMS, checklist, heroi, passoInicial, passosFeitos, podeMotorcx, proximaLista,
	quemEnviaAtual, resumoCarga, textoPrevia, type Situacao,
} from '@/lib/implantacao';
import { combinar, decodificarXml, exemplo, faltam, lerCsv, lerXlsx, mensagemFaltam, paraSalvar, reconhecer, validar } from '@/lib/mapeamento-carga';
import { quemEnviaTela, linhasEmpresa, CANAIS_CONFIGURAVEIS, type CanalTela } from '@/lib/canais-config';
import { filtrarAtalhos, ATALHOS } from '@/components/workspace/workspace-command-palette';
import { ABAS } from '@/lib/abas';

function sit(extra: Partial<Situacao> = {}): Situacao {
	return {
		hoje: '2026-11-06', empresa: { id: 7, nome: 'Aurora (fictícia)', slug: 'aurora', situacao: 'implantacao' },
		progresso: { passo: 2, feitos: [1] }, preco: { preco: 0.38, minimo: 1500, modelo: 'flat' },
		admin: { convidado: true, entrou: false, nome: 'Renata' }, recebe_fatura: false, contatos: [],
		carteira: { id: 3, codigo: 'principal', nome: 'Banco Horizonte', entrada_carga: 'arquivo' }, carteiras: 1,
		carga: null, mapeamento: null, execucao: null, lista: null, canais: {},
		mensageria: { contratada: false, canais: [], modo: null, aprovar_lotes: null, aprovar_primeiro: null, pedido_aberto: false },
		agente_voz: false, frases_sms: [], ocorrencia_mapeada: false, equipe_convidada: false, estrategias: 0, previa: null,
		...extra,
	};
}
const processada: Partial<Situacao> = {
	carga: { id: 1, tipo: 'base', status: 'processado', arquivo: 'c.csv', enviado_em: '2026-11-06T10:00:00Z', relatorio: { na_carga: 3000 } },
	execucao: { data: '2026-11-06', status: 'ok', terminada_em: '2026-11-06T10:02:00Z', erro: null, clientes: 3000, na_carga: 3000, contatos: { WHATSAPP: 100, NEUTRO: 7000, INVALIDO: 8 }, fila: { whatsapp: 2868 }, sem_acao: { sem_contato: 132 } },
	lista: { data: '2026-11-06', acoes: 4554, clientes: 2868, por_canal: { whatsapp: 2868 } },
};

test('padrão do dono: SMS e e-mail em lista para baixar; RCS e voz desligados', () => {
	const p = Object.fromEntries(CANAIS_ASSISTENTE.map(c => [c.id, quemEnviaAtual(sit(), c.id, c.padrao)]));
	assert.deepEqual(p, { whatsapp: 'lista', sms: 'lista', email: 'lista', rcs: 'desligado', discador: 'desligado', agente_voz: 'desligado' });
	assert.equal(quemEnviaAtual(sit({ canais: { sms: { ativo: true, quem_envia: 'motorcx' } } }), 'sms', 'lista'), 'motorcx');
	assert.equal(quemEnviaAtual(sit({ canais: { sms: { ativo: false, quem_envia: 'motorcx' } } }), 'sms', 'lista'), 'desligado');
});

test('MotorCX só envia o canal coberto pela Mensageria, nunca voz', () => {
	assert.equal(podeMotorcx(sit(), 'sms'), false);
	const m = sit({ mensageria: { contratada: true, canais: ['sms'], modo: 'simulado', aprovar_lotes: true, aprovar_primeiro: false, pedido_aberto: false } });
	assert.equal(podeMotorcx(m, 'sms'), true);
	assert.equal(podeMotorcx(m, 'email'), false);
	assert.equal(podeMotorcx(m, 'discador'), false);
	assert.equal(quemEnviaTela('sms', null, ['sms']), 'motorcx');      // Canais: sem nada salvo = como antes
	assert.equal(quemEnviaTela('email', null, ['sms']), 'lista');
	assert.equal(quemEnviaTela('sms', 'lista', ['sms']), 'lista');
});

test('Canais grava quem envia só nos canais digitais', () => {
	const pad: Record<string, CanalTela> = Object.fromEntries(CANAIS_CONFIGURAVEIS.map(c => [c, { canal: c, ativo: true, janela_inicio: null, janela_fim: null, sabado: true, capacidade_dia: null, custo: null, tentativas_dia: null, respeitar_nao_perturbe: '', numeros_por_cliente: null, produto_padrao: null }]));
	const l = linhasEmpresa('1', { sms: { ...pad.sms, quem_envia: 'lista' }, discador: { ...pad.discador, quem_envia: 'lista' } }, pad);
	assert.equal(l.find(x => x.canal === 'sms')?.quem_envia, 'lista');
	assert.ok(!('quem_envia' in (l.find(x => x.canal === 'discador') ?? {})));
	assert.ok(!('quem_envia' in (l.find(x => x.canal === 'email') ?? {})));       // nada escolhido: não grava
});

test('primeira Lista do dia: minutos depois da carga, nunca "às 6h da manhã seguinte"', () => {
	assert.match(proximaLista(sit()), /minutos depois da primeira carga/);
	assert.match(proximaLista(sit({ carga: { id: 1, tipo: 'base', status: 'pendente', arquivo: 'c', enviado_em: '', relatorio: null } })), /minutos depois da carga/);
	assert.match(proximaLista(sit({ carga: { id: 1, tipo: 'base', status: 'aguardando', arquivo: 'c', enviado_em: '', relatorio: null } })), /apontar as colunas/);
	assert.equal(proximaLista(sit({ ...processada })), 'amanhã, 07/11, às 06:00 (domingo e feriado não têm ação)');
	assert.match(proximaLista(sit({ ...processada, hoje: '2026-11-07' })), /^segunda, 09\/11/);   // sábado → pula o domingo
	assert.match(proximaLista(sit({ ...processada, hoje: '2026-11-19' })), /^sábado, 21\/11/);    // 20/11 é feriado
});

test('feriados iguais aos do motor (regras/regua.json)', () => {
	const regua = JSON.parse(readFileSync(join(process.cwd(), '..', 'regras', 'regua.json'), 'utf-8'));
	assert.deepEqual(FERIADOS, regua.janela.feriados);
});

test('checklist: sem carga, vermelho para rodar; preço e fatura pela linha certa', () => {
	const g = checklist(sit(), { equipe: true });
	const item = (id: string) => g.flatMap(x => x.itens).find(i => i.id === id)!;
	assert.equal(item('preco').estado, 'ok');
	assert.match(item('preco').detalhe, /R\$\s?0,38 por CPF · mínimo R\$\s?1\.500,00/);
	assert.equal(item('carga').estado, 'bloqueia');
	assert.equal(item('carga').acao?.passo, 3);
	assert.equal(item('fatura').estado, 'atencao');
	assert.equal(item('fatura').acao?.fazer, 'contato_fatura');
	assert.equal(item('admin').acao?.fazer, 'reenviar_convite');
	assert.equal(checklist(sit(), { equipe: false }).flatMap(x => x.itens).find(i => i.id === 'admin')?.acao, undefined);
	assert.equal(heroi(g), 'Falta 1 coisa para a Orquestração rodar.');
	assert.ok(!g.some(x => x.titulo === 'Para as mensagens saírem'));       // só lista: nada de envio real
	assert.ok(g.some(x => x.titulo === 'Listas para o seu fornecedor'));
});

test('checklist: carga esperando colunas diz o que falta em português', () => {
	const s = sit({ carga: { id: 1, tipo: 'base', status: 'aguardando', arquivo: 'c', enviado_em: '', relatorio: { faltam: ['saldo', 'contato'] } } });
	const r = resumoCarga(s);
	assert.equal(r.titulo, 'Faltou apontar 2 colunas: o saldo e o telefone ou o e-mail.');
	assert.equal(checklist(s, { equipe: false })[0].itens.find(i => i.id === 'carga')?.acao?.rotulo, 'Apontar colunas');
});

test('checklist: carga processada + MotorCX enviando pede frases, envio real e aprovação', () => {
	const s = sit({ ...processada, canais: { sms: { ativo: true, quem_envia: 'motorcx' } },
		mensageria: { contratada: true, canais: ['sms', 'email'], modo: 'simulado', aprovar_lotes: true, aprovar_primeiro: false, pedido_aberto: false }, frases_sms: ['localizacao'] });
	const g = checklist(s, { equipe: true });
	const item = (id: string) => g.flatMap(x => x.itens).find(i => i.id === id)!;
	assert.equal(item('carga').estado, 'ok');
	assert.equal(item('contatos').detalhe, '96% dos clientes têm telefone ou e-mail válido');
	assert.equal(item('frases').detalhe, `1 de ${FRASES_PADRAO_SMS.length} etapas com frase`);
	assert.equal(item('real').estado, 'bloqueia');
	assert.equal(item('real').acao?.to, '/console/implantacao');
	assert.equal(item('aprovacao').estado, 'atencao');
	assert.equal(heroi(g), 'A Orquestração já está rodando. Falta 2 coisas para as mensagens saírem de verdade.');
	const pronto = sit({ ...s, mensageria: { ...s.mensageria, modo: 'real', aprovar_primeiro: true }, frases_sms: FRASES_PADRAO_SMS.map(f => f.estagio) });
	assert.equal(heroi(checklist(pronto, { equipe: true })), 'Tudo pronto: a Orquestração está rodando.');
});

test('progresso: retoma onde parou, sem passar do primeiro passo que falta', () => {
	assert.equal(passoInicial(null), 1);
	assert.equal(passoInicial(sit()), 2);
	assert.equal(passoInicial(sit({ progresso: { passo: 4, feitos: [1, 2] } })), 3);
	const quase = sit({ ...processada, progresso: { passo: 5, feitos: [1, 2, 4] } });
	assert.equal(passoInicial(quase), 5);
	assert.deepEqual([...passosFeitos(quase)].sort(), [1, 2, 3, 4, 5]);
});

test('prévia da fatura: CPFs × preço', () => {
	const p = textoPrevia(sit({ previa: { competencia: '2026-11-01', cpfs: 9140, preco: 0.38, valor: 3473.2 } }))!;
	assert.equal(p.cpfs, '9.140');
	assert.match(p.valor, /3\.473,20/);
	assert.match(p.conta, /^9\.140 × R\$\s?0,38/);
});

test('frases padrão cabem no SMS (160) mesmo com nome longo e sem dado pessoal', () => {
	for (const f of FRASES_PADRAO_SMS) {
		const t = f.texto('Assessoria de Cobrança Horizonte Ltda');
		assert.ok(t.length <= 160, `${f.estagio}: ${t.length}`);
		assert.ok(!/\{nome\}|\{cpf\}|\{telefone\}/.test(t));
	}
});

// ------------------------------------------------------------------ mapeamento da carga geral
const CAB = ['COD_CLIENTE', 'NUM_CONTRATO', 'VL_ATUALIZADO', 'DIAS_ATRASO', 'CEL1', 'CEL2', 'FONE_RES', 'EMAIL', 'CPF_CNPJ'];

test('reconhece as colunas usuais (como o motor)', () => {
	assert.deepEqual(reconhecer(CAB), { cpf: 'CPF_CNPJ', id_cliente: 'COD_CLIENTE', id_contrato: 'NUM_CONTRATO', saldo: 'VL_ATUALIZADO', dias_atraso: 'DIAS_ATRASO', telefones: ['CEL1', 'CEL2', 'FONE_RES'], emails: ['EMAIL'] });
	assert.deepEqual(faltam(reconhecer(CAB)), []);
});

test('colunas desconhecidas: diz o que falta e valida antes de salvar', () => {
	const cab = ['IDENT', 'MONTANTE', 'DATA_REF', 'NUM1', 'DOC'];
	const r = reconhecer(cab);
	assert.equal(r.cpf, 'DOC');                                              // DOC é o CPF: o cliente está coberto
	assert.deepEqual(faltam(r), ['saldo', 'atraso', 'contato']);
	assert.deepEqual(faltam({}), ['cliente', 'saldo', 'atraso', 'contato']);
	assert.equal(mensagemFaltam(['saldo']), 'Faltou apontar 1 coluna: o saldo.');
	assert.equal(validar(r, cab), 'Faltou apontar 3 colunas: o saldo, os dias de atraso (ou o vencimento) e o telefone ou o e-mail.');
	const ok = { id_cliente: 'IDENT', saldo: 'MONTANTE', vencimento: 'DATA_REF', telefones: ['NUM1'] };
	assert.equal(validar(ok, cab), '');
	assert.match(validar({ ...ok, cpf: 'IDENT' }, cab), /mais de um campo/);
	assert.match(validar({ ...ok, saldo: 'SALDO_X' }, cab), /não está no arquivo/);
	assert.deepEqual(paraSalvar({ ...ok, emails: [] }), ok);
});

test('o salvo vence o reconhecido; coluna que sumiu cai fora', () => {
	const c = combinar({ saldo: 'VL_ORIGINAL', telefones: ['CEL1'], id_contrato: 'SUMIU' }, reconhecer([...CAB, 'VL_ORIGINAL']), [...CAB, 'VL_ORIGINAL']);
	assert.equal(c.saldo, 'VL_ORIGINAL');
	assert.deepEqual(c.telefones, ['CEL1']);
	assert.equal(c.id_contrato, 'NUM_CONTRATO');
	assert.equal(combinar({ vencimento: 'VENC' }, { dias_atraso: 'DIAS' }, ['VENC', 'DIAS']).dias_atraso, undefined);
});

test('exemplos de dado pessoal sempre mascarados', () => {
	assert.equal(exemplo('cpf', '123.456.789-09'), '•••.•••.•••-••');
	assert.equal(exemplo('telefones', '(11) 98888-0012'), '(••) •••••-••12');
	assert.equal(exemplo('emails', 'ana@exemplo.invalid'), '••••@exemplo.invalid');
	assert.equal(exemplo('saldo', '1.842,15'), '1.842,15');
});

test('lê CSV (; e Latin-1) e XLSX no navegador, sem biblioteca de planilha', () => {
	const latin = new Uint8Array([...'CÓDIGO;SALDO\nA1;10,00\n'].map(ch => ch.charCodeAt(0)));
	const c = lerCsv(latin);
	assert.deepEqual(c.cabecalho, ['CÓDIGO', 'SALDO']);
	assert.equal(c.separador, ';');
	assert.deepEqual(lerCsv(strToU8('a,"b,c",d\n1,2,3\n')).cabecalho, ['a', 'b,c', 'd']);
	const xlsx = zipSync({
		'xl/sharedStrings.xml': strToU8('<sst><si><t>COD</t></si><si><t>SALDO</t></si><si><t>A1</t></si></sst>'),
		'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>10.5</v></c></row></sheetData></worksheet>'),
	});
	assert.equal(decodificarXml('A &amp;lt; B &amp;amp; C &#233;'), 'A &lt; B &amp; C é');   // uma passada só
	const x = lerXlsx(xlsx);
	assert.deepEqual(x.cabecalho, ['COD', 'SALDO']);
	assert.deepEqual(x.linhas[0], ['A1', '10.5']);
});

// ------------------------------------------------------------------ ganhos rápidos: menu e ⌘K
test('menu: as Regras de discagem saíram da Cobrança e são a aba Discagem do Agente Voz/CX', () => {
	const cobranca = ABAS.cobranca!.grupos.flatMap(g => g.abas);
	assert.ok(!cobranca.some(a => a.to === '/discagem' || a.nome === 'Regras de discagem'));
	const voz = ABAS.voz!.grupos.flatMap(g => g.abas);
	assert.ok(voz.some(a => a.nome === 'Discagem' && a.to === '/voz/discagem'));
});

test('⌘K acha Discagem, Carteiras, Cargas e Orquestração por sinônimo e sem acento', () => {
	const areas = { cobranca: true, jornada: false, mensageria: false };
	const perms = ['enviar_arquivos', 'editar_canais'];
	const achar = (q: string) => filtrarAtalhos(ATALHOS, q, perms, areas).map(a => a.id);
	assert.ok(achar('renitencia').includes('discagem'));
	assert.ok(achar('rediscagem').includes('discagem'));
	assert.ok(achar('horário de ligar').includes('discagem'));
	assert.ok(achar('credor').includes('carteiras'));
	assert.ok(achar('mailing').includes('cargas'));
	assert.ok(achar('regua').includes('orquestracao'));
	assert.ok(achar('onboarding').includes('implantacao'));
	assert.ok(!filtrarAtalhos(ATALHOS, 'mailing', [], areas).some(a => a.id === 'cargas'));          // sem permissão
	assert.ok(!filtrarAtalhos(ATALHOS, 'credor', perms, { cobranca: false, jornada: true, mensageria: false }).some(a => a.id === 'carteiras'));
});
