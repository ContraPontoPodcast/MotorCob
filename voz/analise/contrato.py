"""Colunas e funções do SQL 60 que o código de voz/analise usa. supabase/testes/testar_speech.py confere cada uma
contra o banco: se um nome mudar no SQL, muda só aqui."""
from __future__ import annotations

COLUNAS: dict[str, tuple[str, ...]] = {
    "voz_trechos": ("empresa_id", "credor_id", "gravacao_id", "origem", "inicio_s", "fim_s", "falante",
                    "texto_redigido"),
    "voz_curadoria_itens": ("empresa_id", "tipo", "chamada_id", "gravacao_id", "avaliacao_id", "tema_id",
                            "trecho_redigido", "decisao_ia", "opcoes", "confianca"),
    "relatorios_credor": ("id", "empresa_id", "credor_id", "competencia", "situacao", "conteudo", "comentario",
                          "pdf_caminho"),
    "voz_analise_consumo": ("empresa_id", "dia", "componente", "chamadas", "minutos", "minutos_cobrados",
                            "tokens_entrada", "tokens_saida", "custo_real"),
    "empresas": ("id", "slug", "nome"),
    "credores": ("id", "nome"),
}
# coluna que só existe com a extensão pgvector (decisão 9); sem ela a VM grava o trecho sem embedding
COLUNA_EMBEDDING = "embedding"
DIMENSAO = 1536

RPCS = ("buscas_voz_pendentes", "responder_busca_voz", "gravar_relatorio_credor", "registrar_recomendacao_voz",
        "conferir_rascunhos_recomendacoes", "renitencia_voz", "avisar_alertas_voz", "apagar_analise_voz_expirada", "registrar_uso_ia_voz")

CONFLITO = {"voz_trechos": "gravacao_id,inicio_s,falante"}
