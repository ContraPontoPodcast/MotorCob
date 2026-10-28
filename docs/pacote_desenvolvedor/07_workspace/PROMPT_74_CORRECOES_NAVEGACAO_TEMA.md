# Prompt Horizons — 74: o que o prompt 73 não aplicou + cores do tema escuro + equipe vendo o que o cliente vê

25/10/2026. Teste do dono depois do prompt 73 e conferência no código publicado: o menu da área não troca para a
Mensageria (só existe "Trocar para" entre Cobrança e Jornada), a equipe com a pílula de uma empresa vê áreas que o
cliente não contratou, o canal padrão continua SMS, o link do lote continua dando 404 e, no tema escuro, cartões ficam
brancos com o texto claro (Personas, Segmentos, Carteiras, Orquestração, Envios, Lista do dia). Rode depois do 73.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude o conteúdo das telas além do que está abaixo.

## 1. Troca de área no menu lateral (o 73 pediu e não entrou)
No topo do menu lateral, abaixo de "‹ Início" e da pílula da empresa, troque o botão "Trocar para …" (função que só
alterna Cobrança/Jornada) por uma linha de botões, um por área, na ordem: Cobrança · Jornada do Cliente · Mensageria
· Relatórios. Mostre só as áreas liberadas (item 2) + Relatórios. A área da rota atual fica marcada. Destinos:
Cobrança /fila · Jornada /jornada · Mensageria /mensageria · Relatórios /relatorios. Clicar é só navegar (não grava
preferência; a frente da sessão segue a rota com aplicarFrente, como o 73 já faz). Menu recolhido: os mesmos botões
como ícones com o nome no title. Na gaveta do celular, a mesma linha no topo do menu da área.

## 2. Áreas liberadas: uma regra só, igual para cliente e para a equipe com a pílula
liberadas(empresa) = Cobrança se a empresa tem a frente motorcob; Jornada se tem motorcli; Mensageria se
empresa_modulos.modulo = 'mensageria' com ativo = true. Use rpc numeros_areas({ empresa }) (campo contratada) e, se
falhar, essa regra direto nas tabelas.
- Cliente: sempre a empresa dele.
- Equipe COM empresa na pílula: as áreas liberadas DAQUELA empresa (a equipe vê o que o cliente vê). As outras
  aparecem esmaecidas no Áreas ▾ com "Não contratada"; clicar abre a página do item 3 com o botão extra "Abrir mesmo
  assim (equipe)".
- Equipe SEM empresa na pílula: todas as áreas.
Use essa regra no Áreas ▾ (hoje a equipe vê tudo: P/F/I = equipe || …), no Início (Suas áreas), na linha do item 1
e na gaveta. Troca de empresa na pílula recalcula na hora.

## 3. Área não contratada (página dentro da moldura, sem menu lateral)
Rota de uma área fora das liberadas (cliente, ou equipe com pílula): "{Área} não faz parte do plano da {empresa}." ·
"Quero conhecer" (o card de interesse que já existe) · "Ir para o Início". Equipe sem pílula nunca vê esta página.

## 4. Console para a equipe
Equipe (perfil.equipe): na barra do topo, à esquerda do "?", um botão "Console" que abre /console (além do item que já
existe no menu do avatar). Na gaveta do celular, "Console MotorCX" logo abaixo de Início. /console/* nunca mostra as
páginas dos itens 3 ou "sem permissão" para a equipe.

## 5. Mensageria: canal e lote
- Canal padrão: troque todo fallback `sms` (menu, seletor, Assistente, link das áreas) pelo último canal usado se
  ainda estiver em empresa_modulos.canais (linha mensageria, ativo = true), senão o 1º desses canais. Nunca 'sms' fixo.
- /mensageria/{c} com canal fora dos contratados: "O canal {nome} não está contratado." + botão para o 1º contratado.
- Lista de lotes: o link de cada lote é /mensageria/{canal do lote}/lotes/{id} (hoje /mensageria/lotes/{id}, 404).

## 6. Tema escuro: fundos, bordas e textos que ficaram de fora
No mesmo bloco de CSS do tema escuro que hoje troca bg-white, bg-[#eaf2f3] e text-[#163943] dentro de .mc-platform,
acrescente (só no escuro; o claro não muda):
- Fundo de cartão → background-color: var(--base-cartao): bg-[#fafcfc] bg-[#f5f7f8] bg-[#f2f6f7] bg-[#f0f6f7]
  bg-[#f1f5f6] bg-[#f5f5f7] bg-[#f2f2f7] bg-slate-50
- Fundo de preenchimento → var(--base-fill): bg-[#eef2f3] bg-[#eef3f4] bg-[#e9f1f3] bg-[#e8f1f3] bg-[#e3e9eb]
  bg-[#edf2f3] bg-slate-100
- Fundo de aviso (âmbar claro) → color-mix(in srgb, #E9A23B 16%, var(--base-cartao)): bg-[#faf3e8] bg-[#fffbf0]
  bg-[#fde9c4] (o texto âmbar desses avisos fica #F0B860)
- Borda → var(--base-borda): border-[#d9e5e8] border-[#eef2f3] border-[#cbdadd] border-[#cbd5db] border-[#dce8e9]
  border-[#d7e2e5] border-[#dce8ea] border-[#bcd6da] border-[#cdd9db] border-[#cfe0e3] border-[#ECF0F1]
  border-[#cbd9dd] border-[#e2eaec]
- Texto escuro → var(--base-texto): text-[#304b55] text-[#365661] text-[#4a6770]
Regra para o futuro: tela nova usa só as variáveis --base-* (ou as classes já mapeadas), nunca hex claro solto.

Confira no tema ESCURO, em 1440 e 390 px: Personas (nome de cada persona legível), Segmento › "Carteiras que usam
este segmento" (nome da carteira legível), Orquestração, Lista do dia, Envios, Mapa e Comitê; e no claro, que nada
mudou. Navegação: em /orquestracao a linha de áreas leva à Mensageria e a Relatórios; equipe com a pílula numa
empresa sem Jornada não vê Jornada liberada; equipe sem pílula vê tudo; lote abre sem 404; botão Console na barra.
```
