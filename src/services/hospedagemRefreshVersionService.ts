/**
 * Versão global da hospedagem para o RefreshManager.
 * Contador único — sem MAX(updated_at) em tabelas grandes.
 */
import connection from '../database';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';

const STATE_ID = 1;

function logIncrementError(error: unknown): void {
    const err = error as {
        message?: string;
        stack?: string;
        name?: string;
        parent?: { code?: string; errno?: number; sqlMessage?: string; sql?: string };
        original?: { code?: string; errno?: number; sqlMessage?: string; sql?: string };
        sql?: string;
    };
    const parent = err?.parent || err?.original;
    // Log completo em desenvolvimento (catch não pode engolir o diagnóstico).
    console.error('[hospedagemRefreshVersion] FALHA ao incrementar version', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        code: parent?.code,
        errno: parent?.errno,
        sqlMessage: parent?.sqlMessage,
        sql: parent?.sql || err?.sql,
    });
    logger.error('Falha ao incrementar hospedagem_refresh_state.version', {
        message: err?.message || String(error),
        code: parent?.code,
        sqlMessage: parent?.sqlMessage,
        sql: parent?.sql || err?.sql,
    });
}

export async function obterHospedagemRefreshVersion(): Promise<{
    version: string;
}> {
    try {
        const rows = (await connection.query(
            `SELECT \`version\` FROM hospedagem_refresh_state WHERE id = :id LIMIT 1`,
            { replacements: { id: STATE_ID }, type: QueryTypes.SELECT }
        )) as Array<{ version?: number | string | null }>;

        const version = Number(rows[0]?.version ?? 0);
        return { version: String(Number.isFinite(version) ? version : 0) };
    } catch (error) {
        const err = error as { message?: string; parent?: { sqlMessage?: string } };
        console.error('[hospedagemRefreshVersion] FALHA ao ler version', {
            message: err?.message,
            sqlMessage: err?.parent?.sqlMessage,
        });
        logger.warn('Falha ao ler hospedagem_refresh_state.version', {
            message: err?.message || String(error),
            sqlMessage: err?.parent?.sqlMessage,
        });
        return { version: '0' };
    }
}

/**
 * Incrementa a versão global após mutação operacional.
 * Fire-and-forget seguro: falha não reverte a operação de negócio.
 */
export async function incrementarHospedagemRefreshVersion(): Promise<void> {
    try {
        // Colunas físicas confirmadas: id, version, updated_at
        // `version` entre backticks (evita conflito com função VERSION() do MySQL).
        // Qualificação hospedagem_refresh_state.version = valor ATUAL da linha.
        await connection.query(
            `
            INSERT INTO hospedagem_refresh_state (id, \`version\`, updated_at)
            VALUES (:id, 1, NOW())
            ON DUPLICATE KEY UPDATE
                \`version\` = hospedagem_refresh_state.\`version\` + 1,
                updated_at = NOW()
            `,
            {
                replacements: { id: STATE_ID },
                type: QueryTypes.INSERT,
            }
        );
    } catch (error) {
        logIncrementError(error);
    }
}
