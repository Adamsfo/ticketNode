import { CustomError } from '../utils/customError';
import { obterResumoCaixa } from '../services/caixaService';

function parseDataParam(value: unknown, nome: string): string {
    const raw = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new CustomError(`${nome} inválida. Use o formato AAAA-MM-DD.`, 400, '');
    }
    return raw;
}

module.exports = {
    async getResumo(req: any, res: any, next: any) {
        try {
            const dataInicio = parseDataParam(
                req.query.dataInicio,
                'Data inicial'
            );
            const dataFim = parseDataParam(req.query.dataFim, 'Data final');

            if (dataInicio > dataFim) {
                throw new CustomError(
                    'Data inicial não pode ser posterior à data final.',
                    400,
                    ''
                );
            }

            const data = await obterResumoCaixa({ dataInicio, dataFim });
            return res.status(200).json({ data });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    message: error.message,
                });
            }
            next(error);
        }
    },
};
