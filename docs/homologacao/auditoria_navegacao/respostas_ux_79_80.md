# CX → UX: conferência dos PROMPT_79 e PROMPT_80 (bundle site6, motor no repositório)

1. Lista de ações com comModo: confirmado com ressalvas.
   - A lista (`X`) e a linha (`Te`) do estrategia-editor-core não são exportadas; é preciso exportar no código-fonte.
   - A linha trava o conector em 'sempre' e desliga o ↑ quando recebe índice 0 (`c = t === 0`). Se ela receber a lista cortada (só as ações 1 em diante), a 2ª ação vira 'sempre' presa.
   - O conector do componente oferece Sempre, Senão, Junto e Reserva.
   - A raia alterna só senão → junto → reserva (`ko`) e, ao soltar um canal depois do 1º, troca 'sempre' por 'senao'. O rótulo da célula (`Ao`) não tem 'sempre' e fica vazio se ele existir.
   - O motor (`motor/estrategia.py`, `resolver`) aceita 'sempre' em qualquer posição: ali ele abre uma cadeia nova. Também é aceito no `jornada.py`.
   - Decisão no 80: no quadro, só Senão, Junto e Reserva; um 'sempre' antigo fica preservado e é mostrado como "e sempre".
2. Clique × arrastar: confirmado.
   - O arrastar é o nativo do navegador (`draggable`/`onDragStart`/`onDrop`). Depois de um arrasto o navegador não dispara clique.
   - O botão do conector já faz `stopPropagation`.
   - Basta abrir o quadro só quando o alvo do clique é a própria célula.
3. A frase: confirmado. É gravada em cada AÇÃO (`acao.mensagem`: texto, `{frase_id}` ou um objeto por canal, ou cpa/cpb no CPC), não no dia. `definicao.mensagens` são as frases por estágio, que "Levar para os dias" copia.
4. Saídas do Fluxo: confirmado.
   - D+: `localizacao.dias_sem_contato_para_ncp` (padrão 8).
   - Ciclo: `giro.ciclo_dias` (8) × `giro.max_ciclos` (3).
   - CPC A e CPC B: `cpc.intervalo_cpa` e `cpc.intervalo_cpb` (1).
   - Tentativas: `cpc.tentativas_por_canal` (3).
   - K: `quebra.dias_para_estoque` (6), com a carência `quebra.carencia`.
   - Preventivo e quebra ligados: `preventivo.ativo` e `quebra.ativo`.
5. Linha de resumo da faixa: confirmado que dá para reaproveitar. É calculada como variável dentro do mesmo componente do editor que desenha as raias (as variáveis `Y`, `ht`, `gt` e `bt`). O Fluxo precisa ser desenhado dentro desse componente.
6. Gravação: confirmado. O editor recebe a definição (`e`) e a função de mudança (`t`) do pai, e o pai marca "Alterações não salvas". O Fluxo usando os mesmos `e`/`t` não duplica estado; trocar Raias ↔ Fluxo não perde nada se não desmontar o pai.
7. Canais especiais: confirmado.
   - Enriquecimento entra sempre como 'sempre' e não mostra conector, mesmo como 1º.
   - "Sem ação" é a ação `sem_acao` (raia de persona), filtrada da exibição.
   - ★/☆ (`persona_1`/`persona_2`) ficam na paleta.
8. Operação: confirmado. A célula usa a mesma condição para arrastar e para o botão do conector (`n`); o quadro deve seguir essa condição.
9. `mc-orq-forma`: confirmado que não conflita com nenhuma chave existente (há `motorcob.esteira.faixas` e `motorcob.esteira.frases`).
10. Desempenho: a definição tem dezenas de dias por faixa. Desenhar só a faixa escolhida no Fluxo basta. Nada de consulta nova.
11. 79: confirmado que todos os meus ajustes continuam. A UX acrescentou o parágrafo de cores; as cores batem com o código. "Nada cinza" contradiz o Discador (#475569) e o Bureau (#64748b), que já são cinza-azulados; troquei por "nenhum canal perde a cor própria".
