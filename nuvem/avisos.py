"""Sino de avisos (SQL 34): o motor avisa quando um processo longo termina ou quando algo precisa da pessoa.

Vai para o sino: fim de processo longo (pronto ou com erro), algo que precisa da pessoa (saldo pré-pago
esgotado) e alerta de qualidade para quem cuida. Não vai: confirmação do que a própria pessoa acabou de fazer
(isso é o aviso na tela). Banco ainda sem o SQL 34: nada acontece e o plantão segue.
"""
from datetime import datetime, timedelta, timezone

PARA = ("usuario", "empresa", "equipe", "tecnico")
TIPOS = ("pronto", "atencao", "erro")


def criar(sb, para: str, titulo: str, texto: str = "", tipo: str = "pronto", empresa_id=None, usuario_id=None,
          link: str | None = None, chave: str | None = None) -> bool:
    """Grava um aviso. Com chave, o mesmo aviso não repete (a segunda tentativa é ignorada)."""
    from nuvem.supabase_api import ErroSupabase
    if para not in PARA or tipo not in TIPOS:
        raise ValueError(f"aviso inválido: para={para} tipo={tipo}")
    if para == "usuario" and not usuario_id:            # sem a pessoa, vai para a empresa toda
        para = "empresa"
    linha = {"para": para, "tipo": tipo, "titulo": titulo.strip()[:140], "texto": (texto or "").strip()[:400]}
    if empresa_id is not None:
        linha["empresa_id"] = empresa_id
    if para == "usuario":
        linha["usuario_id"] = usuario_id
    if link:
        linha["link"] = link
    if chave:
        linha["chave"] = chave[:200]
    try:
        sb.inserir("avisos", linha)
        return True
    except ErroSupabase as e:
        if e.status in (400, 404, 409):                 # banco sem o SQL 34, ou aviso com a mesma chave
            return False
        raise


def para_campanha(sb, c: dict, titulo: str, texto: str = "", tipo: str = "pronto", chave: str | None = None) -> bool:
    """Aviso de uma campanha: para quem criou; sem essa informação, para a empresa."""
    return criar(sb, "usuario", titulo, texto, tipo, empresa_id=c.get("empresa_id"), usuario_id=c.get("criado_por"),
                 link=f"/mensageria/{c.get('canal') or 'sms'}/campanhas?id={c['id']}", chave=chave)


def qualidade(sb, out=print) -> int:
    """Alertas de qualidade dos fornecedores viram aviso para o Técnico e o Master (um por dia por fornecedor,
    operadora e nível; o banco cuida de não repetir)."""
    try:
        n = sb.rpc("gerar_avisos_qualidade") or 0
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 34
        return 0
    if n:
        out(f"qualidade: {n} alerta(s) novo(s) no sino do Técnico")
    return n


def limpar(sb, agora: datetime | None = None) -> None:
    """Apaga avisos com mais de 90 dias (o sino já não mostra)."""
    limite = (agora or datetime.now(timezone.utc)) - timedelta(days=90)
    try:
        sb.apagar("avisos", {"criado_em": f"lt.{limite.isoformat()}"})
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 34
        pass
