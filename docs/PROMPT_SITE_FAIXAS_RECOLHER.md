# Prompt de ajuste do site: recolher e expandir todas as faixas da esteira

Só layout. Não precisa de SQL nem de mudança no motor.

---

```text
No Desenho da Esteira (Orquestração da carteira), TODAS as faixas devem recolher e expandir
igual ao bloco "Clientes em acordo (preventivo e quebra)" e ao "Prioridade dos telefones". Só
layout: NÃO mude a lógica, as gravações em estrategias.definicao, tabelas, views ou políticas.

## 1. Faixas que passam a recolher
- "Cliente novo · ainda não deu CPC"
- "Deu CPC · CPC A e CPC B"
- "Não CPC · ciclo que se repete"
(continuam como estão: "Clientes em acordo (preventivo e quebra)" e "Prioridade dos telefones")

## 2. Como fica cada faixa (o mesmo padrão dos blocos que já recolhem)
- Container: rounded-xl border border-[#dfe8ea] bg-white.
- Cabeçalho = um <button type="button"> de largura total (flex w-full items-center
  justify-between px-5 py-4 text-left) com:
  à esquerda o título (text-sm font-bold text-[#163943]) e, abaixo dele, um RESUMO de uma linha
  (text-[11px] text-slate-500 truncate) que aparece SEMPRE, aberto ou fechado:
  · Cliente novo: os dias com canal, ex. "D+1 WhatsApp › SMS · D+3 RCS · D+5 Agente virtual ·
    vira Não CPC no D+8" e, se houver raias, "· 3 personas com raia";
  · Deu CPC: "Ordem: WhatsApp › SMS › Discador · 3 tentativas por canal";
  · Não CPC: "Ciclo de 8 dias × 3 ciclos · G-dia1 SMS · G-dia4 Discador";
  · Clientes em acordo: "Preventivo D-3, D-1, D0 · Quebra D+1, D+3";
  · Prioridade dos telefones: "Ranking menor primeiro, depois score maior" ou "Sem regra".
  à direita a seta (chevron) que gira 180° quando aberta (transition-transform).
- Conteúdo (só quando aberta): border-t border-[#ecf0f1] p-5, com o texto explicativo que hoje
  fica abaixo do título e tudo o que a faixa já tem (grade de dias, raias, campos numéricos).
- aria-expanded no botão; Enter/Espaço alternam.

## 3. Estado inicial e memória
- Na 1ª vez: "Cliente novo" ABERTA; as outras FECHADAS.
- Guardar no navegador (localStorage, chave "motorcob.esteira.faixas") quais estão abertas, e
  reabrir assim na próxima visita.
- Se a faixa tiver um aviso (âmbar/vermelho: canal repetido, persona removida, faixa vazia),
  mostrar um ponto âmbar ao lado do título mesmo fechada, e abri-la automaticamente ao carregar.

## 4. Atalhos
Acima da primeira faixa, à direita: links "Expandir tudo" e "Recolher tudo".

## 5. Arrastar com faixa fechada
Enquanto o usuário arrasta um canal ou uma persona, passar o mouse 600 ms sobre o cabeçalho
de uma faixa fechada a abre (para poder soltar nos dias dela).
```
