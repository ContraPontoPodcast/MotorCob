# Prompt do site — Personas: como medimos e o quanto cada uma já está construída

Cole no Hostinger Horizons (página **Personas** e chips ★/☆ da **Orquestração**).
Antes, rode no Supabase: `alter table public.personas add column if not exists maturidade jsonb not null default '{}';`

---

Na página **Personas** (dados da tabela `personas`, filtrada pelo credor selecionado), quero deixar o
conceito aberto para o cliente entender como o MotorCob mede e escolhe o canal, e mostrar que cada
persona está **em construção**: o que já está sendo visto, mas ainda não decidido.

## 1. Bloco "Como o MotorCob mede" (topo da página, recolhível, aberto na 1ª visita)

Título: **Como o MotorCob escolhe o melhor canal de cada persona**. Texto em 4 passos curtos, com ícones:

1. **Cada acionamento vira uma tentativa.** Cliente × canal × dia. Se a ocorrência voltou como CPC
   (pelo mapeamento de ocorrências do credor), a tentativa deu certo.
2. **O motor descobre o que separa os clientes.** Ele testa as colunas da carga (UF, faixa de saldo,
   faixa de atraso, DDD, tem WhatsApp…) e fica com as que mais mudam a taxa de CPC por canal. Cada
   combinação vira uma persona. Mostre as colunas escolhidas (`caracteristicas`) como chips.
3. **Pouco volume não decide sozinho.** Enquanto a persona tem poucas tentativas num canal, a taxa
   dela é puxada para a média da carteira. Quanto mais tentativas, mais pesa o dado da própria persona.
4. **O ranking é CPC por real gasto.** Taxa de CPC ÷ custo do canal (página Canais). O 1º é o
   **★ Melhor canal da persona**, o 2º é o **☆ 2º melhor**. Só entram canais que o cliente tem.
   Todo dia ~10% dos clientes começam pelo 2º canal, para o motor continuar testando.

Rodapé do bloco: "A persona é refeita todo dia com as ocorrências até ontem."

## 2. Medidor de maturidade em cada card de persona

Cada linha tem `maturidade` (jsonb):
`{fase: 'coletando'|'previa'|'definida', indice: 0–100, indice_anterior: número|null, volume_pct: 0–100,
confianca: 0–1|null, meta_tentativas: 200, persona_formada: bool, proximo_passo: texto}`.

No topo de cada card, um **velocímetro semicircular** (SVG, sem biblioteca nova) com o `indice`:
- 0–39 cinza-azulado, rótulo **Coletando dados**: "O motor está juntando tentativas. O ★/☆ ainda segue
  quase só a média da carteira."
- 40–99 âmbar, rótulo **Prévia**: "Já há sinal, mas ainda não é decisão firme."
- fase `definida` (100) verde `#0F4C5C`, rótulo **Definida**: "Volume suficiente e o 1º canal à frente com folga."
  Use a `fase` para o rótulo e a cor (não só o número).
- Embaixo do ponteiro: o número grande (ex.: **62**/100) e a tendência: se `indice_anterior` existir,
  seta ▲ verde "+8 desde ontem", ▼ vermelha, ou "estável". Se for null: "primeira medição".
- Duas mini barras abaixo do velocímetro:
  - **Volume**: `volume_pct`% — legenda "tentativas no 1º e 2º canal (meta: {meta_tentativas} em cada)".
  - **Separação entre ★ e ☆**: `confianca` em % — legenda "chance de o ★ ser mesmo melhor que o ☆".
    Null → "—".
- Uma linha em itálico com `proximo_passo` (ex.: "faltam 120 tentativas em sms para confirmar").
- Se `persona_formada` = false (persona "Carteira toda"): faixa informativa "Ainda não há volume para
  separar a carteira em personas. Por enquanto ★/☆ usam o ranking da carteira toda."
- Se `maturidade` vier vazio ({}): esconda o velocímetro e mostre "Maturidade disponível após a
  próxima rotina."

## 3. Ranking de canais: o que é visto × o que pesa

No ranking que já existe (barras por canal), em cada canal acrescente:
- Selo de **evidência** (`evidencia`): `pouca` (cinza, "< 30 tentativas"), `previa` (âmbar,
  "em formação"), `firme` (verde, "evidência firme").
- Uma barrinha fina dupla **"quem decide hoje"**: `peso_proprio` × 100 % em cor sólida = "dados da
  persona"; o resto em tracejado = "média da carteira". Tooltip: "Hoje {x}% desta taxa vem dos
  clientes desta persona e {100−x}% da média da carteira."
- Mantenha taxa de CPC, tentativas, CPCs e custo por CPC.
- Marque o 1º com ★ "Melhor canal" e o 2º com ☆ "2º melhor".

## 4. Orquestração: chips ★/☆

Nos chips **★ Melhor canal da persona** e **☆ 2º melhor da persona** (paleta e passos da estratégia),
ao passar o mouse/tocar, mostre um popover com as personas do credor (até 5, por nº de clientes):
"{nome}: ★ {canal 1} · ☆ {canal 2} — {rótulo da fase}" e o link "Ver Personas".

## 5. Geral
- Português do Brasil; números em formato brasileiro.
- Responsivo: no celular, velocímetro em cima e barras embaixo, sem rolagem horizontal.
- Sem dado pessoal de cliente na página (só personas, contagens e taxas).
- Erros de consulta usam o módulo de detalhe de erro que já existe.
