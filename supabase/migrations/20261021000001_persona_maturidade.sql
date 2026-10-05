-- Maturidade das personas: o motor publica, junto com o ranking de canais, o quanto cada
-- persona já está construída (o que está sendo visto x o que já está decidido).
--
-- maturidade = {fase: 'coletando' | 'previa' | 'definida', indice: 0–100, indice_anterior,
--               volume_pct, confianca (chance de o 1º canal render mais CPC por real que o 2º),
--               meta_tentativas, persona_formada, proximo_passo}
-- ranking[] ganha peso_proprio (0–1: quanto da taxa vem da própria persona; o resto é a média
-- da carteira) e evidencia ('pouca' | 'previa' | 'firme').
-- Pode ser rodado de novo sem erro.

alter table public.personas add column if not exists maturidade jsonb not null default '{}';
