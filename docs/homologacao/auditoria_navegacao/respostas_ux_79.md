# CX → UX: conferência do PROMPT_79 (Orquestração), bundle site6

1. abas-telas: confirmado. A configuração das abas (`Re`) não é exportada e só a fileira (`Ve`) a lê; a gaveta e o ⌘K não leem. Dá para agrupar sem efeito colateral. Hoje a fileira junta todas as abas, ignorando o rótulo. As abas "Relatórios ↗" (externo) ainda existem: o 78 não foi colado. Se Painel ficar sem ver_painel, o grupo Resultados fica vazio e precisa sumir.
2. Carteira: confirmado.
   - O seletor do cabeçalho (`N` no app-shell) e as pílulas do cartão CARTEIRA chamam o mesmo `selectCredor(id)`.
   - O cabeçalho (`L`) sempre desenha o `N` e não aceita opção para escondê-lo. A Orquestração precisa da barra própria, como o prompt já prevê.
3. Pausados: confirmado.
   - São os segmentos desta carteira com `em_uso = false` (`segmentos_em_uso`).
   - Hoje aparecem como pílulas depois do rótulo "Pausados", com o mesmo clique dos outros segmentos.
   - Podem ir para um menu sem perder nada.
4. Cartão do segmento: confirmado.
   - Todos os handlers (Tirar da carteira, chaves Em uso, Ligado em todas, Separar, Editar para as duas) são funções e estado do próprio componente da tela.
   - A gaveta mantém esses handlers se for desenhada dentro do mesmo componente. Se virar componente ou rota separada, eles se perdem.
5. "Ver todas as carteiras" e "Reenquadrar agora": confirmado.
   - "Ver todas" só liga um estado, então funciona chamado de um item de menu.
   - O "Reenquadrar" é um componente (`forwardRef` com `pedir()`) que tem o próprio andamento ("Na fila…", "Reenquadrando…") e uma confirmação. O aviso depois do Salvar chama `G.current.pedir()`.
   - Se ele morar só dentro do "⋯", o ref fica nulo e o andamento some. Ele precisa ficar montado.
6. Sticky: confirmado.
   - A faixa de contexto tem 44 px (`h-11`, `z-30`) em qualquer largura.
   - A barra das vistas (top-0) sai com o 79. A faixa interna do editor (top-0) precisa de top = 44 + altura da barra.
   - A "linha dos dias fixa ao rolar a página" não funciona: a grade fica num contêiner com rolagem horizontal, e dentro dele o sticky vertical gruda no contêiner, não na página. Além disso, mexeria no editor por dentro. Tirei esse item.
   - A coluna da esquerda já é `sticky left-0`.
7. Nº de clientes por segmento: confirmado.
   - Já vem calculado de `enquadramento` (`bt`/`yt`). Não sai de `segmentos_em_uso` e não precisa de consulta nova.
   - "Compartilhada" só é conhecida para o segmento escolhido (`compartilhada_com`). As pílulas sabem apenas `estrategia_propria` (o selo "própria"). Por isso a bolinha âmbar só pode ir na pílula escolhida.
8. Cores: confirmado.
   - Orquestração: 133 usos de `#0F4C5C`, sendo 21 fundos (8 em botões), 30 bordas e 72 textos.
   - Editor (`estrategia-editor-core`): 49 usos, sendo 4 fundos.
   - Só os botões com fundo `#0F4C5C` mudam; bordas e textos são marcação.
9. Permissões: confirmado.
   - `s = ye(['admin','planejamento'])` exige um perfil desses com alguma permissão `editar_*`. No padrão, Admin e Planejamento editam; Operação e Gestão só leem.
   - Salvar aparece com `s && estratégia escolhida` e tem a confirmação `window.confirm` quando a estratégia vale em outra carteira.
   - "Novo segmento" e "Ver todas" seguem a mesma regra `s`.
