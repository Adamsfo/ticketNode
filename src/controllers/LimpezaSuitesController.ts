import { CustomError } from '../utils/customError';
import {
    listarLimpezasSuitesAdmin,
    iniciarLimpezaSuiteAdmin,
    concluirLimpezaSuiteAdmin,
    criarLimpezaManualSuiteAdmin,
} from '../services/eventoSuiteLimpezaAdminService';

module.exports = {
    async listar(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const resultado = await listarLimpezasSuitesAdmin({
                idUsuario,
                filtro: req.query.filtro ? String(req.query.filtro) : 'todas',
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 30,
            });

            return res.status(200).json(resultado);
        } catch (error) {
            next(error);
        }
    },

    async criarManual(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idEventoSuite = Number(req.body?.idEventoSuite);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idEventoSuite) {
                throw new CustomError('idEventoSuite é obrigatório.', 400, '');
            }

            const data = await criarLimpezaManualSuiteAdmin(
                idEventoSuite,
                idUsuario
            );
            return res.status(201).json({
                success: true,
                message: 'Limpeza manual criada.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async iniciar(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idLimpeza = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idLimpeza) {
                throw new CustomError('id da limpeza é obrigatório.', 400, '');
            }

            const data = await iniciarLimpezaSuiteAdmin(idLimpeza, idUsuario);
            return res.status(200).json({
                success: true,
                message: 'Limpeza iniciada.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async concluir(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idLimpeza = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idLimpeza) {
                throw new CustomError('id da limpeza é obrigatório.', 400, '');
            }

            const data = await concluirLimpezaSuiteAdmin(idLimpeza, idUsuario);
            return res.status(200).json({
                success: true,
                message: 'Limpeza concluída.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },
};
