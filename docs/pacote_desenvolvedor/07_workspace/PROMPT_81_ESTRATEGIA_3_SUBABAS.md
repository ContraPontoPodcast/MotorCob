# Prompt Horizons — 81: Estratégia em 3 subabas (Orquestração · Personas · Frases)

UX, 28/10/2026. Rode depois do 80b. Protótipo: `ux/criacao-simples-prototipo.html` (bloco Antes × Depois).
Só muda onde cada tela aparece; nenhuma tela some.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude consultas, gravações, regras nem permissões
das telas. Mude só a configuração das abas da Cobrança (o objeto de áreas e grupos usado pelo componente que
monta as abas, área "cobranca") e acrescente rotas de redirecionamento. Nada de CPF ou nome de devedor.

## 1. Grupos da Cobrança
Hoje: um grupo sem rótulo (Lista do dia, Clientes, Ações, Cargas), "Estratégia" com 8 abas e "Resultados"
(só Painel; a aba Relatórios saiu no 78). Passe a ter, nesta ordem:
- grupo sem rótulo: igual a hoje.
- "Estratégia": Orquestração (/orquestracao) · Personas (/personas, perm ver_clientes como hoje) · Frases
  (nova, ver item 2).
- "Resultados": Painel (/painel, ver_painel) · Mapa da esteira (/mapa) · Comitê (/comite, baixar_comite).
  Não recoloque Relatórios (fica só na lateral, prompt 78).
- "Configurações" (grupo novo): Carteiras (/credores, match "/credores/" como hoje) · Canais (/canais,
  editar_canais como hoje).
Ícones e permissões de cada aba: os de hoje. "Segmentos" (/clusters) e "Estratégias" (/estrategias) saem da
fileira: as funções delas passam para dentro da Orquestração (prompts 82 a 85).

## 2. Aba Frases
"Frases" abre a parte de frases que já existe na tela /canais, sem tela nova e sem duplicar dados:
/canais?secao=frases. Se a tela /canais já separa canais e frases (abas ou seções), abra direto na de
frases; se não separa, role até o bloco de frases (âncora). A aba Frases fica ativa com secao=frases; a aba
Canais (em Configurações) fica ativa em /canais sem esse parâmetro. Mesmas permissões de hoje (editar_canais
nas duas). Na tela /canais as frases ficam na aba "Modelos de mensagem" de cada canal e em "Importar playbook
de frases": secao=frases abre essa parte.

## 3. Redirecionamentos (com loader, igual a /usuarios → /empresa/pessoas)
- /estrategias → /orquestracao
- /estrategias/:id → /orquestracao
- /clusters → /orquestracao?passo=segmentos
Troque também os links internos que apontam para essas rotas (botões, busca, Assistente, Para hoje) pelo
destino novo. As rotas antigas continuam funcionando por causa do redirecionamento.

Aceite: a Cobrança mostra o grupo Estratégia com 3 subabas (Orquestração, Personas, Frases), Resultados com
Painel, Mapa da esteira e Comitê, e Configurações com Carteiras e Canais; abrir /estrategias,
/estrategias/12 ou /clusters leva à Orquestração (o último já no passo Segmentos); nenhuma permissão mudou
(quem não via Comitê continua sem ver). Confira em 1440 e 390 px, claro e escuro.
```
