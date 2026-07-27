import { Op, where, fn, col } from "sequelize";

/** Aplica REPLACE encadeado na coluna SQL (não altera dados gravados). */
function nestedReplace(column: string, chars: string[]) {
    return chars.reduce(
        (expr, ch) => fn("REPLACE", expr, ch, ""),
        col(column) as any
    );
}

/**
 * Condições de busca de Cliente/Usuário para Nova Reserva e demais telas.
 * - Só dígitos (ou máscara): código (id / id_cliente), CPF e telefone sem máscara
 * - Com letras: nome e sobrenome (LIKE parcial)
 */
export function buildUsuarioSearchConditions(search: string): any[] {
    const q = String(search ?? "").trim();
    if (!q) return [];

    const hasLetters = /[A-Za-zÀ-ÿ]/.test(q);
    const digits = q.replace(/\D/g, "");

    if (!hasLetters && digits.length > 0) {
        const cpfSemMascara = nestedReplace("Usuario.cpf", [".", "-", " "]);
        const telefoneSemMascara = nestedReplace("Usuario.telefone", [
            "(",
            ")",
            "-",
            " ",
            ".",
            "+",
        ]);

        return [
            { id: { [Op.like]: `%${digits}%` } },
            { id_cliente: { [Op.like]: `%${digits}%` } },
            where(cpfSemMascara, { [Op.like]: `%${digits}%` }),
            where(telefoneSemMascara, { [Op.like]: `%${digits}%` }),
        ];
    }

    // Pesquisa com letras: nome / sobrenome (parcial)
    return [
        { nomeCompleto: { [Op.like]: `%${q}%` } },
        { sobreNome: { [Op.like]: `%${q}%` } },
        // Mantém login/email para não regressar a tela de usuários admin
        { email: { [Op.like]: `%${q}%` } },
        { login: { [Op.like]: `%${q}%` } },
    ];
}
