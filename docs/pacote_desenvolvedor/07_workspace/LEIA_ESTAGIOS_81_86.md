# Estágios de cobrança: ordem de aplicação (28/10/2026)

Protótipo: `ux/criacao-simples-prototipo.html`. Cada prompt tem menos de 100 linhas; aplique e publique um
por vez, nesta ordem.

1. `PROMPT_81_ESTRATEGIA_3_SUBABAS.md` — Estratégia com 3 subabas; Carteiras e Canais em Configurações; Mapa e
   Comitê em Resultados; redirecionamentos de /estrategias, /estrategias/:id e /clusters. Só tela.
2. `PROMPT_82_CARTEIRA_SEM_PADRAO.md` — definição vazia (nunca {}), "Limpar todas as fases" corrigido, 3
   caminhos sem recomendação e modelos opcionais com "O que vem dentro". Só tela.
3. `PROMPT_83_ORQUESTRACAO_EM_PASSOS.md` — moldura dos 5 passos, passo Carteira e passo Segmentos ("usado em N
   carteiras"). Só tela.
4. `PROMPT_84_ESTAGIOS.md` — passo Estágios: fases como estágios (rotulos_fases), etapas com condições,
   prazo e saídas, ordem por arrastar, fatos, prévia e aviso de clientes sem estágio. Só tela.
5. `PROMPT_85_REGUA_E_REVISAR.md` — régua por estágio e Revisar e salvar com "Guardar como modelo". Só tela.
6. `PROMPT_86_AVISO_SEM_ESTAGIO.md` — "Sem estágio" na Lista do dia (só tela) e item no Início (precisa do
   SQL abaixo).

## O que precisa de SQL
Item "sem estágio" no Início: o rpc para_hoje não traz isso hoje. SQL mínimo (texto; quem escreve é o CX):
acrescentar ao union do para_hoje um bloco que, para a empresa e só se pode('editar_orquestracao'), conte
em estado_cliente os clientes com coalesce(na_carga, true) e motivo_hoje começando por "sem ação: sem estágio"
(texto novo do motor) ou pelos antigos "sem ação: a fase do cliente" / "sem ação: acordo quebrado, mas a quebra", agrupados por credor_id e
cluster_atual; junte credores (nome) e clusters (empresa_id + codigo = cluster_atual → id, nome); devolva
tipo 'sem_estagio', urgência 18, título "<n> clientes sem estágio em <carteira> · <segmento> — ficam sem
ação", detalhe "Ficam sem ação até entrarem em algum estágio.", ação 'Resolver', link
'/orquestracao?carteira=<credor_id>&segmento=<cluster id>&passo=estagios'; no máximo 2 itens, maior n
primeiro. Opcional e mais robusto: a rotina gravar um código (ex.: motivo_categoria ou coluna própria
'sem_estagio') em vez de casar texto.

## O que precisa de motor
- Preventivo: o motor passa a respeitar preventivo.ativo (correção em andamento no motor); o prompt 84 trata
  a chave de "Acordo em dia" como as outras. Publique o 84 depois dessa correção.
- Segmento sem estratégia própria segue o playbook padrão do motor (estrategia_id nulo). A tela avisa
  (prompt 82), mas "carteira nova vazia de verdade" depende de o cliente escolher um caminho ou de o motor
  passar a tratar "sem estratégia" como vazia (decisão do dono).
- Propensão a pagamento e "Abordagem da persona" como campos de condição: não existem no motor; a tela só
  os mostra como "Coletando · em breve".
- definicao.rotulos_fases: conferido em motor/estrategia.py (validar_estrategia lê só chaves conhecidas):
  a chave nova é ignorada pelo motor, sem aviso nem erro. Pode gravar hoje.
