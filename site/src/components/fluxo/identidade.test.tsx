// Confirmar identidade (SQL 88) renderizado de verdade (react-dom/server), sem banco: as 4 fontes com a recomendada,
// as perguntas na ordem com a reserva, as recusadas, os erros no dia; o Roteiro e o Mapa dizem quem confere; e o grupo
// "Para o agente de voz" da carga nunca mostra o valor e aceita "usar o CPF/CNPJ já apontado".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
	alternar, comQuantas, comoHoje, resumoCarga, inicial, mover, paraSalvarIdentidade, recomendada, textoFonte, textoPerguntas, usaArquivo, validarIdentidade,
	type ConfigIdentidade,
} from '@/lib/identidade-mailing';
import { FormIdentidade, IdentidadeAgente } from '@/components/fluxo/identidade';
import { QuemConfere, Roteiro } from '@/components/fluxo/roteiro';
import { Quadro } from '@/components/fluxo/quadro';
import { criarApiFixturas, definicaoV5 } from '@/components/fluxo/fixturas';
import { ProvedorFixturas, type CtxFluxo } from '@/components/fluxo/contexto';
import { MapeamentoCarga } from '@/components/comuns/mapeamento-carga';
import { exemplo, reconhecer, validar } from '@/lib/mapeamento-carga';

const nada = () => {};
const REC: ConfigIdentidade = recomendada(true);

test('identidade: padrões aprovados (com CRM, CRM e depois o arquivo; sem CRM, o arquivo; carteira no ar, como hoje)', () => {
	assert.deepEqual(recomendada(true), { fonte: 'crm_arquivo', perguntas: ['dia_mes_nascimento', 'ultimos3_documento'], quantas: 2, se_faltar: 'proxima', erros_dia: 4 });
	assert.equal(recomendada(false).fonte, 'arquivo');
	assert.deepEqual(inicial(true, true), comoHoje());
	assert.equal(inicial(false, true).fonte, 'arquivo');
	assert.equal(inicial(true, false).fonte, 'crm_arquivo');
});

test('identidade: a mesma validação do banco (identidade_mailing_valida)', () => {
	assert.equal(validarIdentidade(REC), '');
	assert.match(validarIdentidade({ ...REC, perguntas: ['dia_mes_nascimento'] }), /2 perguntas/);
	assert.match(validarIdentidade({ ...REC, erros_dia: 5 as 4 }), /3, 4 ou 6/);
	assert.match(validarIdentidade({ ...REC, perguntas: ['dia_mes_nascimento', 'dia_mes_nascimento'] }), /inválidas/);
	assert.deepEqual(Object.keys(paraSalvarIdentidade({ ...REC, extra: 1 } as ConfigIdentidade)).sort(), ['erros_dia', 'fonte', 'perguntas', 'quantas', 'se_faltar']);
});

test('identidade: ordem, ligar/desligar e quantas', () => {
	assert.deepEqual(mover(REC, 'ultimos3_documento', -1).perguntas, ['ultimos3_documento', 'dia_mes_nascimento']);
	assert.deepEqual(mover(REC, 'dia_mes_nascimento', -1).perguntas, REC.perguntas);           // o 1º não sobe
	assert.deepEqual(alternar(REC, 'ano_nascimento').perguntas, [...REC.perguntas, 'ano_nascimento']);
	assert.deepEqual(alternar(REC, 'dia_mes_nascimento'), REC);                                // nunca menos que "quantas"
	const uma = { ...comoHoje() };
	assert.deepEqual(comQuantas(uma, 2).perguntas, ['dia_mes_nascimento', 'ultimos3_documento']);
	assert.equal(textoPerguntas(REC), 'dia e mês de nascimento + 3 últimos dígitos do CPF/CNPJ');
	assert.equal(textoFonte(null), 'Só o CRM (como hoje)');
	assert.ok(usaArquivo(REC) && !usaArquivo(comoHoje()) && !usaArquivo(null));
});

test('identidade: o formulário mostra as 4 fontes, a recomendada, a reserva, as recusadas e a contagem no servidor', () => {
	const html = renderToStaticMarkup(<FormIdentidade valor={{ ...REC, perguntas: [...REC.perguntas, 'ano_nascimento'] }} onTrocar={nada} temCrm />);
	for (const t of ['Só o CRM', 'Só o arquivo', 'CRM; se falhar, o arquivo', 'Arquivo; se faltar o dado, o CRM', 'Usar a próxima fonte',
		'Fazer só a pergunta que tem dado', 'Transferir para um atendente', 'Nome da mãe', 'CPF inteiro', '2 (fixo)', 'Banco do MotorCX (servidor)']) {
		assert.ok(html.includes(t), t);
	}
	assert.equal((html.match(/recomendado<\/span>/g) ?? []).length, 3);           // fonte, 2 perguntas, próxima fonte
	assert.ok(html.includes('reserva'), 'o ano ligado em 3º é a reserva');
	assert.ok(/name="fonte"[^>]*checked/.test(html.replace(/value="[^"]*"/g, '')));
	const leitura = renderToStaticMarkup(<FormIdentidade valor={REC} onTrocar={nada} temCrm somenteLeitura />);
	assert.ok(!leitura.includes('aria-label="Subir'), 'quem não aprova não reordena');
	assert.ok(/<input[^>]*type="radio"[^>]*disabled/.test(leitura));
	const semCrm = renderToStaticMarkup(<FormIdentidade valor={REC} onTrocar={nada} temCrm={false} />);
	assert.ok(semCrm.includes('não tem o conector Validar cadastro ativo'));
});

test('identidade: a tela abre pela fixtura com o cabeçalho do Agente de voz', async () => {
	const ctx = (permissoes: string[]): CtxFluxo => ({
		empresa: { id: 1, slug: 'aurora', nome: 'Aurora' }, credor: { id: 11, nome: 'Cartão Aurora' }, credores: [{ id: 11, nome: 'Cartão Aurora' }],
		permissoes, equipe: false, equipeMonta: false, api: criarApiFixturas(), demo: true, rota: t => `/dev/fluxo/${t}`,
	});
	const html = renderToStaticMarkup(<MemoryRouter><ProvedorFixturas valor={ctx(['editar_canais'])}><IdentidadeAgente /></ProvedorFixturas></MemoryRouter>);
	assert.ok(html.includes('Confirmar identidade'));
});

test('roteiro e mapa: "Confirmar identidade" diz quem confere e a 2ª pergunta; sem configuração, como hoje', () => {
	const d = definicaoV5();
	const id = d.blocos.find(b => b.tipo === 'identidade')!;
	const com = renderToStaticMarkup(<QuemConfere b={id} identidade={REC} onMudar={nada} />);
	assert.ok(com.includes('CRM; se falhar, o arquivo') && com.includes('três últimos números') && com.includes('a resposta vira código') && com.includes('Mudar'), com);
	const hoje = renderToStaticMarkup(<QuemConfere b={id} identidade={null} />);
	assert.ok(hoje.includes('Só o CRM (como hoje)') && !hoje.includes('vira código'));
	const rot = renderToStaticMarkup(<Roteiro definicao={d} marcas={new Map()} onAbrir={nada} identidade={REC} />);
	assert.equal((rot.match(/data-quem-confere="crm_arquivo"/g) ?? []).length, d.blocos.filter(b => b.tipo === 'identidade').length);
	const semCfg = renderToStaticMarkup(<Roteiro definicao={d} marcas={new Map()} onAbrir={nada} />);
	assert.ok(!semCfg.includes('data-quem-confere'), 'banco sem o SQL 88: o Roteiro fica como antes');
	const mapa = renderToStaticMarkup(<Quadro definicao={d} marcas={new Map()} onAbrir={nada} identidade={{ ...REC, fonte: 'arquivo' }} />);
	assert.ok(mapa.includes('Quem confere:') && mapa.includes('Só o arquivo') && mapa.includes('só como código'));
});

test('carga: "Para o agente de voz" reconhece a data, aceita o CPF já apontado e nunca mostra o valor', () => {
	const cab = ['COD_CLIENTE', 'CPF_CNPJ', 'SALDO', 'DIAS_ATRASO', 'CEL1', 'DT_NASC', 'ULT3'];
	const r = reconhecer(cab);
	assert.equal(r.nascimento, 'DT_NASC');
	assert.equal(validar({ ...r, documento_validacao: 'CPF_CNPJ' }, cab), '');           // usar o CPF/CNPJ já apontado
	assert.match(validar({ ...r, nascimento: 'SALDO' }, cab), /mais de um campo/);
	assert.equal(exemplo('nascimento', '15/03/1980'), '••/••/••••');
	assert.equal(exemplo('documento_validacao', '725'), '•••');
	const html = renderToStaticMarkup(<MapeamentoCarga cabecalho={cab} colunas={{ ...r, documento_validacao: 'CPF_CNPJ' }} reconhecido={r} onTrocar={nada}
		linhas={[['C1', '529.982.247-25', '100', '30', '11987654321', '15/03/1980', '725']]} />);
	assert.ok(html.includes('Para o agente de voz') && html.includes('Usar CPF_CNPJ (já apontado)') && html.includes('vira código'));
	assert.ok(!html.includes('15/03/1980') && !html.includes('529.982') && !html.includes('>725<'), 'nenhum valor de validação na tela');
});

test('carga: o relatório do agente de voz é só contagem', () => {
	assert.equal(resumoCarga({ colunas: { nascimento: true, documento_validacao: false }, chave: true, clientes_com_codigo: 47902, nascimento_invalidas: 308 }),
		'Agente de voz: 47.902 com dado para conferir pelo arquivo · 308 sem data válida');
	assert.match(resumoCarga({ colunas: { nascimento: true }, chave: false, clientes_com_codigo: 0 }) ?? '', /ainda não existe/);
	assert.equal(resumoCarga({ colunas: { nascimento: false, documento_validacao: false } }), null);
	assert.equal(resumoCarga(undefined), null);
});
