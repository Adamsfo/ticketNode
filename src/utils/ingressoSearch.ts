import { Op } from "sequelize";

/**
 * Busca de ingressos (listagem / cortesias) via parâmetro `search` do getRegistros.
 * Campos: código (id), nome impresso, status, usuário, tipo de ingresso (lote) e setor.
 */
export function buildIngressoSearchConditions(search: string): any[] {
    const q = String(search ?? "").trim();
    if (!q) return [];

    const hasLetters = /[A-Za-zÀ-ÿ]/.test(q);
    const digits = q.replace(/\D/g, "");

    const conditions: any[] = [];

    if (digits.length > 0) {
        conditions.push({ id: { [Op.like]: `%${digits}%` } });
    }

    if (!hasLetters && digits.length > 0) {
        return conditions;
    }

    conditions.push(
        { nomeImpresso: { [Op.like]: `%${q}%` } },
        { status: { [Op.like]: `%${q}%` } },
        { "$Usuario.nome_completo$": { [Op.like]: `%${q}%` } },
        { "$EventoIngresso.nome$": { [Op.like]: `%${q}%` } },
        { "$TipoIngresso.descricao$": { [Op.like]: `%${q}%` } },
    );

    return conditions;
}
