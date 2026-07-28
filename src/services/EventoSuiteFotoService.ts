import { Transaction } from 'sequelize';
import connection from '../database';
import { EventoSuiteFoto } from '../models/EventoSuiteFoto';
import { CustomError } from '../utils/customError';
import { uploadStorage } from '../utils/uploadStorage';
import { EventoSuiteService } from './EventoSuiteService';

function serializeFoto(foto: EventoSuiteFoto) {
    return {
        id: foto.id,
        idEventoSuite: foto.idEventoSuite,
        arquivo: foto.arquivo,
        ordem: foto.ordem,
        principal: Boolean(foto.principal),
        createdAt: foto.createdAt,
        updatedAt: foto.updatedAt,
    };
}

async function assertSuiteOwned(idUsuario: number, idEventoSuite: number) {
    await EventoSuiteService.assertCanManage(idUsuario, idEventoSuite);
}

async function listOrdered(
    idEventoSuite: number,
    transaction?: Transaction
) {
    return EventoSuiteFoto.findAll({
        where: { idEventoSuite },
        order: [
            ['ordem', 'ASC'],
            ['id', 'ASC'],
        ],
        transaction,
    });
}

/** Reindex contínuo 1-based (1,2,3…). */
async function reindex(
    idEventoSuite: number,
    transaction?: Transaction
) {
    const fotos = await listOrdered(idEventoSuite, transaction);
    let ordem = 1;
    for (const foto of fotos) {
        if (Number(foto.ordem) !== ordem) {
            foto.ordem = ordem;
            await foto.save({ transaction });
        }
        ordem += 1;
    }
    return listOrdered(idEventoSuite, transaction);
}

async function deletePhysicalSafe(arquivo: string | null | undefined) {
    const result = await uploadStorage.deleteFile(arquivo);
    if (result.warning) {
        console.warn(`[EventoSuiteFoto] ${result.warning}`);
    }
    return result;
}

export const EventoSuiteFotoService = {
    async list(idUsuario: number, idEventoSuite: number) {
        await assertSuiteOwned(idUsuario, idEventoSuite);
        const fotos = await listOrdered(idEventoSuite);
        return fotos.map(serializeFoto);
    },

    async add(
        idUsuario: number,
        idEventoSuite: number,
        body: { arquivo?: string; principal?: boolean }
    ) {
        await assertSuiteOwned(idUsuario, idEventoSuite);

        const arquivo = String(body.arquivo || '').trim();
        if (!arquivo) {
            throw new CustomError(
                'Selecione um arquivo de imagem válido.',
                400,
                ''
            );
        }

        return connection.transaction(async (t: Transaction) => {
            const count = await EventoSuiteFoto.count({
                where: { idEventoSuite },
                transaction: t,
            });
            const marcarPrincipal = body.principal === true || count === 0;

            if (marcarPrincipal) {
                await EventoSuiteFoto.update(
                    { principal: false },
                    { where: { idEventoSuite }, transaction: t }
                );
            }

            const created = await EventoSuiteFoto.create(
                {
                    idEventoSuite,
                    arquivo,
                    ordem: count + 1,
                    principal: marcarPrincipal,
                },
                { transaction: t }
            );

            await reindex(idEventoSuite, t);
            const fresh = await EventoSuiteFoto.findByPk(created.id, {
                transaction: t,
            });
            return serializeFoto(fresh!);
        });
    },

    async addMany(
        idUsuario: number,
        idEventoSuite: number,
        arquivos: string[]
    ) {
        const limpos = (arquivos || [])
            .map((a) => String(a || '').trim())
            .filter(Boolean);
        if (limpos.length === 0) {
            throw new CustomError(
                'Nenhuma imagem válida para anexar.',
                400,
                ''
            );
        }

        await assertSuiteOwned(idUsuario, idEventoSuite);

        await connection.transaction(async (t: Transaction) => {
            let count = await EventoSuiteFoto.count({
                where: { idEventoSuite },
                transaction: t,
            });

            for (let i = 0; i < limpos.length; i++) {
                const arquivo = limpos[i];
                const marcarPrincipal = count === 0 && i === 0;

                if (marcarPrincipal) {
                    await EventoSuiteFoto.update(
                        { principal: false },
                        { where: { idEventoSuite }, transaction: t }
                    );
                }

                await EventoSuiteFoto.create(
                    {
                        idEventoSuite,
                        arquivo,
                        ordem: count + 1,
                        principal: marcarPrincipal,
                    },
                    { transaction: t }
                );
                count += 1;
            }

            await reindex(idEventoSuite, t);
        });

        return (await listOrdered(idEventoSuite)).map(serializeFoto);
    },

    async setPrincipal(
        idUsuario: number,
        idEventoSuite: number,
        fotoId: number
    ) {
        await assertSuiteOwned(idUsuario, idEventoSuite);

        await connection.transaction(async (t: Transaction) => {
            const foto = await EventoSuiteFoto.findOne({
                where: { id: fotoId, idEventoSuite },
                transaction: t,
            });
            if (!foto) {
                throw new CustomError(
                    'Foto não encontrada nesta suíte.',
                    404,
                    ''
                );
            }

            await EventoSuiteFoto.update(
                { principal: false },
                { where: { idEventoSuite }, transaction: t }
            );
            foto.principal = true;
            await foto.save({ transaction: t });
        });

        return (await listOrdered(idEventoSuite)).map(serializeFoto);
    },

    async mover(
        idUsuario: number,
        idEventoSuite: number,
        fotoId: number,
        direcao: 'esquerda' | 'direita'
    ) {
        await assertSuiteOwned(idUsuario, idEventoSuite);

        if (direcao !== 'esquerda' && direcao !== 'direita') {
            throw new CustomError(
                'Não foi possível mover a foto. Use esquerda ou direita.',
                400,
                ''
            );
        }

        await connection.transaction(async (t: Transaction) => {
            const fotos = await listOrdered(idEventoSuite, t);
            const idx = fotos.findIndex((f) => Number(f.id) === Number(fotoId));
            if (idx < 0) {
                throw new CustomError(
                    'Foto não encontrada nesta suíte.',
                    404,
                    ''
                );
            }

            const swapWith =
                direcao === 'esquerda' ? idx - 1 : idx + 1;
            if (swapWith < 0 || swapWith >= fotos.length) {
                // Limite da lista — noop silencioso (UI já desabilita)
                return;
            }

            const a = fotos[idx];
            const b = fotos[swapWith];
            const ordemA = a.ordem;
            a.ordem = b.ordem;
            b.ordem = ordemA;
            await a.save({ transaction: t });
            await b.save({ transaction: t });
            await reindex(idEventoSuite, t);
        });

        return (await listOrdered(idEventoSuite)).map(serializeFoto);
    },

    async remove(idUsuario: number, idEventoSuite: number, fotoId: number) {
        await assertSuiteOwned(idUsuario, idEventoSuite);

        let arquivoRemovido: string | null = null;

        await connection.transaction(async (t: Transaction) => {
            const foto = await EventoSuiteFoto.findOne({
                where: { id: fotoId, idEventoSuite },
                transaction: t,
            });
            if (!foto) {
                throw new CustomError(
                    'Foto não encontrada nesta suíte.',
                    404,
                    ''
                );
            }

            arquivoRemovido = foto.arquivo;
            const eraPrincipal = Boolean(foto.principal);
            await foto.destroy({ transaction: t });

            const restantes = await reindex(idEventoSuite, t);
            if (eraPrincipal && restantes.length > 0) {
                restantes[0].principal = true;
                await restantes[0].save({ transaction: t });
            }
        });

        await deletePhysicalSafe(arquivoRemovido);
        return (await listOrdered(idEventoSuite)).map(serializeFoto);
    },

    /**
     * Remove registros de foto dentro de uma transaction externa
     * (ex.: exclusão da suíte). Arquivos físicos ficam a cargo do caller.
     */
    async destroyAllInTransaction(
        idEventoSuite: number,
        transaction: Transaction
    ) {
        await EventoSuiteFoto.destroy({
            where: { idEventoSuite },
            transaction,
        });
    },

    async listArquivos(idEventoSuite: number): Promise<string[]> {
        const fotos = await EventoSuiteFoto.findAll({
            where: { idEventoSuite },
            attributes: ['arquivo'],
            raw: true,
        });
        return fotos
            .map((f: any) => String(f.arquivo || '').trim())
            .filter(Boolean);
    },

    async deletePhysicalFiles(arquivos: string[]) {
        for (const arquivo of arquivos) {
            await deletePhysicalSafe(arquivo);
        }
    },
};

export default EventoSuiteFotoService;
