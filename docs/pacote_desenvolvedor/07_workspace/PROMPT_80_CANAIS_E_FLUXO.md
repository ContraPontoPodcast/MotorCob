# Prompt Horizons — 80: ordem dos canais na célula, quadro "Primeiro canal / Depois" e vista Fluxo

UX, 26/10/2026. Rode depois do 79. Protótipo aprovado: `orquestracao-prototipo.html` v3. Só a tela /orquestracao.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não crie formato de dado novo: as ações de cada dia continuam
como hoje ({canal, modo, contatos, numeros, personas, mensagem}; a 1ª ação com modo 'sempre'). Não mude consultas,
gravações nem regras. Toda mudança passa pelas funções que a tela já usa para gravar os passos do dia e liga
"Alterações não salvas"; só o Salvar grava. Cores dos canais: as do 79 (cada canal com a sua cor).
Casos de hoje que continuam: Enriquecimento (bureau) é sempre modo 'sempre' e não mostra conector; "Sem ação" é a
ação canal 'sem_acao' (raia de persona) e não aparece como canal; ★/☆ da persona são canais (persona_1/persona_2).
A frase é de cada AÇÃO (campo mensagem da ação: texto, {frase_id} ou por canal), não do dia.

## 1. Célula das raias: o 1º canal em destaque
1.1 1ª ação: bolinha colorida do canal + nome, 12 px, peso 700.
1.2 Cada ação seguinte numa linha abaixo, recuada 9 px, com traço de 1,5 px var(--base-borda) à esquerda: primeiro
    o conector numa pílula neutra (fundo var(--base-fill), texto var(--base-texto-2), 10,5 px, peso 600, raio 999),
    com "↳ senão", "+ junto", "↻ reserva" ou "e sempre"; depois a bolinha e o nome do canal (11,5 px, peso 600).
    "e sempre" só aparece em ação antiga gravada assim (hoje a célula mostra o conector vazio nesse caso); a raia
    não cria 'sempre' da 2ª em diante e o clique no conector continua alternando só senão → junto → reserva.
1.3 Continua como hoje: arrastar e soltar canais, clicar no conector para alternar o modo, "solte um canal aqui",
    enriquecimento, sem ação, a frase de cada ação e o menu "Opções da célula". Raias de persona usam a mesma exibição.
Aceite: em toda célula com 2 ou mais canais, o 1º se distingue sem ler a legenda; cada canal mantém a sua cor.

## 2. Quadro de edição da célula
Abre ao clicar na área livre da célula (só quando o alvo do clique é a própria célula; conector, frase e "Opções"
continuam com o clique deles, que já não sobe) e num botão "Editar" no hover/foco. O arrastar é o nativo (draggable)
e continua igual. Quem não pode arrastar (a mesma condição de hoje, ex.: Operação) vê o quadro só em leitura. Popover
em portal no body, z-[70], 340 px, junto da célula; no celular, folha de baixo em tela cheia. Fecha no ×, no Esc e
no clique fora.
2.1 Título "{faixa} · {Público geral ou persona} · {dia}" e uma linha dizendo para quem vale.
2.2 "Primeiro canal": pílulas com os MESMOS canais da paleta de arrastar desta célula (canais da empresa,
    Enriquecimento e, na raia de persona, ★/☆), uma escolha só (role="radiogroup"); grava a ação de índice 0
    (modo 'sempre'). Escolher um canal que já está em "Depois" tira ele de lá. Sem nenhum: "Sem ação neste dia".
2.3 "Depois": as ações de índice 1 em diante, com a linha de ação que já existe no estrategia-editor-core (a da
    lista com comModo: conector, canal, ↑ ↓ ✕, "Quais contatos", números; exporte-a de lá). ATENÇÃO: passe o índice
    REAL de cada ação na lista do dia (1, 2…), não uma lista cortada: a linha trava em 'sempre' e desliga o ↑ de
    quem recebe índice 0. No conector, só Senão · Junto · Reserva (o que a raia alterna; esconda "Sempre", sem
    apagar o 'sempre' de uma ação antiga). Mantenha os campos que a linha não mostra (personas, mensagem).
    "+ adicionar canal" cria a ação com modo 'senao'. Canal repetido: o aviso de hoje ("Canal repetido: só o 1º vale").
    Cada ação (a 1ª e as de "Depois") tem um botão "Frase" que abre o editor de frase de hoje para AQUELA ação.
2.4 Embaixo, as opções de hoje: Sem ação neste dia · Copiar para
    os outros dias da faixa · Copiar do público geral / Voltar a seguir o geral (na raia de persona).
Aceite: montar a mesma célula pelo quadro e por arrastar dá a mesma definição salva; o 1º canal sempre fica com modo
'sempre'.

## 3. Vista Fluxo (mesmos dados, outra forma)
3.1 Na barra do 79, quando a vista é "Desenho da esteira": controle "Raias | Fluxo" à esquerda das vistas (ativo com
    fundo var(--base-texto) e texto var(--base-cartao)). Guarde a escolha em localStorage mc-orq-forma; padrão Raias.
3.2 O Fluxo é desenhado DENTRO do mesmo componente do editor que desenha as raias, com a mesma definição e a mesma
    função de mudança que ele recebe (nada carregado ou copiado para um estado próprio). Trocar Raias ↔ Fluxo só troca
    o desenho; não desmonta o editor nem a tela. No topo, um botão por faixa: Cliente novo · Deu CPC · Não CPC ·
    Acordo (Preventivo e Quebra), cada um com a linha de resumo que esse componente já calcula (a mesma da Visão
    geral). Desenhe só a faixa escolhida.
3.3 Faixas com dias (Cliente novo, Não CPC, Preventivo, Quebra): caminho vertical. Nó "Entra em {faixa}" → um cartão
    por dia com ação ("Dia N" + o rótulo D+N ou D-N de hoje), ligados por uma linha com seta. Dias seguidos sem ação
    viram um nó tracejado "Dias X–Y sem ação". No cartão, as ações na ordem: a 1ª em destaque, com a frase dela;
    as seguintes como ramos com o conector ("↳ senão · se nada acima foi", "↻ reserva · se o de cima não contatar no
    dia", "e sempre · além do que foi acima"); as "+ junto" ficam lado a lado com a de cima. Não CPC: o nó de
    entrada diz "ciclo de N dias, repetido M vezes" (giro.ciclo_dias e giro.max_ciclos). Faixa desligada: um nó
    "Desligada" com o texto do resumo, sem caminho.
3.4 Raias de persona: ao lado do cartão do dia, um cartão tracejado "Persona {nome} → {ações}", só nos dias em que a
    persona tem raia; abaixo do caminho, "{personas}: nos outros dias, segue o geral".
3.5 Deu CPC (não tem dias): nós só de leitura com a configuração de hoje: ordem dos canais do CPC (cpc.ordem) · CPC A
    a cada N dias (cpc.intervalo_cpa) · CPC B a cada M dias (cpc.intervalo_cpb) · tentativas por canal
    (cpc.tentativas_por_canal) · reforço junto (cpc.junto). Clicar volta às
    Raias com a faixa Deu CPC aberta.
3.6 Fim do caminho: "Saídas deste momento", SÓ LEITURA, com os textos e números que a tela já tem: Cliente novo
    "contato → Deu CPC" e "D+{dia} sem CPC → Não CPC" (localizacao.dias_sem_contato_para_ncp); Deu CPC "sem
    resposta → CPC B" e "esgotou os canais → Não CPC"; Não CPC "contato → Deu CPC" e "ao fim dos ciclos, espera novo
    enriquecimento"; Acordo "quebra sem pagamento → volta ao estoque como CPC A em {K} dias" (quebra.dias_para_estoque;
    com quebra.carencia, "a partir do D+…" como no resumo). Use os mesmos valores padrão da tela quando faltarem.
    Sem botão nem campo de edição.
3.7 Clicar num cartão de dia, numa ação ou num desvio de persona abre o MESMO quadro do item 2.
3.8 < 1024 px: vertical, uma faixa por vez, cartões na largura toda; o desvio de persona fica abaixo do dia.
Rodapé do Fluxo: "As faixas de segurança valem sempre: 08:00–20:00, intervalo mínimo de 12 h, freio do WhatsApp
até 5%." (o mesmo texto das Travas).
Aceite: mudar uma ação no Fluxo aparece igual nas Raias e vice-versa; trocar Raias ↔ Fluxo não perde alterações não
salvas; o Fluxo não grava nada sozinho; as saídas não têm controle de edição.

Confira em 1440 e 390 px, claro e escuro, como Admin e Planejamento (edita) e Operação (leitura: quadro e Fluxo sem
controles de edição, como as raias hoje).
```
