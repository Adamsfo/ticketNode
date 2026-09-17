import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Produtor, ProdutorAcesso, TipoAcesso } from "../models/Produtor";
import { Usuario } from "../models/Usuario";

const TIPOS_ACESSO_VALIDOS = Object.values(TipoAcesso);

type PayloadProdutorAcesso = {
    idProdutor: number;
    idUsuario: number;
    tipoAcesso: TipoAcesso;
    cliente_chavePOS?: string;
    pos_id?: number;
};

function parsePositiveInt(value: unknown, field: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw new CustomError(`${field} inválido.`, 400, '');
    }
    return n;
}

function normalizarPayloadProdutorAcesso(body: any): PayloadProdutorAcesso {
    const idProdutor = parsePositiveInt(body?.idProdutor, 'idProdutor');
    const idUsuario = parsePositiveInt(body?.idUsuario, 'idUsuario');
    const tipoAcesso = String(body?.tipoAcesso || '').trim() as TipoAcesso;

    if (!TIPOS_ACESSO_VALIDOS.includes(tipoAcesso)) {
        throw new CustomError('tipoAcesso inválido.', 400, '');
    }

    const payload: PayloadProdutorAcesso = {
        idProdutor,
        idUsuario,
        tipoAcesso,
    };

    if (tipoAcesso === TipoAcesso.PDV) {
        const chave = body?.cliente_chavePOS;
        if (chave !== undefined && chave !== null && String(chave).trim() !== '') {
            payload.cliente_chavePOS = String(chave).trim();
        }
        const posId = body?.pos_id;
        if (posId !== undefined && posId !== null && String(posId).trim() !== '') {
            const parsedPos = Number(posId);
            if (!Number.isFinite(parsedPos) || parsedPos <= 0) {
                throw new CustomError('pos_id inválido.', 400, '');
            }
            payload.pos_id = parsedPos;
        }
    }

    return payload;
}

async function assertReferenciasProdutorAcesso(payload: PayloadProdutorAcesso) {
    const usuario = await Usuario.findByPk(payload.idUsuario, {
        attributes: ['id'],
    });
    if (!usuario) {
        throw new CustomError('Usuário não encontrado.', 404, '');
    }

    const produtor = await Produtor.findByPk(payload.idProdutor, {
        attributes: ['id'],
    });
    if (!produtor) {
        throw new CustomError('Produtor não encontrado.', 404, '');
    }
}

async function assertSemDuplicataProdutorAcesso(
    idUsuario: number,
    idProdutor: number,
    excludeId?: number
) {
    const existente = await ProdutorAcesso.findOne({
        where: { idUsuario, idProdutor },
    });
    if (existente && existente.id !== excludeId) {
        throw new CustomError(
            'Já existe acesso para este usuário neste produtor.',
            409,
            ''
        );
    }
}

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Produtor, req, res, next)
    },

    async getAcessoProdutor(req: any, res: any, next: any) {
        console.log('getAcessoProdutor')
        await getRegistros(ProdutorAcesso, req, res, next)
    },

    async add(req: any, res: any, next: any) {
        try {
            const { nome } = req.body;

            //   // Validação básica
            if (!nome) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await Produtor.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async addAcessoProdutor(req: any, res: any, next: any) {
        try {
            const payload = normalizarPayloadProdutorAcesso(req.body);
            await assertReferenciasProdutorAcesso(payload);
            await assertSemDuplicataProdutorAcesso(
                payload.idUsuario,
                payload.idProdutor
            );

            const registro = await ProdutorAcesso.create(payload);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async editAcessoProdutor(req: any, res: any, next: any) {
        try {
            const id = Number(req.params.id);
            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            const registro = await ProdutorAcesso.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            const payload = normalizarPayloadProdutorAcesso({
                ...req.body,
                idUsuario: req.body?.idUsuario ?? registro.idUsuario,
                idProdutor: req.body?.idProdutor ?? registro.idProdutor,
                tipoAcesso: req.body?.tipoAcesso ?? registro.tipoAcesso,
                cliente_chavePOS:
                    req.body?.cliente_chavePOS ?? registro.cliente_chavePOS,
                pos_id: req.body?.pos_id ?? registro.pos_id,
            });

            await assertReferenciasProdutorAcesso(payload);
            await assertSemDuplicataProdutorAcesso(
                payload.idUsuario,
                payload.idProdutor,
                registro.id
            );

            registro.idProdutor = payload.idProdutor;
            registro.idUsuario = payload.idUsuario;
            registro.tipoAcesso = payload.tipoAcesso;
            if (payload.tipoAcesso === TipoAcesso.PDV) {
                registro.cliente_chavePOS = payload.cliente_chavePOS;
                registro.pos_id = payload.pos_id;
            } else {
                (registro as any).cliente_chavePOS = null;
                (registro as any).pos_id = null;
            }

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Produtor.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    (registro as any)[field] = req.body[field];
                }
            });

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async delete(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await Produtor.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            // Deletar o usuário
            await registro.destroy();

            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async deleteAcessoProdutor(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await ProdutorAcesso.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            // Deletar o usuário
            await registro.destroy();

            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    }
}
