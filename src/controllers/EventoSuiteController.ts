import { EventoSuiteService } from '../services/EventoSuiteService';
import { CustomError } from '../utils/customError';

function requireUserId(req: any): number {
    const idUsuario = Number(req.user?.id);
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }
    return idUsuario;
}

function requireSuiteId(req: any): number {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('ID da suíte é obrigatório.', 400, '');
    }
    return id;
}

module.exports = {
    async get(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            let filters: Record<string, unknown> = {};
            if (req.query.filters) {
                try {
                    filters = JSON.parse(String(req.query.filters));
                } catch {
                    throw new CustomError(
                        'Filtros inválidos. Verifique o formato da consulta.',
                        400,
                        ''
                    );
                }
            }
            const idSuiteRaw = filters.id ?? undefined;
            if (
                idSuiteRaw !== undefined &&
                idSuiteRaw !== null &&
                idSuiteRaw !== ''
            ) {
                const idSuite = Number(idSuiteRaw);
                if (!Number.isFinite(idSuite) || idSuite <= 0) {
                    throw new CustomError('ID da suíte inválido.', 400, '');
                }
                const registro = await EventoSuiteService.getById(
                    idUsuario,
                    idSuite
                );
                return res.status(200).json({
                    data: [registro],
                    meta: {
                        totalItems: 1,
                        totalPages: 1,
                        currentPage: 1,
                        pageSize: 1,
                    },
                });
            }

            const idEventoRaw =
                filters.idEvento ?? req.query.idEvento ?? undefined;
            const idEvento =
                idEventoRaw !== undefined &&
                idEventoRaw !== null &&
                idEventoRaw !== ''
                    ? Number(idEventoRaw)
                    : undefined;

            const result = await EventoSuiteService.listByEvento(idUsuario, {
                idEvento:
                    idEvento != null && Number.isFinite(idEvento)
                        ? idEvento
                        : undefined,
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 50,
                search: req.query.search ? String(req.query.search) : undefined,
            });

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async getById(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const registro = await EventoSuiteService.getById(idUsuario, id);
            return res.status(200).json({ data: registro });
        } catch (error) {
            next(error);
        }
    },

    async add(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const registro = await EventoSuiteService.create(
                idUsuario,
                req.body || {}
            );
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const registro = await EventoSuiteService.update(
                idUsuario,
                id,
                req.body || {}
            );
            return res.status(200).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async delete(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const result = await EventoSuiteService.delete(idUsuario, id);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },
};
