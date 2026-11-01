// Design system das telas do MotorCX (Speech Analytics, Agente de voz, Margem e as próximas).
// Um lugar só para as peças repetidas; todas usam só os tokens do tema (--base-*, --destaque*, --estado-*),
// então valem no claro e no escuro sem cor fixa. Importe sempre de '@/components/ds'.
//
// Regras (as mesmas dos protótipos aprovados):
//  1. Uma ação principal por tela (Botao tipo="primario"); o resto é secundário, fantasma ou vai para a gaveta.
//  2. No máximo 4 KPIs (Kpis) e um Aviso por seção.
//  3. Tabela com no máximo 6 colunas; o detalhe da linha abre numa Gaveta (onAbrir). No celular, lista.
//  4. Regras fixas e LGPD saem do corpo da tela: SeloRegras (chip com cadeado que abre a lista).
//  5. O que é secundário fica recolhido (Detalhes) ou em "Mais filtros" (BarraFiltros).
//  6. Abas viram um select no celular (Abas); nada rola de lado a 390 px.
//  7. Todo carregamento, vazio, erro e falta de permissão usa Estado.
//
// API
//  Gaveta({ aberta, onFechar, titulo, subtitulo?, rodape?, largura?, children })
//      Painel lateral. Esc e clique fora fecham; foco preso dentro; volta o foco ao fechar.
//  Modal({ titulo, texto?, confirmar, onConfirmar, onFechar, ocupado?, desabilitado?, perigo?, children? })
//      Confirmação. Monte só quando aberto: {pedindo && <Modal …/>}.
//  SeloRegras({ rotulo, titulo?, subtitulo?, regras: {titulo, texto?}[], children? })
//      Chip com cadeado; abre a gaveta com a lista. ListaRegras({ regras }) mostra a mesma lista solta.
//  Detalhes({ resumo, qtd?, aberto?, solto?, children })
//      Recolhível nativo (<details>). `solto` = cartão próprio.
//  Tabela({ colunas: {id, titulo, num?, celula}[], linhas, chave, onAbrir?, celular?, selecionada?, rodape?, vazio?, rotulo? })
//      Até 6 colunas (as demais não aparecem e há aviso em desenvolvimento). `celular(l)` → {titulo, valor?, resumo?}.
//  Estado({ tipo: 'vazio'|'carregando'|'erro'|'semPermissao', titulo?, children?, acoes?, compacto? }) · Esqueleto()
//  BarraFiltros({ children, mais?, maisAtivos?, nota?, direita?, onLimparMais? })
//      Filtros principais em linha; `mais` vai para a gaveta "Mais filtros". No celular, botão "Filtros".
//  Abas({ itens: {id, nome, to?, cont?, icone?}[], atual, onTrocar?, rotulo, fim? })
//      Barra de abas; select no celular. `fim` = link no fim da barra (ex.: busca).
//  Kpis({ itens: {rotulo, valor, detalhe?, tom?: 'alerta'|'atencao'|'ok'}[] }) · Kpi(item)
//  Aviso({ tom?, titulo?, children, acao? })
//  Passos({ passos: string[], atual }): etapas numa linha (feito ✓, agora em destaque).
//  Peças básicas: Botao({ tipo: 'primario'|'secundario'|'fantasma'|'perigo', pequeno?, … }), BotaoLink, LinkTexto,
//  Pilula({ tom }), Cartao({ titulo, linha, direita, semPadding }), Segmentos, Rotulo, ListaValores, campoCls/campoStyle,
//  textareaCls. Tons: 'ok' | 'info' | 'atencao' | 'erro' | 'neutro' | 'destaque'.
export { Pilula, Botao, BotaoLink, LinkTexto, Cartao, Segmentos, Rotulo, ListaValores, clsBotao, campoCls, campoStyle, textareaCls, type TipoBotao } from './base';
export { Aviso, Estado, Esqueleto, type TipoEstado } from './aviso';
export { Gaveta, PainelGaveta, Modal, type GavetaProps, type ModalProps } from './gaveta';
export { SeloRegras, ListaRegras, type Regra } from './selo-regras';
export { Detalhes } from './detalhes';
export { Tabela, MAX_COLUNAS, type Coluna, type LinhaCelular, type TabelaProps } from './tabela';
export { Kpis, Kpi, MAX_KPIS, type ItemKpi } from './kpis';
export { Abas, type ItemAba } from './abas';
export { BarraFiltros } from './barra-filtros';
export { Passos } from './passos';
export { TOM, SOMBRA, type Tom } from './tom';
