# Prompt Horizons — Tema preto e âmbar (só cores)

Rode por último. Cole no Horizons e publique:

---

```text
Troque o tema de cores da PLATAFORMA (área logada). SÓ CORES E FONTE: não mude layout, textos, componentes, lógica,
rotas, gravações, tabelas ou políticas. A página comercial e o login já estão em preto e não mudam.

Fonte: Geist (Google Fonts) no lugar de Inter em todo o site; números de tabela com tabular-nums.

Troque estes hex em TODAS as classes (bg-, text-, border-, ring-, fill-, stroke-, hover:, focus:, divide-):
#0F4C5C → #0E1112 (cor principal: botões, títulos, links)
#103E4B → #0A0B0C (menu lateral)
#0D4252 e #102E38 → #000000 (hover e sobreposições)
#163943 → #0E1112 · #19313B → #15191B · #304B55 → #3B4043
#EAF2F3 e #E8F0F2 → #F1F2F2 · #EDF4F5 → #F3F4F4 · #E2EAEC e #E5EDEF → #E8EAEA · #D8E3E5 → #DEE1E2
#C9DADD → #D2D6D7 · #DFE8EA → #E3E5E6 · #DBE5E8 → #E0E2E3 · #DEE7E9 → #E2E4E5 · #F5F8F9 → #F6F7F7
#F5F7F8 → #F5F5F5 · #F7FAFB → #F8F8F8 · #FAFCFC → #FAFAFA · #ECF0F1 → #EEEFEF
#EEF3F4 e #EEF2F3 → #F0F1F1 · #E9F1F3 → #EFF0F0 · #E9EFF0 → #EDEEEE
Avisos (hoje em âmbar) passam a laranja-avermelhado: #9A631B → #B4471B · #80520F → #8F3514 ·
#FFF7E8 → #FFF1EB · #FFF3DF → #FDEADF; bordas de aviso #F3C9B8.

Mantêm: âmbar #E9A23B (logo e destaques de marca), vermelho de erro #C62828, verde #2E7D32 e TODAS as cores dos
canais (WhatsApp, RCS, SMS, E-mail, Agente virtual, Discador) e das personas.

Regras: nunca texto âmbar sobre fundo branco (âmbar no branco só como preenchimento com texto escuro ou marcador
pequeno). Âmbar não significa aviso.

Ajustes:
- Botão "Começar do playbook MotorCob": branco com contorno #DEE1E2 e texto #0E1112 (hoje usa cores de aviso).
- Item ativo do menu lateral: fundo rgba(255,255,255,.08) e barrinha âmbar de 3px à esquerda.
- Gráficos: grades e eixos em #E2E4E5; séries com as cores dos canais.
No fim, não pode sobrar nenhum #0F4C5C ou #103E4B no código.
```
