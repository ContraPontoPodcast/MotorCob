# Passo 5 — Tema preto e âmbar na plataforma (só cores)

**Só cores e fonte.** Não muda layout, textos, lógica, gravações ou banco. Comparação antes/depois das telas reais
em `telas/` (`*_atual.jpg` × `*_preto.jpg`): Início, Orquestração e Lista do dia.

## Sistema de cores
| Papel | Cor | Onde |
|---|---|---|
| Primária (estrutura e ações) | `#0E1112` · menu lateral `#0A0B0C` · hover `#000000` | Menu lateral, botões principais, títulos, links |
| Secundária (ações de apoio) | Branco + contorno `#DEE1E2`, texto `#0E1112` | Exportar, Replicar de…, Cancelar, Começar do playbook |
| Destaque (assinatura) | **Âmbar `#E9A23B`** | Logo (quadrado "M"), barrinha do item de menu ativo, selos Hot/CPC, ponto "diferente do padrão" |
| Aviso | texto `#B4471B`, fundo `#FFF1EB`, borda `#F3C9B8` | Alertas, "Fora da esteira", pontos de atenção nas faixas |
| Erro | `#C62828` (mantém) | Erros |
| Sucesso | `#2E7D32` (mantém) | OK, ligado |
| Canais e personas | **mantêm as cores atuais** | WhatsApp, RCS, SMS, E-mail, Agente virtual, Discador, personas |

Regras do âmbar:
- **Nunca texto âmbar sobre fundo branco** (contraste insuficiente). No branco, âmbar só como preenchimento (com
  texto escuro) ou marcador pequeno. No preto (menu), âmbar pode ser texto.
- Âmbar **não** significa aviso. Tudo o que hoje é aviso em âmbar passa para a cor de Aviso.

Fonte: **Geist** (Google Fonts) no lugar de Inter; números em tabelas com `font-variant-numeric: tabular-nums`.

## Tabela de troca (o site usa classes Tailwind com hex, ex.: `bg-[#0F4C5C]`)
Trocar o hex em todas as classes (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, `hover:`, `focus:` …):

| Hoje | Novo | Uso atual |
|---|---|---|
| `#0F4C5C` | `#0E1112` | cor principal (584 usos) |
| `#103E4B` | `#0A0B0C` | menu lateral |
| `#0D4252` · `#102E38` | `#000000` | hover / sobreposição |
| `#163943` | `#0E1112` | títulos |
| `#19313B` | `#15191B` | texto do corpo |
| `#304B55` | `#3B4043` | texto secundário escuro |
| `#EAF2F3` `#E8F0F2` | `#F1F2F2` | fundos claros azulados |
| `#EDF4F5` | `#F3F4F4` | |
| `#E2EAEC` `#E5EDEF` | `#E8EAEA` | |
| `#D8E3E5` | `#DEE1E2` | bordas |
| `#C9DADD` | `#D2D6D7` | bordas fortes |
| `#DFE8EA` | `#E3E5E6` | bordas de cartão |
| `#DBE5E8` | `#E0E2E3` | |
| `#DEE7E9` | `#E2E4E5` | |
| `#F5F8F9` | `#F6F7F7` | |
| `#F5F7F8` | `#F5F5F5` | fundo da página |
| `#F7FAFB` | `#F8F8F8` | |
| `#FAFCFC` | `#FAFAFA` | |
| `#ECF0F1` | `#EEEFEF` | |
| `#EEF3F4` `#EEF2F3` | `#F0F1F1` | |
| `#E9F1F3` | `#EFF0F0` | |
| `#E9EFF0` | `#EDEEEE` | |
| `#9A631B` | `#B4471B` | texto de aviso (era âmbar escuro) |
| `#80520F` | `#8F3514` | texto de aviso forte |
| `#FFF7E8` | `#FFF1EB` | fundo de aviso |
| `#FFF3DF` | `#FDEADF` | fundo de aviso forte |
| `#E9A23B` | **mantém** | logo e destaques de marca |

## Ajustes pontuais
- Botão **"Começar do playbook MotorCob"** hoje usa as cores de aviso: vira botão secundário (branco, contorno
  `#DEE1E2`, texto `#0E1112`).
- Item ativo do menu lateral: fundo `rgba(255,255,255,.08)` + barrinha à esquerda de 3 px em âmbar.
- Logo do menu: quadrado âmbar com "M" escuro (mantém) + texto "MotorCob" branco; opcional trocar pelo logo em
  texto "MotorCob." com ponto âmbar, igual ao site.
- Gráficos: manter as cores dos canais; eixos e grades em `#E2E4E5`.

## Critérios de aceite
- Nenhum `#0F4C5C` ou `#103E4B` restante no código.
- Telas iguais às imagens `telas/*_preto.jpg` (exceto o botão do playbook, que vira secundário).
- Contraste AA em textos (≥ 4,5:1); nenhum texto âmbar sobre branco.
