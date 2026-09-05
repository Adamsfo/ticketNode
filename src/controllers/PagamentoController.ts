import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Payment, MercadoPagoConfig, Customer, CustomerCard, OAuth, Preference, PaymentRefund } from 'mercadopago'
const axios = require('axios')
import { encrypt, decrypt } from '../utils/encryption'; // Supondo que você tenha funções de criptografia
import { UsuarioMetodoPagamento } from "../models/ClienteMetodoPagamento";
import { addHistorico } from "./TransacaoController";
import { HistoricoTransacao, IngressoTransacao, TipoPagamento, Transacao, TransacaoPagamento } from "../models/Transacao";
import { Usuario } from "../models/Usuario";
import { HistoricoIngresso, Ingresso } from "../models/Ingresso";
import connection from "../database";
import { Empresa } from "../models/Empresa";
import { Evento } from "../models/Evento";
import { ProdutorAcesso, TipoAcesso } from "../models/Produtor";
import apiJango from "../api/apiJango";
import {
    assertTransacaoHospedagemPagaivel,
    confirmarHospedagem,
} from "../services/reservaSuiteService";
import { EventoIngresso } from "../models/EventoIngresso";
import { Op } from "sequelize";
import { formatInTimeZone } from "date-fns-tz";

const ClienteID = process.env.MP_CLIENT_ID || ""
const ClienteSecret = process.env.MP_CLIENT_SECRET || ""

const TanzAcessToken = process.env.MP_TANZ_ACCESS_TOKEN || ""
const SuperTefBearerToken = process.env.SUPERTEF_BEARER_TOKEN || ""

/** Prefixo de histórico exclusivo Pagamento PDV — idempotência da abertura de conta Jango. */
const MARCA_CONTA_JANGO_PDV = "Conta Jango PDV|trx=";

/** Lock em memória: evita duas execuções simultâneas da mesma venda PDV. */
const locksAbrirContaPdv = new Map<number, Promise<any>>();

function historicoContaPdvFinalizado(descricao: string | null | undefined): boolean {
    if (!descricao) return false;
    return (
        descricao.includes("|venda=") ||
        descricao.includes("|reutilizada") ||
        descricao.includes("|ok")
    );
}

async function buscarHistoricoContaPdv(idTrx: number, marca: string, transaction?: any) {
    return HistoricoTransacao.findOne({
        where: {
            idTransacao: idTrx,
            descricao: { [Op.like]: `${marca}%` },
        },
        order: [["id", "DESC"]],
        transaction,
    });
}

async function obterIdPagamentoPdv(idTrx: number): Promise<number | string | null> {
    const pagamento = await TransacaoPagamento.findOne({
        where: { idTransacao: idTrx },
        order: [["id", "DESC"]],
    });
    if (!pagamento) return null;
    return pagamento.id ?? pagamento.PagamentoCodigo ?? null;
}

/**
 * Claim atômico por idTransacao (SELECT FOR UPDATE na venda).
 * Garante que só uma execução segue para abreConta, mesmo entre processos.
 */
async function reivindicarAberturaContaPdv(
    idTrx: number,
    idUser: number,
    marca: string,
    idPagamento: number | string | null
): Promise<{
    adquirido: boolean;
    jaFinalizado: boolean;
    historico: HistoricoTransacao | null;
}> {
    const dbTx = await connection.transaction();
    try {
        const transacao = await Transacao.findOne({
            where: { id: idTrx },
            lock: dbTx.LOCK.UPDATE,
            transaction: dbTx,
        });
        if (!transacao) {
            throw new CustomError("Transação não encontrada.", 404, "");
        }

        const existente = await buscarHistoricoContaPdv(idTrx, marca, dbTx);
        if (existente) {
            await dbTx.commit();
            console.log("[PDV abrirConta] claim: histórico já existe", {
                idTransacao: idTrx,
                idPagamento,
                descricao: existente.descricao,
                finalizado: historicoContaPdvFinalizado(existente.descricao),
            });
            return {
                adquirido: false,
                jaFinalizado: historicoContaPdvFinalizado(existente.descricao),
                historico: existente,
            };
        }

        const criado = await HistoricoTransacao.create(
            {
                idTransacao: idTrx,
                idUsuario: idUser,
                data: new Date(),
                descricao: `${marca}|claim|pag=${idPagamento ?? "n/a"}`,
            },
            { transaction: dbTx }
        );
        await dbTx.commit();
        console.log("[PDV abrirConta] claim adquirido — seguirá criação/reuso", {
            idTransacao: idTrx,
            idPagamento,
            historicoId: criado.id,
        });
        return { adquirido: true, jaFinalizado: false, historico: criado };
    } catch (error) {
        await dbTx.rollback();
        throw error;
    }
}

async function aguardarFinalizacaoHistoricoPdv(
    idTrx: number,
    marca: string,
    tentativas = 15,
    intervaloMs = 1000
) {
    for (let i = 0; i < tentativas; i++) {
        const hist = await buscarHistoricoContaPdv(idTrx, marca);
        if (hist && historicoContaPdvFinalizado(hist.descricao)) {
            return hist;
        }
        await new Promise((res) => setTimeout(res, intervaloMs));
    }
    return buscarHistoricoContaPdv(idTrx, marca);
}

/** Retoma claim órfão sob lock; evita segundo abreConta enquanto outra execução está viva. */
async function retomarClaimOrfaoPdv(
    idTrx: number,
    idUser: number,
    marca: string,
    idPagamento: number | string | null
): Promise<{ adquirido: boolean; historico: HistoricoTransacao | null; jaFinalizado: boolean }> {
    const dbTx = await connection.transaction();
    try {
        await Transacao.findOne({
            where: { id: idTrx },
            lock: dbTx.LOCK.UPDATE,
            transaction: dbTx,
        });
        const existente = await buscarHistoricoContaPdv(idTrx, marca, dbTx);
        if (!existente) {
            const criado = await HistoricoTransacao.create(
                {
                    idTransacao: idTrx,
                    idUsuario: idUser,
                    data: new Date(),
                    descricao: `${marca}|claim|retomado|pag=${idPagamento ?? "n/a"}`,
                },
                { transaction: dbTx }
            );
            await dbTx.commit();
            return { adquirido: true, historico: criado, jaFinalizado: false };
        }
        if (historicoContaPdvFinalizado(existente.descricao)) {
            await dbTx.commit();
            return { adquirido: false, historico: existente, jaFinalizado: true };
        }
        // Ainda em claim: só retoma se o claim for antigo (> 20s)
        const idadeMs = Date.now() - new Date(existente.data).getTime();
        if (idadeMs < 20000) {
            await dbTx.commit();
            return { adquirido: false, historico: existente, jaFinalizado: false };
        }
        existente.descricao = `${marca}|claim|retomado|pag=${idPagamento ?? "n/a"}`;
        existente.idUsuario = idUser;
        existente.data = new Date();
        await existente.save({ transaction: dbTx });
        await dbTx.commit();
        console.log("[PDV abrirConta] claim órfão retomado", {
            idTransacao: idTrx,
            idPagamento,
            idadeMs,
        });
        return { adquirido: true, historico: existente, jaFinalizado: false };
    } catch (error) {
        await dbTx.rollback();
        throw error;
    }
}

// Função para gerar uma chave de idempotência única
function generateUniqueIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Função para salvar dados de pagamento
// async function savePaymentData(paymentResponse: any, payer: any, idUsuario: number, token: string) {
//     const encryptedData = encrypt(JSON.stringify({
//         payment_method_id: paymentResponse.payment_method_id,
//         issuer_id: paymentResponse.issuer_id,
//         card: paymentResponse.card,
//         payer: payer,
//         token: token,
//     }));

//     // Supondo que você tenha um modelo de banco de dados PaymentData
//     await UsuarioMetodoPagamento.create({
//         idUsuario: idUsuario,
//         dados: encryptedData,
//     });
// }

async function transacaoPaga(idTransacao: number, descricao: string, idUsuario: number, ignorarValidacaoValor: boolean = true) {
    const transaction = await connection.transaction(); // substitua pela instância correta do Sequelize

    try {
        // Atualiza status da transação
        const transacao = await Transacao.findOne({ where: { id: idTransacao }, transaction });
        if (!transacao) {
            throw new Error('Transação não encontrada');
        }

        if (!ignorarValidacaoValor && Math.round((transacao.valorRecebido ?? 0) * 100) < Math.round((transacao.valorTotal ?? 0) * 100)) {
            await transaction.rollback();
            return false;
        }

        await Transacao.update(
            { status: 'Pago', dataPagamento: new Date() }, // Adiciona a data do pagamento
            { where: { id: idTransacao }, transaction }
        );

        // Cria histórico da transação
        await HistoricoTransacao.create({
            idTransacao,
            data: new Date(),
            descricao,
            idUsuario
        }, { transaction });

        // Busca ingressos relacionados
        const ingressos = await IngressoTransacao.findAll({
            where: { idTransacao },
            transaction,
        });

        // Atualiza os ingressos e cria histórico
        await Promise.all(ingressos.map(async (ingresso) => {
            await Ingresso.update(
                { status: 'Confirmado' },
                { where: { id: ingresso.idIngresso }, transaction }
            );

            await HistoricoIngresso.create({
                idIngresso: ingresso.idIngresso,
                data: new Date(),
                descricao: `Confirmado - ${descricao}`,
                idUsuario
            }, { transaction });
        }));

        // Commita tudo
        await transaction.commit();
        console.log('Transação confirmada');

        try {
            await confirmarHospedagem(idTransacao);
        } catch (error) {
            console.error('Erro ao confirmar hospedagem após pagamento:', error);
        }

        return true;
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao processar transação paga:', error);
        throw error;
    }
}

async function transacaoCancelada(idTransacao: number, descricao: string, idUsuario: number) {
    const transaction = await connection.transaction(); // substitua pela instância correta do Sequelize

    try {
        // Atualiza status da transação
        await Transacao.update(
            { status: 'Cancelado' },
            { where: { id: idTransacao }, transaction }
        );

        // Cria histórico da transação
        await HistoricoTransacao.create({
            idTransacao,
            data: new Date(),
            descricao,
            idUsuario
        }, { transaction });

        // Busca ingressos relacionados
        const ingressos = await IngressoTransacao.findAll({
            where: { idTransacao },
            transaction,
        });

        // Atualiza os ingressos e cria histórico
        await Promise.all(ingressos.map(async (ingresso) => {
            await Ingresso.update(
                { status: 'Reembolsado' },
                { where: { id: ingresso.idIngresso }, transaction }
            );

            await HistoricoIngresso.create({
                idIngresso: ingresso.idIngresso,
                data: new Date(),
                descricao: `Confirmado - ${descricao}`,
                idUsuario
            }, { transaction });
        }));

        // Commita tudo
        await transaction.commit();

        return true;
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao processar transação paga:', error);
        throw error;
    }
}

async function geraTokenSplit() {
    try {
        const empresa = await Empresa.findOne({
            where: { id: 1 },
        });

        if (!empresa || !empresa.refreshToken) {
            throw new CustomError(
                'Empresa não encontrada ou refreshToken não definido',
                404,
                null
            );
        }

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: ClienteID,
            client_secret: ClienteSecret,
            refresh_token: empresa.refreshToken,
        });

        // ------------------- pra refazer vinculo --------------------------------------------
        // const body = new URLSearchParams({
        //     grant_type: 'authorization_code',
        //     client_id: ClienteID,
        //     client_secret: ClienteSecret,
        //     code: 'TG-6a2d8a91e4838a0001c5086a-2497106970',
        //     redirect_uri: 'https://tanztecnologia.com.br/'
        // });

        // console.log('Vinculando OAuth primeira vez...');

        // const response2 = await axios.post(
        //     'https://api.mercadopago.com/oauth/token',
        //     body,
        //     {
        //         headers: {
        //             'Content-Type': 'application/x-www-form-urlencoded'
        //         }
        //     }
        // );

        // const data2 = response2.data;

        // console.log('OAuth vinculado com sucesso');
        // console.log(data2);

        // console.log('Renovando token split...');

        const response = await axios.post(
            'https://api.mercadopago.com/oauth/token',
            body,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const data = response.data;

        console.log('Token Split renovado com sucesso');

        // ⚠️ ATUALIZE OS DOIS
        empresa.accessToken = data.access_token;
        empresa.refreshToken = data.refresh_token;
        await empresa.save();

        return empresa;

    } catch (error: any) {
        console.error('Erro ao gerar token split:', error.response?.data || error);
        throw new CustomError(
            'Erro ao gerar token split',
            500,
            error.response?.data || error
        );
    }
}

/** Hospedagem link externo: bloqueia pagamento se expirada. Ingressos → no-op. */
async function rejeitarSeReservaHospedagemExpirada(
    idTransacao: number,
    res: any
): Promise<boolean> {
    try {
        await assertTransacaoHospedagemPagaivel(Number(idTransacao));
        return false;
    } catch (error) {
        if (
            error instanceof CustomError &&
            String(error.message) === 'Reserva expirada.'
        ) {
            res.status(400).json({ error: 'Reserva expirada.' });
            return true;
        }
        throw error;
    }
}

module.exports = {
    async pagamento(req: any, res: any, next: any) {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, idTransacao, salvarCartao, deviceId, items } = req.body

        if (await rejeitarSeReservaHospedagemExpirada(idTransacao, res)) {
            return;
        }

        const users = await Usuario.findAll({
            where: { email: payer.email },
        });

        const first_name = users[0].nomeCompleto
        const last_name = users[0].sobreNome

        let empresa = await Empresa.findOne({
            where: { id: 1 },
        });

        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit()
        }

        const transacao = await Transacao.findOne({
            where: { id: idTransacao },
        });

        if (!transacao) {
            return res.status(404).json({ error: 'Transação não encontrada' });
        }

        const evento = await Evento.findOne({
            where: { id: transacao.idEvento },
        });

        const client = new MercadoPagoConfig({ accessToken: evento?.idProdutor === 1 ? (empresa.accessToken ?? "") : TanzAcessToken });
        const tanzMP = new MercadoPagoConfig({ accessToken: TanzAcessToken });

        // const client = new MercadoPagoConfig({ accessToken: JangoAcessToken });
        // const tanzMP = new MercadoPagoConfig({ accessToken: JangoAcessToken });

        const payment = new Payment(client)
        const customer = new Customer(tanzMP);
        const customerCard = new CustomerCard(tanzMP)
        try {
            // Buscar se cliente já existe
            const customers = await customer.search({ options: { email: payer.email } });

            let customerId: string;

            if (customers.results && customers.results.length > 0) {
                customerId = customers.results[0].id?.toString() || '';
            } else {
                // Criar novo customer
                const created = await customer.create({ body: { email: payer.email } });
                customerId = created.id?.toString() || '';
            }

            try {
                if (salvarCartao) {
                    const bodyCard = {
                        token: token
                    }
                    // Criar cartão com o token            
                    const createdCard = await customerCard.create({
                        customerId,
                        body: bodyCard,
                    });

                    // res.status(200).json({
                    //     data: {
                    //         customerId,
                    //         createdCard: createdCard?.id,
                    //         message: 'Cartão salvo com sucesso',
                    //     }
                    // });
                    // console.log('Cartão salvo:', createdCard.id);
                }
            } catch (error) {
                console.error('Erro ao criar cartão:', error);
            }

            let body: any = {
                transaction_amount: transaction_amount,
                token: token,
                description: 'Compra de Ingressos',
                installments: installments,
                payment_method_id: payment_method_id,
                issuer_id: issuer_id,
                payer: {
                    ...payer,
                    first_name: first_name,
                    last_name: last_name,
                },
                metadata: {
                    device_id: deviceId,
                },
                external_reference: idTransacao,
                additional_info: {
                    items: [
                        {
                            id: '2154',
                            title: 'Compra de Ingressos',
                            description: 'Compra de Ingressos',
                            quantity: 1,
                            unit_price: transaction_amount,
                            category_id: 'tickets'
                        }
                    ]
                },
            }

            // Só adiciona application_fee se cobrarTaxa for verdadeiro
            if (evento?.idProdutor === 1) {
                const applicationFee = parseFloat(
                    String(transacao?.taxaServico ?? 0)
                );

                if (applicationFee > 0) {
                    body.application_fee = applicationFee;
                }
            }

            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(),  // Gere uma chave de idempotência única
            };

            const idUsuario = users[0].id

            // res.status(200).json({ data: { teste: 'teste' } })

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Tentativa Pagamento com Cartão Crédito', idUsuario });

            // Realiza o pagamento
            const response = await payment.create({ body, requestOptions });

            if (response.id) {
                // Salvar dados de pagamento
                await TransacaoPagamento.create({
                    idTransacao: idTransacao,
                    PagamentoCodigo: response.id.toString() || '',
                });
            }

            if (response.status === 'approved') {
                await transacaoPaga(idTransacao, 'Pagamento Aprovado com Cartão de Crédito', idUsuario)
            } else {
                await HistoricoTransacao.create({ idTransacao, data, descricao: `Pagamento ${response.status} - ${response.status_detail}`, idUsuario });
            }

            res.status(200).json({
                status: response.status,
                status_detail: response.status_detail,
                id: response.id,
                transaction_details: response.transaction_details,
                payer: response.payer,
                additional_info: response.additional_info,
            });
        } catch (error) {
            console.error(error);
            const err = error as any;
            res.status(500).json({
                error: 'Erro ao processar pagamento',
                details: err.message,
            });
        }
    },

    async pagamentoCardSalvo(req: any, res: any, next: any) {
        const { token, payment_method_id, transaction_amount, installments, payer, items, cvv, deviceId, idTransacao } = req.body

        if (await rejeitarSeReservaHospedagemExpirada(idTransacao, res)) {
            return;
        }

        const users = await Usuario.findAll({
            where: { email: payer.email },
        });

        let empresa = await Empresa.findOne({
            where: { id: 1 },
        });

        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit()
        }

        const transacao = await Transacao.findOne({
            where: { id: idTransacao },
        });

        if (!transacao) {
            return res.status(404).json({ error: 'Transação não encontrada' });
        }

        const evento = await Evento.findOne({
            where: { id: transacao.idEvento },
        });

        const client = new MercadoPagoConfig({ accessToken: evento?.idProdutor === 1 ? (empresa.accessToken ?? "") : TanzAcessToken });
        const tanzMP = new MercadoPagoConfig({ accessToken: TanzAcessToken });

        const payment = new Payment(client)
        const customer = new Customer(tanzMP);
        try {
            // Buscar se cliente já existe
            const customers = await customer.search({ options: { email: payer.email } });

            let customerId: string | null = null;

            if (customers.results && customers.results.length > 0) {
                customerId = customers.results[0].id?.toString() || '';
            } else {
                throw new Error('Customer ID not found');
            }

            // 1. Gerar novo token com card_id + cvv
            const responseToken = await fetch("https://api.mercadopago.com/v1/card_tokens", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${TanzAcessToken}`,
                },
                body: JSON.stringify({
                    card_id: token,
                    security_code: cvv,
                }),
            });

            const tokenData = await responseToken.json();

            if (!tokenData.id) {
                throw new Error("Erro ao gerar token com card_id e CVV: " + JSON.stringify(tokenData));
            }

            let body: any = {
                transaction_amount: parseFloat(transaction_amount),
                token: tokenData.id,
                description: 'Compra de Ingressos',
                installments: installments,
                // payment_method_id: payment_method_id,
                payment_method_id: payment_method_id,
                payer: {
                    type: "customer",
                    id: customerId,
                    // email: payer.email,
                },
                metadata: {
                    device_id: deviceId,
                },
                external_reference: idTransacao,
                additional_info: {
                    items: [
                        {
                            id: '2154',
                            title: 'Compra de Ingressos',
                            description: 'Compra de Ingressos',
                            quantity: 1,
                            unit_price: transaction_amount,
                            category_id: 'tickets'
                        }
                    ]
                },
            }

            // Só adiciona application_fee se cobrarTaxa for verdadeiro
            if (evento?.idProdutor === 1) {
                const applicationFee = parseFloat(
                    String(transacao?.taxaServico ?? 0)
                );

                if (applicationFee > 0) {
                    body.application_fee = applicationFee;
                }
            }

            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(),  // Gere uma chave de idempotência única
            };

            // res.status(200).json({ data: { teste: 'teste' } })

            // Realiza o pagamento
            const response = await payment.create({ body });

            const idUsuario = users[0].id
            const data = new Date(); // Data atual

            if (response.id) {
                // Salvar dados de pagamento
                await TransacaoPagamento.create({
                    idTransacao: idTransacao,
                    PagamentoCodigo: response.id.toString() || '',
                });
            }

            if (response.status === 'approved') {
                await transacaoPaga(idTransacao, 'Pagamento Aprovado com Cartão de Crédito', idUsuario)
            } else {
                await HistoricoTransacao.create({ idTransacao, data, descricao: `Pagamento ${response.status} - ${response.status_detail}`, idUsuario });
            }

            res.status(200).json({
                status: response.status,
                status_detail: response.status_detail,
                id: response.id,
                transaction_details: response.transaction_details,
                payer: response.payer,
                additional_info: response.additional_info,
            });
        } catch (error) {
            console.error('error', error);
            const err = error as any;
            res.status(500).json({
                error: 'Erro ao processar pagamento',
                details: err.message,
            });
        }
    },

    async pagamentoPix(req: any, res: any) {
        try {
            const { valorTotal, descricao, email, idTransacao, deviceId } = req.body;

            if (await rejeitarSeReservaHospedagemExpirada(idTransacao, res)) {
                return;
            }

            let empresa = await Empresa.findOne({
                where: { id: 1 },
            });

            if (!empresa || !empresa.accessToken) {
                empresa = await geraTokenSplit()
            }

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
            });

            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }

            const evento = await Evento.findOne({
                where: { id: transacao.idEvento },
            });

            const client = new MercadoPagoConfig({ accessToken: evento?.idProdutor === 1 ? (empresa.accessToken ?? "") : TanzAcessToken });

            // const client = new MercadoPagoConfig({ accessToken: TanzAcessToken });

            // const client = new MercadoPagoConfig({ accessToken: acessToken });
            const payment = new Payment(client);
            const users = await Usuario.findAll({
                where: { email: email },
            });

            let body: any = {
                transaction_amount: valorTotal,
                payment_method_id: 'pix',
                description: descricao || ' - Pagamento via Pix',
                payer: {
                    email: email,
                    first_name: users[0]?.nomeCompleto,
                    last_name: users[0]?.sobreNome,
                },
                // device_id: deviceId,
                external_reference: idTransacao,
                additional_info: {
                    items: [
                        {
                            id: '2154',
                            title: 'Compra de Ingressos',
                            description: 'Compra de Ingressos',
                            quantity: 1,
                            unit_price: valorTotal,
                            category_id: 'tickets'
                        }
                    ]
                },
            }

            // Só adiciona application_fee se cobrarTaxa for verdadeiro
            if (evento?.idProdutor === 1) {
                const applicationFee = parseFloat(
                    String(transacao?.taxaServico ?? 0)
                );

                if (applicationFee > 0) {
                    body.application_fee = applicationFee;
                }
            }

            const result = await payment.create({ body });

            // Salvar dados de pagamento
            await TransacaoPagamento.create({
                idTransacao: idTransacao,
                PagamentoCodigo: result.id?.toString() || '',
            });

            const idUsuario = users[0].id

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Pagamento via Pix Criado', idUsuario });

            return res.status(200).json({
                id: result.id,
                status: result.status,
                status_detail: result.status_detail,
                point_of_interaction: result.point_of_interaction,
            });
        } catch (error) {
            console.error('Erro ao criar pagamento PIX:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Pix' });
        }
    },

    async buscarParcelas(req: any, res: any, next: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const amount = filters.amount
        const bin = filters.bin
        const payment_method_id = filters.payment_method_id

        try {
            const mpRes = await fetch(
                `https://api.mercadopago.com/v1/payment_methods/installments?amount=${amount}&bin=${bin}&payment_method_id=${payment_method_id}`,
                {
                    headers: {
                        Authorization: `Bearer ${TanzAcessToken}`,
                    },
                }
            );
            const data = await mpRes.json();
            console.log('parcelas', data)
            // const data = await mpRes.json();
            res.status(200).json({ data: data });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao buscar parcelas' });
        }
    },

    async getCardsCustomer(req: any, res: any, next: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const email = filters.email

        const client = new MercadoPagoConfig({
            accessToken: TanzAcessToken,
        });

        const customer = new Customer(client);
        const card = new CustomerCard(client);

        try {
            // 🔍 1. Buscar cliente pelo email
            const customers = await customer.search({ options: { email: email } });
            // console.log('customers', customers)

            if (customers.results?.length === 0) {
                return res.status(200).json({
                    message: 'Cliente não encontrado',
                });
            }

            const customerId = customers.results?.[0]?.id ?? null;
            if (!customerId) {
                return res.status(200).json({
                    message: 'id não encontrado',
                });
            }

            // console.log('customer', customers.results?.[0])
            // console.log('customerId', customerId.toString())
            // return res.status(200).json({ data: customers })

            // 💳 2. Buscar cartões do cliente
            await card.list({ customerId: customerId.toString() }).then(console.log).catch(console.log);
            const cards = await card.list({ customerId: customerId });

            console.log('cards', cards)

            return res.status(200).json({
                data: {
                    customerId,
                    cards: cards.map((c: any) => ({
                        id: c.id,
                        last_four_digits: c.last_four_digits,
                        payment_method: c.payment_method,
                        expiration_month: c.expiration_month,
                        expiration_year: c.expiration_year,
                        cardholder: c.cardholder,
                        first_six_digits: c.first_six_digits,
                    })),
                }

            });
        } catch (error) {
            console.error('Erro ao buscar cartões do cliente:', error);
            res.status(500).json({
                error: 'Erro interno ao buscar os cartões do cliente',
                details: (error as any).message,
            });
        }
    },

    async consultaPagamento(req: any, res: any, next: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const id = filters.id

        try {
            const users = await Usuario.findAll({
                where: { email: filters.email },
            });

            const idUsuario = users[0].id

            const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${TanzAcessToken}`,
                }
            })

            const data = await response.json()

            if (data.status === 'approved') {
                const transacaoPagamento = await TransacaoPagamento.findOne({
                    where: { PagamentoCodigo: id, gatewayPagamento: 'MercadoPago' }
                })

                if (transacaoPagamento) {
                    const idTransacao = transacaoPagamento.idTransacao

                    const transacao = await Transacao.findOne({
                        where: { id: idTransacao },
                    });

                    if (!transacao) {
                        return res.status(404).json({ error: 'Transação não encontrada' });
                    }

                    transacao.valorTaxaProcessamento = data.fee_details
                        ?.find((fee: any) => fee.type === 'mercadopago_fee')?.amount || 0;
                    transacao.valorRecebido = data.transaction_details?.net_received_amount || 0;
                    transacao.idTransacaoRecebidoMP = id;
                    await transacao.save();

                    // Atualiza status da transação
                    await transacaoPaga(idTransacao, 'Pagamento Aprovado', idUsuario)
                }
            }

            res.status(200).json({
                data: {
                    status: data.status,
                    id: data.id,
                    transaction_amount: data.transaction_amount,
                    status_detail: data.status_detail,
                    payment_method_id: data.payment_method_id,
                    date_approved: data.date_approved,
                    date_created: data.date_created,
                    email: filters.email,
                    installments: data.installments,
                }
            })
        } catch (error) {
            console.error('Erro ao consultar pagamento:', error);
            res.status(500).json({
                error: 'Erro ao consultar pagamento',
                details: (error as any).message,
            });
        }
    },

    async getPaymentData(req: any, res: any, next: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};

        console.log('req.body', req.body)
        const idUsuario = filters.idUsuario
        console.log('idUsuario', idUsuario)

        try {
            const paymentData = await UsuarioMetodoPagamento.findAll({
                where: { idUsuario: idUsuario },
            });

            console.log('paymentData', paymentData)

            const decryptedData = paymentData.map((data: any) => {
                return decrypt(data.dados);
            });

            console.log('decryptedData', decryptedData)

            res.status(200).json({
                data: decryptedData,
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: 'Erro ao buscar dados de pagamento',
            });
        }
    },

    async createPreferencePayment(req: any, res: any, next: any) {
        const { transaction_amount, items, payer, idTransacao } = req.body;

        if (await rejeitarSeReservaHospedagemExpirada(idTransacao, res)) {
            return;
        }

        let empresa = await Empresa.findOne({
            where: { id: 1 },
        });

        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit()
        }

        const transacao = await Transacao.findOne({
            where: { id: idTransacao },
        });

        const client = new MercadoPagoConfig({ accessToken: TanzAcessToken });

        try {
            const preference = {
                items: items || [
                    {
                        title: 'Compra de Ingressos',
                        quantity: 1,
                        unit_price: parseFloat(transaction_amount),
                        currency_id: 'BRL',
                        category_id: 'tickets',
                    },
                ],
                payer: {
                    email: payer.email,
                    first_name: payer.first_name || '',
                    last_name: payer.last_name || '',
                    // opcional, outras infos aqui
                },
                back_urls: {
                    success: 'https://www.jangoingressos.com.br/sucesso',
                    failure: 'https://www.jangoingressos.com.br/falha',
                    pending: 'https://www.jangoingressos.com.br/pending',
                },
                auto_return: 'approved',
                external_reference: idTransacao,
                payment_methods: {
                    excluded_payment_methods: [
                        { id: 'ticket' }, // Exemplo: se quiser excluir boleto
                        { id: 'atm' },
                    ],
                    excluded_payment_types: [
                        { id: 'atm' },
                    ],
                    installments: 1, // sem parcelamento para Apple Pay
                },
                application_fee: parseFloat((transacao?.taxaServico ?? "0").toString()) || 0.00,
            };

            console.log('preference', preference)

            const preferenceInstance = new Preference(client);
            const response = await preferenceInstance.create({
                body: preference,
                requestOptions: {
                    idempotencyKey: generateUniqueIdempotencyKey(), // Gere uma chave de idempotência única
                },
            });

            console.log('Preference created:', response);

            res.status(200).json({
                init_point: response.init_point,
                preference_id: response.id,
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Erro ao criar preferência' });
        }
    },

    async estornoPagamento(req: any, res: any, next: any) {
        const { idTransacao, idUsuario } = req.body;

        if (!idTransacao) {
            return res.status(400).json({ error: 'ID da transação é obrigatório' });
        }

        if (!idUsuario) {
            return res.status(400).json({ error: 'ID do usuário é obrigatório' });
        }

        try {
            let empresa = await Empresa.findOne({ where: { id: 1 } });

            if (!empresa || !empresa.accessToken) {
                empresa = await geraTokenSplit();
            }

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
            });

            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }

            const evento = await Evento.findOne({
                where: { id: transacao.idEvento },
            });

            const ingressoTransacao = await IngressoTransacao.findAll({
                where: { idTransacao },
            });

            if (!ingressoTransacao || ingressoTransacao.length === 0) {
                return res
                    .status(404)
                    .json({ error: 'Ingressos da transação não encontrados' });
            }

            // Verifica se todos os ingressos estão com status 'Confirmado'
            const ingressosNaoConfirmados: number[] = [];

            for (const ingresso of ingressoTransacao) {
                const ingressoDetails = await Ingresso.findOne({
                    where: { id: ingresso.idIngresso },
                });

                if (ingressoDetails && ingressoDetails.status !== 'Confirmado') {
                    ingressosNaoConfirmados.push(ingresso.idIngresso);
                }
            }

            if (ingressosNaoConfirmados.length > 0) {
                return res.status(400).json({
                    error: `Ingresso utilizado ou não confirmado: ${ingressosNaoConfirmados.join(', ')}`,
                });
            }

            const client = new MercadoPagoConfig({
                accessToken: evento?.idProdutor === 1 ? (empresa.accessToken ?? "") : TanzAcessToken,
            });

            const paymentRefund = new PaymentRefund(client);

            console.log('Transação PagamentoCodigo:', transacao.idTransacaoRecebidoMP);

            if (!transacao.idTransacaoRecebidoMP) {
                return res.status(400).json({ error: 'ID da transação de pagamento não encontrado' });
            }

            const response = await paymentRefund.create({
                payment_id: transacao.idTransacaoRecebidoMP,
            });

            console.log('response', response)

            await transacaoCancelada(
                idTransacao,
                'Estorno realizado com sucesso id:' + response.id,
                idUsuario
            );

            console.log('Estorno realizado:', response);

            return res.status(200).json({
                status: response.status,
                id: response.id,
            });
        } catch (error) {
            console.error('Erro ao realizar estorno:', error);
            return res.status(500).json({ error: 'Erro ao realizar estorno' });
        }
    },

    async webHookMercadoPago(req: any, res: any) {
        const { type, data } = req.body;
        console.log('type', type)
        console.log('data', data)

        console.log('WebHook Mercado Pago recebido:', req.body);

        if (type === 'payment') {
            const paymentId = data.id;

            try {
                // let empresa = await Empresa.findOne({
                //     where: { id: 1 },
                // });

                // if (!empresa || !empresa.accessToken) {
                //     console.log('Empresa não encontrada ou accessToken não definido');
                //     return res.status(404).json({ error: 'Empresa não encontrada ou accessToken não definido' });
                // }

                const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${TanzAcessToken}`,
                    }
                })

                const data = await response.json()
                console.log('Dados do pagamento:', data);

                if (data.status === 'approved') {
                    const transacaoPagamento = await TransacaoPagamento.findOne({
                        where: { PagamentoCodigo: paymentId, gatewayPagamento: 'MercadoPago' }
                    })

                    if (transacaoPagamento) {
                        const idTransacao = transacaoPagamento.idTransacao

                        const transacao = await Transacao.findOne({
                            where: { id: idTransacao },
                        });

                        if (!transacao) {
                            return res.status(404).json({ error: 'Transação não encontrada' });
                        }

                        transacao.valorTaxaProcessamento = data.fee_details
                            ?.find((fee: any) => fee.type === 'mercadopago_fee')?.amount || 0;
                        transacao.valorRecebido = data.transaction_details?.net_received_amount || 0;
                        transacao.idTransacaoRecebidoMP = paymentId;
                        await transacao.save();

                        if (transacao.status != 'Pago') {
                            await transacaoPaga(idTransacao, 'Pagamento Realizado e enviado por WebHook', transacao.idUsuario)
                        }
                    }
                }

                res.status(200).json({ message: 'Webhook processado com sucesso' });
            } catch (error) {
                console.error('Erro ao processar webhook:', error);
                res.status(500).json({ error: 'Erro ao processar webhook' });
            }
        } else {
            res.status(400).json({ error: 'Tipo de webhook não suportado' });
        }
    },

    async pagamentoPos(req: any, res: any) {
        try {
            const { valorTotal, descricao, email, idTransacao, transaction_type, idUsuarioPDV } = req.body;

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
            });

            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }

            const usuario = await ProdutorAcesso.findOne({
                where: { idUsuario: idUsuarioPDV, tipoAcesso: TipoAcesso.PDV },
            });

            if (!usuario) {
                return res.status(404).json({ error: 'ProdutorAcesso não encontrado' });
            }

            const posData = JSON.stringify({
                "cliente_chave": usuario.cliente_chavePOS,
                "pos_id": usuario.pos_id,
                "transaction_type": transaction_type,
                "installment_count": 1,
                "amount": Number(valorTotal),
                "order_id": transacao.id.toString(),
                "description": "Pagamento de Ingresso",
                "installment_type": 1
            });

            var config = {
                method: 'post',
                url: 'https://api.supertef.com.br/api/pagamentos',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SuperTefBearerToken}`
                },
                data: posData
            };

            // 🔹 Chamada da API SuperTEF
            const response = await axios(config);
            const result = response.data;

            // Salvar dados de pagamento
            await TransacaoPagamento.create({
                idTransacao: idTransacao,
                PagamentoCodigo: result.payment_uniqueid?.toString() || '',
                gatewayPagamento: 'TEF Stone',
                valor: Number(valorTotal)
            });

            transacao.tipoPagamento = transaction_type === 1 ? TipoPagamento.Debito : transaction_type === 2 ? TipoPagamento.Credito : TipoPagamento.Pix;
            await transacao.save();

            const idUsuario = transacao.idUsuario;

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Pagamento via Pos Criado: ' + result.payment_uniqueid, idUsuario });

            return res.status(200).json({
                id: result.payment_uniqueid,
                status: 'pending', // O status pode ser 'pending' ou outro dependendo da resposta da API
                // status_detail: result.status_detail,
                // point_of_interaction: result.point_of_interaction,
            });
        } catch (error) {
            console.error('Erro ao criar pagamento PIX:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Pix' });
        }
    },

    async consultaPagamentoPos(req: any, res: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const payment_uniqueid = filters.payment_uniqueid
        let statusTransacao = 'Pendente'

        if (payment_uniqueid) {
            try {
                var config = {
                    method: 'get',
                    url: `https://api.supertef.com.br/api/pagamentos/by-uniqueid/${payment_uniqueid}?payment_uniqueid`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SuperTefBearerToken}`
                    },
                };

                const response = await axios(config);
                const data = response.data;

                // const data = await response.json()
                console.log('Dados do pagamento:', data);

                if (data.payment_status === 4) {
                    const transacaoPagamento = await TransacaoPagamento.findOne({
                        where: { PagamentoCodigo: payment_uniqueid, gatewayPagamento: 'TEF Stone' }
                    })

                    // if (transacaoPagamento && transacaoPagamento.statusPagamento === "Pago") {
                    //     return res.status(200).json({
                    //         data: {
                    //             ...data, payment_message: 'Parcial',
                    //         }
                    //     });
                    // }

                    if (transacaoPagamento) {
                        const idTransacao = transacaoPagamento.idTransacao

                        transacaoPagamento.statusPagamento = "Pago"; // Pago
                        await transacaoPagamento.save();

                        const transacao = await Transacao.findOne({
                            where: { id: idTransacao },
                        });

                        if (!transacao) {
                            return res.status(404).json({ error: 'Transação POS não encontrada' });
                        }

                        transacao.valorTaxaProcessamento = 0;
                        transacao.valorRecebido = Number(transacao.valorRecebido ?? 0) + Number(transacaoPagamento.valor ?? 0);
                        transacao.idTransacaoRecebidoMP = payment_uniqueid;
                        transacao.gatewayPagamento = 'TEF Stone';
                        await transacao.save();

                        if (transacao.status != 'Pago') {
                            const evento = await Evento.findOne({
                                where: { id: transacao.idEvento },
                            });

                            if (evento?.idProdutor === 1) {
                                const caixa = await apiJango().getCaixa();

                                if (caixa[0]) {
                                    if (!transacaoPagamento.idCaixaItem) {
                                        const identificadorCaixa =
                                            transacaoPagamento.PagamentoCodigo ||
                                            payment_uniqueid ||
                                            transacaoPagamento.id;
                                        const idCaixaItem = await apiJango().inseriCaixaItem(
                                            caixa[0].id_caixa,
                                            transacaoPagamento.valor ?? 0,
                                            transacao.tipoPagamento === TipoPagamento.Debito
                                                ? 40
                                                : transacao.tipoPagamento === TipoPagamento.Credito
                                                  ? 39
                                                  : 42,
                                            identificadorCaixa
                                        );
                                        await transacaoPagamento.update({
                                            idCaixaItem,
                                        });
                                    }
                                }
                            }

                            statusTransacao = await transacaoPaga(idTransacao, 'Pagamento Realizado via POS', transacao.idUsuario, false) === true ? 'Pago' : 'Parcial';
                            // statusTransacao = 'Parcial';
                        }

                        // transacao.reload();
                    }
                }

                res.status(200).json({
                    data: {
                        ...data, payment_message: statusTransacao != 'Pendente' ? statusTransacao : data.payment_message,
                    }
                });
            } catch (error) {
                console.error('Erro ao processar POS:', error);
                res.status(500).json({ error: 'Erro ao processar POS' });
            }
        } else {
            res.status(400).json({ error: 'Tipo de POS não suportado' });
        }
    },

    async pagamentoDinheiro(req: any, res: any) {
        try {
            const { idTransacao, idUsuarioPDV, valorTotal } = req.body;

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
            });

            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }

            const evento = await Evento.findOne({
                where: { id: transacao.idEvento },
            });

            const usuario = await ProdutorAcesso.findOne({
                where: { idUsuario: idUsuarioPDV, tipoAcesso: TipoAcesso.PDV },
            });

            if (!usuario) {
                return res.status(404).json({ error: 'ProdutorAcesso não encontrado' });
            }

            // Salvar dados de pagamento
            const transacaoPagamento = await TransacaoPagamento.create({
                idTransacao: idTransacao,
                PagamentoCodigo: '',
                gatewayPagamento: 'Portaria',
                valor: valorTotal,
                statusPagamento: 'Pago',
            });

            if (evento?.idProdutor === 1) {
                const caixa = await apiJango().getCaixa();

                if (caixa[0]) {
                    const idCaixaItem = await apiJango().inseriCaixaItem(
                        caixa[0].id_caixa,
                        Number(valorTotal ?? 0),
                        38,
                        transacaoPagamento.id
                    );
                    await transacaoPagamento.update({
                        idCaixaItem,
                    });
                }
            }

            transacao.tipoPagamento = TipoPagamento.Dinheiro;
            transacao.valorTaxaProcessamento = 0;
            transacao.valorRecebido = Number(transacao.valorRecebido ?? 0) + Number(valorTotal ?? 0);
            transacao.gatewayPagamento = 'Portaria';
            await transacao.save();

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Pagamento Criado em Dinheiro na Portaria', idUsuario: idUsuarioPDV });

            if (transacao.status != 'Pago') {
                await transacaoPaga(idTransacao, 'Pagamento Dinheiro na Portaria', transacao.idUsuario, false)
            }

            // transacao.reload();

            return res.status(200).json({
                data: {
                    payment_uniqueid: 0,
                    payment_status: 4,
                    payment_message: (transacao.valorRecebido ?? 0) < transacao.valorTotal ? 'Parcial' : 'Pagamento realizado em Dinheiro',
                    created_at: new Date().toISOString(),
                }
            });
        } catch (error) {
            console.error('Erro ao criar pagamento dinheiro:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Dinheiro' });
        }
    },

    async cancelaPagamentoPos(req: any, res: any) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const payment_uniqueid = filters.payment_uniqueid
        console.log('cancelamento payment_uniqueid', payment_uniqueid)

        if (payment_uniqueid) {
            try {
                var config = {
                    method: 'put',
                    url: `https://api.supertef.com.br/api/pagamentos/cancelar/${payment_uniqueid}`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SuperTefBearerToken}`
                    },
                };

                const response = await axios(config);
                const data = response.data;
                console.log('Dados do cancelamento:', data);

                res.status(200).json({
                    data: data
                });
            } catch (error) {
                console.error('Erro ao processar POS:', error);
                res.status(500).json({ error: 'Erro ao processar POS' });
            }
        } else {
            res.status(400).json({ error: 'Tipo de POS não suportado' });
        }
    },

    async webHookPagamentoPos(req: any, res: any) {
        const { data } = req.body;
        const payment_uniqueid = data.payment_uniqueid

        if (payment_uniqueid) {
            try {

                if (data.payment_status === 4) {
                    const transacaoPagamento = await TransacaoPagamento.findOne({
                        where: { PagamentoCodigo: payment_uniqueid, gatewayPagamento: 'TEF Stone' }
                    })

                    if (transacaoPagamento) {
                        const idTransacao = transacaoPagamento.idTransacao

                        const transacao = await Transacao.findOne({
                            where: { id: idTransacao },
                        });

                        if (!transacao) {
                            return res.status(404).json({ error: 'Transação POS não encontrada' });
                        }

                        transacao.valorTaxaProcessamento = 0;
                        transacao.valorRecebido = transacao.valorTotal;
                        transacao.idTransacaoRecebidoMP = payment_uniqueid;
                        transacao.gatewayPagamento = 'TEF Stone';
                        await transacao.save();

                        if (transacao.status != 'Pago') {
                            await transacaoPaga(idTransacao, 'Pagamento Realizado via POS', transacao.idUsuario, false)
                        }
                    }
                }

                res.status(200).json({
                    data: data
                });
            } catch (error) {
                console.error('Erro ao processar POS:', error);
                res.status(500).json({ error: 'Erro ao processar POS' });
            }
        } else {
            res.status(400).json({ error: 'Tipo de POS não suportado' });
        }
    },

    async pagamentoPOSStone(req: any, res: any) {
        try {
            const { idTransacao, idUsuarioPDV, tipoPagamento } = req.body;

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
            });

            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }

            transacao.tipoPagamento = tipoPagamento;
            transacao.valorTaxaProcessamento = 0;
            transacao.valorRecebido = transacao.valorTotal;
            transacao.gatewayPagamento = 'POS Stone';

            const evento = await Evento.findOne({
                where: { id: transacao.idEvento },
            });

            let idCaixaItem: number | undefined;

            if (evento?.idProdutor === 1) {
                const caixa = await apiJango().getCaixa();

                if (caixa[0]) {
                    idCaixaItem = await apiJango().inseriCaixaItem(
                        caixa[0].id_caixa,
                        transacao.valorTotal,
                        transacao.tipoPagamento === TipoPagamento.Debito ? 40 :
                            transacao.tipoPagamento === TipoPagamento.Credito ? 39 :
                                transacao.tipoPagamento === TipoPagamento.Dinheiro ? 38 : 42,
                        idTransacao
                    );
                }
            }

            const usuario = await ProdutorAcesso.findOne({
                where: { idUsuario: idUsuarioPDV, tipoAcesso: TipoAcesso.PDV },
            });

            if (!usuario) {
                return res.status(404).json({ error: 'ProdutorAcesso não encontrado' });
            }

            // Salvar dados de pagamento
            const transacaoPagamento = await TransacaoPagamento.create({
                idTransacao: idTransacao,
                PagamentoCodigo: '',
                gatewayPagamento: 'POS Stone'
            });

            if (idCaixaItem != null) {
                await transacaoPagamento.update({
                    idCaixaItem,
                });
            }

            await transacao.save();

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Pagamento Criado em Dinheiro na Portaria', idUsuario: idUsuarioPDV });

            if (transacao.status != 'Pago') {
                await transacaoPaga(idTransacao, 'Pagamento POS Terminal Stone', transacao.idUsuario, false)
            }

            return res.status(200).json({
                data: {
                    payment_uniqueid: 0,
                    payment_status: 4,
                    payment_message: 'Pagamento POS Terminal Stone',
                    created_at: new Date().toISOString(),
                }
            });
        } catch (error) {
            console.error('Erro ao criar pagamento dinheiro:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Dinheiro' });
        }
    },

    /**
     * Apenas dispara o mesmo fluxo pós-pagamento real (`transacaoPaga`).
     * Sem lógica paralela de confirmação/hospedagem/notificação.
     */
    async aprovarPagamentoDev(req: any, res: any) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(404).json({ message: 'Rota não disponível.' });
        }

        try {
            console.log('Iniciando simulação');

            const idTransacao = Number(req.body?.idTransacao);
            if (!idTransacao) {
                throw new CustomError('idTransacao é obrigatório.', 400, '');
            }

            const transacao = await Transacao.findByPk(idTransacao);
            if (!transacao) {
                throw new CustomError('Transação não encontrada.', 404, '');
            }

            if (transacao.status === 'Pago') {
                return res.status(200).json({
                    data: {
                        idTransacao,
                        status: 'Pago',
                        message: 'Transação já estava paga.',
                    },
                });
            }

            // Mesmo método chamado após pagamento real (MP, PIX, cartão, POS, etc.)
            const aprovado = await transacaoPaga(
                idTransacao,
                'Pagamento simulado (DEV)',
                transacao.idUsuario
            );

            if (!aprovado) {
                throw new CustomError(
                    'Não foi possível aprovar a transação.',
                    400,
                    ''
                );
            }

            console.log('Simulação concluída');

            return res.status(200).json({
                data: {
                    idTransacao,
                    status: 'Pago',
                },
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    status: 'fail',
                    message: error.message,
                });
            }

            console.error('Erro ao simular pagamento (DEV):', error);
            return res.status(500).json({
                status: 'fail',
                message: 'Erro ao simular pagamento.',
            });
        }
    },

    /**
     * Exclusivo do fluxo Pagamento PDV.
     * Reduz a quantidade de ingressos da própria transação (não cria nova),
     * removendo apenas a diferença em IngressoTransacao e recalculando totais.
     */
    async ajustarQuantidadePdv(req: any, res: any, next: any) {
        const transaction = await connection.transaction();

        try {
            const { idTransacao, idUsuarioPDV, itens } = req.body as {
                idTransacao?: number;
                idUsuarioPDV?: number;
                itens?: Array<{
                    idsIngressoTransacao: number[];
                    quantidade: number;
                }>;
            };

            if (!idTransacao || !idUsuarioPDV) {
                throw new CustomError(
                    'idTransacao e idUsuarioPDV são obrigatórios.',
                    400,
                    ''
                );
            }

            if (!Array.isArray(itens) || itens.length === 0) {
                throw new CustomError(
                    'Informe os itens a ajustar.',
                    400,
                    ''
                );
            }

            const usuarioPdv = await ProdutorAcesso.findOne({
                where: { idUsuario: idUsuarioPDV, tipoAcesso: TipoAcesso.PDV },
            });

            if (!usuarioPdv) {
                throw new CustomError(
                    'Acesso PDV não encontrado para o usuário.',
                    403,
                    ''
                );
            }

            const transacao = await Transacao.findOne({
                where: { id: idTransacao },
                transaction,
            });

            if (!transacao) {
                throw new CustomError('Transação não encontrada.', 404, '');
            }

            if (transacao.status === 'Pago' || transacao.status === 'Cancelado') {
                throw new CustomError(
                    'Não é possível ajustar quantidade de uma transação finalizada.',
                    400,
                    ''
                );
            }

            const idsRemovidos: number[] = [];
            let totalRemovidos = 0;

            for (const item of itens) {
                const ids = Array.isArray(item.idsIngressoTransacao)
                    ? item.idsIngressoTransacao.map(Number).filter((id) => Number.isFinite(id) && id > 0)
                    : [];
                const quantidade = Number(item.quantidade);

                if (ids.length === 0) {
                    throw new CustomError(
                        'Cada item deve informar idsIngressoTransacao.',
                        400,
                        ''
                    );
                }

                if (!Number.isFinite(quantidade) || quantidade < 1) {
                    throw new CustomError(
                        'A quantidade mínima por tipo de ingresso é 1.',
                        400,
                        ''
                    );
                }

                if (quantidade > ids.length) {
                    throw new CustomError(
                        'Não é permitido aumentar a quantidade no pagamento PDV.',
                        400,
                        ''
                    );
                }

                if (quantidade === ids.length) {
                    continue;
                }

                const registrosGrupo = await IngressoTransacao.findAll({
                    where: {
                        idTransacao,
                        id: ids,
                    },
                    transaction,
                });

                if (registrosGrupo.length !== ids.length) {
                    throw new CustomError(
                        'Itens da transação inválidos ou não pertencem a esta transação.',
                        400,
                        ''
                    );
                }

                const idsParaRemover = ids.slice(quantidade);
                const removidos = registrosGrupo.filter((reg) =>
                    idsParaRemover.includes(reg.id)
                );

                for (const reg of removidos) {
                    await HistoricoIngresso.create(
                        {
                            idIngresso: reg.idIngresso,
                            data: new Date(),
                            descricao:
                                'Cancelado - quantidade reduzida no Pagamento PDV',
                            idUsuario: idUsuarioPDV,
                        },
                        { transaction }
                    );

                    await Ingresso.update(
                        { status: 'Cancelado' },
                        { where: { id: reg.idIngresso }, transaction }
                    );

                    await reg.destroy({ transaction });
                    idsRemovidos.push(reg.id);
                    totalRemovidos += 1;
                }
            }

            const ingressosRestantes = await IngressoTransacao.findAll({
                where: { idTransacao },
                transaction,
            });

            if (ingressosRestantes.length === 0) {
                throw new CustomError(
                    'A transação deve manter ao menos 1 ingresso.',
                    400,
                    ''
                );
            }

            const preco = ingressosRestantes.reduce(
                (acc, ingresso) => acc + Number(ingresso.preco || 0),
                0
            );
            const taxaServico = ingressosRestantes.reduce(
                (acc, ingresso) => acc + Number(ingresso.taxaServico || 0),
                0
            );
            const taxaServicoDesconto = ingressosRestantes.reduce(
                (acc, ingresso) =>
                    acc + Number(ingresso.taxaServicoDesconto || 0),
                0
            );
            const valorTotal = ingressosRestantes.reduce(
                (acc, ingresso) => acc + Number(ingresso.valorTotal || 0),
                0
            );

            await Transacao.update(
                {
                    preco,
                    taxaServico,
                    taxaServicoDesconto,
                    valorTotal,
                },
                { where: { id: idTransacao }, transaction }
            );

            await HistoricoTransacao.create(
                {
                    idTransacao,
                    data: new Date(),
                    descricao:
                        totalRemovidos > 0
                            ? `Quantidade reduzida no Pagamento PDV (${totalRemovidos} ingresso(s) removido(s)). Totais atualizados.`
                            : 'Ajuste de quantidade no Pagamento PDV sem remoções.',
                    idUsuario: idUsuarioPDV,
                },
                { transaction }
            );

            await transaction.commit();

            let transacaoAtualizada = await Transacao.findOne({
                where: { id: idTransacao },
            });

            // Se o novo total ficou coberto pelo valor já recebido, quita a venda no PDV
            // sem exigir novo pagamento (mesmo critério de pagamento parcial existente).
            const valorRecebido = Number(transacaoAtualizada?.valorRecebido ?? 0);
            let vendaQuitada = false;

            if (
                transacaoAtualizada &&
                transacaoAtualizada.status !== 'Pago' &&
                Math.round(valorRecebido * 100) >= Math.round(Number(valorTotal) * 100)
            ) {
                await transacaoPaga(
                    idTransacao,
                    'Venda quitada no Pagamento PDV após redução de quantidade',
                    idUsuarioPDV,
                    false
                );
                transacaoAtualizada = await Transacao.findOne({
                    where: { id: idTransacao },
                });
                vendaQuitada = transacaoAtualizada?.status === 'Pago';
            }

            return res.status(200).json({
                data: {
                    transacao: transacaoAtualizada,
                    idsIngressoTransacaoRemovidos: idsRemovidos,
                    preco,
                    taxaServico,
                    taxaServicoDesconto,
                    valorTotal,
                    vendaQuitada,
                },
            });
        } catch (error) {
            try {
                await transaction.rollback();
            } catch {
                // Transação já commitada ou inexistente
            }
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    status: 'fail',
                    message: error.message,
                });
            }
            console.error('Erro ao ajustar quantidade PDV:', error);
            next(error);
        }
    },

    /**
     * Exclusivo Pagamento PDV: abre conta no Jango após pagamento (evento 1).
     * Idempotente por idTransacao — nunca cria duas contas para a mesma venda.
     */
    async abrirContaPdv(req: any, res: any, next: any) {
        const { idTransacao, idUsuarioPDV } = req.body as {
            idTransacao?: number;
            idUsuarioPDV?: number;
        };

        const idTrx = Number(idTransacao);
        const idUser = Number(idUsuarioPDV);

        if (!idTrx || !idUser) {
            return res.status(400).json({
                status: "fail",
                message: "idTransacao e idUsuarioPDV são obrigatórios.",
            });
        }

        // Lock síncrono antes de qualquer await — evita duas execuções no mesmo processo
        let execucao = locksAbrirContaPdv.get(idTrx);
        if (!execucao) {
            execucao = (async () => {
            const idPagamento = await obterIdPagamentoPdv(idTrx);
            console.log("[PDV abrirConta] início", {
                idTransacao: idTrx,
                idPagamento,
                idUsuarioPDV: idUser,
            });

            try {
                const marca = `${MARCA_CONTA_JANGO_PDV}${idTrx}`;

                const usuarioPdv = await ProdutorAcesso.findOne({
                    where: { idUsuario: idUser, tipoAcesso: TipoAcesso.PDV },
                });
                if (!usuarioPdv) {
                    throw new CustomError("Acesso PDV não encontrado para o usuário.", 403, "");
                }

                let claim = await reivindicarAberturaContaPdv(
                    idTrx,
                    idUser,
                    marca,
                    idPagamento
                );

                if (claim.jaFinalizado && claim.historico) {
                    console.log("[PDV abrirConta] conta já registrada — reutilizando", {
                        idTransacao: idTrx,
                        idPagamento,
                        historico: claim.historico.descricao,
                        motivo: "reexecução / histórico finalizado",
                    });
                    return {
                        reutilizada: true,
                        idTransacao: idTrx,
                        idPagamento,
                        descricao: claim.historico.descricao,
                        message: "Conta Jango já aberta para esta venda PDV.",
                    };
                }

                // Outra execução já possui o claim — aguarda; só retoma se órfão
                if (!claim.adquirido) {
                    console.log("[PDV abrirConta] claim de outra execução — aguardando", {
                        idTransacao: idTrx,
                        idPagamento,
                        motivo: "execução concorrente / timeout / reenvio",
                    });
                    const histFinal = await aguardarFinalizacaoHistoricoPdv(idTrx, marca);
                    if (histFinal && historicoContaPdvFinalizado(histFinal.descricao)) {
                        return {
                            reutilizada: true,
                            idTransacao: idTrx,
                            idPagamento,
                            descricao: histFinal.descricao,
                            message: "Conta Jango já aberta para esta venda PDV.",
                        };
                    }

                    const retomada = await retomarClaimOrfaoPdv(
                        idTrx,
                        idUser,
                        marca,
                        idPagamento
                    );
                    if (retomada.jaFinalizado && retomada.historico) {
                        return {
                            reutilizada: true,
                            idTransacao: idTrx,
                            idPagamento,
                            descricao: retomada.historico.descricao,
                            message: "Conta Jango já aberta para esta venda PDV.",
                        };
                    }
                    if (!retomada.adquirido) {
                        throw new CustomError(
                            "Abertura de conta já em andamento para esta venda. Aguarde e tente novamente.",
                            409,
                            ""
                        );
                    }
                    claim.historico = retomada.historico;
                    claim.adquirido = true;
                }

                const itens = await IngressoTransacao.findAll({
                    where: { idTransacao: idTrx },
                });
                if (itens.length === 0) {
                    throw new CustomError("Nenhum ingresso vinculado à transação.", 400, "");
                }

                const idsIngressos = itens.map((i) => i.idIngresso);
                const ingressosExistentes = await Ingresso.findAll({
                    where: { id: idsIngressos },
                });

                const todosUtilizados =
                    ingressosExistentes.length === idsIngressos.length &&
                    ingressosExistentes.every((ing) => ing.status === "Utilizado");

                if (todosUtilizados) {
                    const desc = `${marca}|reutilizada|ingressos-ja-utilizados|pag=${idPagamento ?? "n/a"}`;
                    if (claim.historico) {
                        claim.historico.descricao = desc;
                        await claim.historico.save();
                    } else {
                        await HistoricoTransacao.create({
                            idTransacao: idTrx,
                            idUsuario: idUser,
                            data: new Date(),
                            descricao: desc,
                        });
                    }
                    console.log("[PDV abrirConta] ingressos já utilizados — sem nova conta", {
                        idTransacao: idTrx,
                        idPagamento,
                    });
                    return {
                        reutilizada: true,
                        idTransacao: idTrx,
                        idPagamento,
                        message: "Ingressos já utilizados; conta não recriada.",
                    };
                }

                const pendentes = ingressosExistentes.filter(
                    (ing) => ing.status === "Confirmado"
                );
                if (pendentes.length === 0) {
                    throw new CustomError(
                        "Nenhum ingresso Confirmado disponível para abrir conta.",
                        400,
                        ""
                    );
                }

                const userValidador = await Usuario.findByPk(idUser);
                if (!userValidador) {
                    throw new CustomError("Usuário PDV não encontrado.", 404, "");
                }

                const userIngresso = await Usuario.findByPk(pendentes[0].idUsuario);
                if (!userIngresso) {
                    throw new CustomError("Usuário do ingresso não encontrado.", 404, "");
                }

                if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                    if (!userIngresso.cpf) {
                        throw new CustomError(
                            "CPF do usuário do ingresso não encontrado.",
                            400,
                            ""
                        );
                    }
                    const dadosJango = await apiJango().getCliente(userIngresso.cpf.toString());
                    let clienteJango = dadosJango[0];
                    if (!clienteJango) {
                        await apiJango().atualizarCliente({
                            CPF_CNPJ: (userIngresso.cpf ?? "").replace(/\D/g, ""),
                            NOME: userIngresso.nomeCompleto,
                            TELEFONE_CELULAR: (userIngresso.telefone ?? "").replace(/\D/g, ""),
                            EMAIL: userIngresso.email,
                        });
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        const dadosNovos = await apiJango().getCliente(
                            (userIngresso.cpf ?? "").replace(/\D/g, "")
                        );
                        clienteJango = dadosNovos[0];
                    }
                    if (clienteJango?.error) {
                        throw new CustomError(clienteJango.error, 400, "");
                    }
                    if (!clienteJango?.id_cliente || Number(clienteJango.id_cliente) === 0) {
                        throw new CustomError("Cliente Jango retornou ID inválido.", 400, "");
                    }
                    userIngresso.id_cliente = clienteJango.id_cliente;
                    await userIngresso.save();
                    await userIngresso.reload();
                }

                if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                    throw new CustomError(
                        "Usuário não possui um id_cliente válido no Jango.",
                        400,
                        ""
                    );
                }

                let idVendaJango: number;
                const contaJango = await apiJango().getConta(userIngresso.id_cliente, true);
                let contaCriadaAgora = false;

                // Só abre conta se NÃO houver conta aberta E esta execução adquiriu o claim
                // (ou retomou claim órfão). Nunca chama abreConta se já existe conta.
                if (!Array.isArray(contaJango) || contaJango.length === 0) {
                    console.log("[PDV abrirConta] tentativa de criação de conta", {
                        idTransacao: idTrx,
                        idPagamento,
                        id_cliente: userIngresso.id_cliente,
                    });
                    idVendaJango = await apiJango().abreConta(userIngresso.id_cliente);
                    contaCriadaAgora = true;
                } else {
                    console.log("[PDV abrirConta] reutilizando conta já aberta", {
                        idTransacao: idTrx,
                        idPagamento,
                        id_venda: contaJango[0]?.id_venda,
                        motivo: "cliente já tinha conta aberta / execução anterior",
                    });
                    idVendaJango = Number(contaJango[0].id_venda);
                }

                if (!Number.isFinite(idVendaJango) || idVendaJango <= 0) {
                    throw new CustomError("Não foi possível obter a conta Jango.", 500, "");
                }

                for (const ingresso of pendentes) {
                    const eventoIngresso = await EventoIngresso.findByPk(
                        ingresso.idEventoIngresso
                    );
                    await apiJango().inseriIngresso(
                        ingresso.id,
                        eventoIngresso?.nome ?? "",
                        userIngresso.id_cliente,
                        Number(idVendaJango)
                    );
                    await HistoricoIngresso.create({
                        idIngresso: ingresso.id,
                        idUsuario: idUser,
                        data: new Date(),
                        descricao: "Ingresso Inserido no Sistema do Jango (Pagamento PDV)",
                    });
                }

                const dataUtilizado = new Date();
                for (const ingresso of pendentes) {
                    ingresso.status = "Utilizado";
                    ingresso.dataUtilizado = dataUtilizado;
                    await ingresso.save();
                    await HistoricoIngresso.create({
                        idIngresso: ingresso.id,
                        idUsuario: idUser,
                        data: dataUtilizado,
                        descricao:
                            "Ingresso Utilizado " +
                            formatInTimeZone(
                                dataUtilizado,
                                "America/Cuiaba",
                                "dd/MM/yyyy HH:mm"
                            ) +
                            " validado por " +
                            userValidador.nomeCompleto +
                            " (Pagamento PDV)",
                    });
                }

                const descricaoHistorico = `${marca}|venda=${idVendaJango}|${
                    contaCriadaAgora ? "criada" : "reutilizada"
                }|pag=${idPagamento ?? "n/a"}|ok`;

                if (claim.historico) {
                    claim.historico.descricao = descricaoHistorico;
                    await claim.historico.save();
                } else {
                    await HistoricoTransacao.create({
                        idTransacao: idTrx,
                        idUsuario: idUser,
                        data: new Date(),
                        descricao: descricaoHistorico,
                    });
                }

                console.log("[PDV abrirConta] sucesso", {
                    idTransacao: idTrx,
                    idPagamento,
                    id_venda: idVendaJango,
                    contaCriadaAgora,
                    reutilizada: !contaCriadaAgora,
                    ingressos: pendentes.length,
                });

                return {
                    reutilizada: !contaCriadaAgora,
                    idTransacao: idTrx,
                    idPagamento,
                    idVendaJango,
                    message: contaCriadaAgora
                        ? "Conta aberta e ingressos utilizados com sucesso!"
                        : "Conta reutilizada e ingressos utilizados com sucesso!",
                };
            } finally {
                locksAbrirContaPdv.delete(idTrx);
            }
            })();
            locksAbrirContaPdv.set(idTrx, execucao);
        } else {
            console.log("[PDV abrirConta] aguardando execução em andamento", {
                idTransacao: idTrx,
                motivo: "lock em memória / execução simultânea",
            });
        }

        try {
            const resultado = await execucao;
            return res.status(200).json({ data: resultado });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    status: "fail",
                    message: error.message,
                });
            }
            console.error("[PDV abrirConta] erro:", error);
            next(error);
        }
    },
}
