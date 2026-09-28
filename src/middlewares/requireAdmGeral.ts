import { ProdutorAcesso, TipoAcesso } from '../models/Produtor';
import { Usuario } from '../models/Usuario';
import { CustomError } from '../utils/customError';

/**
 * Caixa: mesmo critério do menu Hospedagem no app —
 * administrador geral (admGeral) ou produtor com tipoAcesso Administrador.
 */
export async function requireAdmGeral(req: any, _res: any, next: any) {
    const idUsuario = Number(req.user?.id);
    if (!idUsuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'admGeral'],
    });

    if (!usuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    if (usuario.admGeral) {
        next();
        return;
    }

    const acessoProdutorAdmin = await ProdutorAcesso.findOne({
        where: {
            idUsuario,
            tipoAcesso: TipoAcesso.Administrador,
        },
        attributes: ['id'],
    });

    if (acessoProdutorAdmin) {
        next();
        return;
    }

    throw new CustomError(
        'Acesso negado. Recurso disponível apenas para administrador ou produtor.',
        403,
        ''
    );
}

module.exports = { requireAdmGeral };
