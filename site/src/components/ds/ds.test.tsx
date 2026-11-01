// Testes do design system (npm test). Renderiza no servidor e confere as regras: 6 colunas, 4 KPIs, abas que viram
// select no celular, gaveta com cabeçalho/corpo/rodapé, estados e selo de regras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { Abas, Aviso, BarraFiltros, Detalhes, Estado, Gaveta, Kpis, ListaRegras, PainelGaveta, SeloRegras, Tabela, type Coluna } from './index';

const html = (n: ReactNode) => renderToStaticMarkup(<MemoryRouter>{n}</MemoryRouter>);
const conta = (s: string, re: RegExp) => (s.match(re) ?? []).length;

type L = { id: number; a: string; b: number };
const colunas = (n: number): Coluna<L>[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, titulo: `Col ${i}`, num: i === n - 1, celula: (l: L) => (i === 0 ? l.a : String(l.b + i)) }));
const linhas: L[] = [{ id: 1, a: 'CLI-1', b: 10 }, { id: 2, a: 'CLI-2', b: 20 }];

test('Tabela mostra no máximo 6 colunas, mesmo recebendo mais', () => {
	const s = html(<Tabela colunas={colunas(8)} linhas={linhas} chave={l => l.id} />);
	assert.equal(conta(s, /<th scope="col"/g), 6);
	assert.ok(!s.includes('Col 6'));
});

test('Tabela com gaveta: linha focável, seta e lista de botões no celular', () => {
	const s = html(<Tabela colunas={colunas(3)} linhas={linhas} chave={l => l.id} onAbrir={() => {}} rotulo="Lotes" celular={l => ({ titulo: l.a, valor: `${l.b}%`, resumo: 'resumo' })} />);
	assert.equal(conta(s, /<tr tabindex="0"/g), 2);
	assert.match(s, /<span class="sr-only">Abrir<\/span>/);
	assert.match(s, /<ul class="flex flex-col md:hidden" aria-label="Lotes">/);
	assert.equal(conta(s, /<li[^>]*><button type="button"/g), 2);
	assert.match(s, /10%/);
});

test('Tabela vazia mostra o Estado vazio', () => {
	const s = html(<Tabela colunas={colunas(2)} linhas={[]} chave={l => l.id} vazio="Nenhum lote ainda." />);
	assert.match(s, /data-estado="vazio"/);
	assert.match(s, /Nenhum lote ainda\./);
});

test('Kpis corta em 4 e ignora itens vazios', () => {
	const s = html(<Kpis itens={[1, 2, 3, 4, 5].map(i => ({ rotulo: `K${i}`, valor: i })).concat([null as never])} />);
	assert.match(s, /data-ds-kpis="4"/);
	assert.ok(!s.includes('K5'));
});

test('Kpi em alerta ganha o tom', () => {
	assert.match(html(<Kpis itens={[{ rotulo: 'Alertas', valor: 3, tom: 'alerta' }]} />), /data-tom="alerta"/);
});

test('Abas: tablist no desktop, select no celular com o link do fim e a contagem', () => {
	const s = html(<Abas rotulo="Seções" atual="b" itens={[{ id: 'a', nome: 'Visão', to: '/x' }, { id: 'b', nome: 'Alertas', cont: 38 }]} fim={{ id: 'busca', nome: 'Buscar nas conversas', to: '/x/busca' }} />);
	assert.match(s, /role="tablist" aria-label="Seções"/);
	assert.match(s, /aria-selected="true"[^>]*>Alertas/);
	assert.match(s, /<select aria-label="Seções"/);
	assert.match(s, /<option value="b" selected="">Alertas \(38\)<\/option>/);
	assert.match(s, /<option value="busca">Buscar nas conversas<\/option>/);
	assert.match(s, /href="\/x\/busca"/);
});

test('Estado: sem permissão, erro e esqueleto de carregamento', () => {
	assert.match(html(<Estado tipo="semPermissao" titulo="Seu perfil não vê esta tela." />), /data-estado="semPermissao"/);
	assert.match(html(<Estado tipo="erro" titulo="Falhou" />), /role="alert"/);
	assert.match(html(<Estado tipo="carregando" />), /aria-label="Carregando"/);
});

test('Aviso com ação', () => {
	const s = html(<Aviso tom="erro" titulo="4 preços" acao={<a href="#l">Ver lista</a>}>abaixo do mínimo</Aviso>);
	assert.match(s, /role="status"/);
	assert.match(s, /<b class="font-semibold">4 preços <\/b>/);
	assert.match(s, /Ver lista/);
});

test('Gaveta: fechada não renderiza; painel tem cabeçalho, corpo, rodapé e Fechar', () => {
	assert.equal(html(<Gaveta aberta={false} onFechar={() => {}} titulo="X">corpo</Gaveta>), '');
	const s = html(<PainelGaveta titulo="Lote 12" subtitulo="Simulado" rodape={<button type="button">Pausar</button>} onFechar={() => {}}>corpo da gaveta</PainelGaveta>);
	assert.match(s, /role="dialog" aria-modal="true" aria-label="Lote 12"/);
	assert.match(s, /<header[^]*Lote 12[^]*Simulado[^]*aria-label="Fechar"/);
	assert.match(s, /corpo da gaveta/);
	assert.match(s, /<footer[^]*Pausar/);
});

test('Detalhes: recolhido por padrão, com contagem', () => {
	const fechado = html(<Detalhes resumo="Mais resultados" qtd="5">x</Detalhes>);
	assert.ok(!/<details[^>]* open/.test(fechado));
	assert.match(fechado, /Mais resultados/);
	assert.match(html(<Detalhes resumo="R" aberto>x</Detalhes>), /<details open=""/);
});

test('SeloRegras: o chip mostra só o rótulo; as regras ficam na gaveta', () => {
	const s = html(<SeloRegras rotulo="Regras que não mudam (6)" regras={[{ titulo: 'Nunca pede CPF' }]} />);
	assert.match(s, /aria-haspopup="dialog"/);
	assert.match(s, /Regras que não mudam \(6\)/);
	assert.ok(!s.includes('Nunca pede CPF'));
	assert.match(html(<ListaRegras regras={[{ titulo: 'Nunca pede CPF', texto: 'nem cartão' }]} />), /Nunca pede CPF[^]*nem cartão/);
});

test('BarraFiltros: botão Filtros no celular e "Mais filtros" com a contagem', () => {
	const s = html(<BarraFiltros mais={<select aria-label="Origem" />} maisAtivos={1} direita={<span>selo</span>}><select aria-label="Período" /></BarraFiltros>);
	assert.match(s, /aria-expanded="false"[^>]*>.*Filtros \(1\)/);
	assert.match(s, /Mais filtros \(1\)/);
	assert.ok(!s.includes('aria-label="Origem"'));
	assert.match(s, /selo/);
});
