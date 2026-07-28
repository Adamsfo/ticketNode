import { EventoSuiteFotoService } from '../services/EventoSuiteFotoService';
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

function requireFotoId(req: any): number {
    const id = Number(req.params.fotoId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('ID da foto é obrigatório.', 400, '');
    }
    return id;
}

module.exports = {
    async list(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const data = await EventoSuiteFotoService.list(idUsuario, id);
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async add(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const body = req.body || {};
            if (Array.isArray(body.arquivos)) {
                const data = await EventoSuiteFotoService.addMany(
                    idUsuario,
                    id,
                    body.arquivos.map((a: unknown) => String(a))
                );
                return res.status(201).json({ data });
            }
            const foto = await EventoSuiteFotoService.add(idUsuario, id, body);
            return res.status(201).json({ data: foto });
        } catch (error) {
            next(error);
        }
    },

    async setPrincipal(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const fotoId = requireFotoId(req);
            const data = await EventoSuiteFotoService.setPrincipal(
                idUsuario,
                id,
                fotoId
            );
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async mover(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const fotoId = requireFotoId(req);
            const direcao = String(req.body?.direcao || '');
            const data = await EventoSuiteFotoService.mover(
                idUsuario,
                id,
                fotoId,
                direcao as 'esquerda' | 'direita'
            );
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async remove(req: any, res: any, next: any) {
        try {
            const idUsuario = requireUserId(req);
            const id = requireSuiteId(req);
            const fotoId = requireFotoId(req);
            const data = await EventoSuiteFotoService.remove(
                idUsuario,
                id,
                fotoId
            );
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },
};
