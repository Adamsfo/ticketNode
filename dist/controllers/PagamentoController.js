"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const customError_1 = require("../utils/customError");
const mercadopago_1 = require("mercadopago");
const axios = require('axios');
const encryption_1 = require("../utils/encryption"); // Supondo que você tenha funções de criptografia
const ClienteMetodoPagamento_1 = require("../models/ClienteMetodoPagamento");
const Transacao_1 = require("../models/Transacao");
const Usuario_1 = require("../models/Usuario");
const Ingresso_1 = require("../models/Ingresso");
const database_1 = __importDefault(require("../database"));
const Empresa_1 = require("../models/Empresa");
const ClienteID = "8085308516889383";
const ClienteSecret = "OFA6rEsej17acU0oIQM87PMwG4x4h123";
const TanzAcessToken = "APP_USR-8085308516889383-061214-28451d6dd008b6342b99c07fdbd960a4-2470516573";
// const JangoAcessToken = "APP_USR-2517899600225439-032009-f1127f8e355bf2605cc6e80250129500-488781000"
// const acessToken = "TEST-8085308516889383-061214-c136514f031f9c06faac9ce69be226ce-2470516573"
// const MP_PUBLIC_KEY = "APP_USR-8ccbd791-ea60-4e70-a915-a89fd05f5c23"; // Chave pública do Mercado Pago
// const MP_PUBLIC_KEY = "TEST-98f4cccd-2514-4062-a671-68df4b579410"; // Chave pública do Mercado Pago
// Função para gerar uma chave de idempotência única
function generateUniqueIdempotencyKey() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
// Função para salvar dados de pagamento
async function savePaymentData(paymentResponse, payer, idUsuario, token) {
    const encryptedData = (0, encryption_1.encrypt)(JSON.stringify({
        payment_method_id: paymentResponse.payment_method_id,
        issuer_id: paymentResponse.issuer_id,
        card: paymentResponse.card,
        payer: payer,
        token: token,
    }));
    // Supondo que você tenha um modelo de banco de dados PaymentData
    await ClienteMetodoPagamento_1.UsuarioMetodoPagamento.create({
        idUsuario: idUsuario,
        dados: encryptedData,
    });
}
async function transacaoPaga(idTransacao, descricao, idUsuario) {
    const transaction = await database_1.default.transaction(); // substitua pela instância correta do Sequelize
    try {
        // Atualiza status da transação
        await Transacao_1.Transacao.update({ status: 'Pago' }, { where: { id: idTransacao }, transaction });
        // Cria histórico da transação
        await Transacao_1.HistoricoTransacao.create({
            idTransacao,
            data: new Date(),
            descricao,
            idUsuario
        }, { transaction });
        // Busca ingressos relacionados
        const ingressos = await Transacao_1.IngressoTransacao.findAll({
            where: { idTransacao },
            transaction,
        });
        // Atualiza os ingressos e cria histórico
        await Promise.all(ingressos.map(async (ingresso) => {
            await Ingresso_1.Ingresso.update({ status: 'Confirmado' }, { where: { id: ingresso.idIngresso }, transaction });
            await Ingresso_1.HistoricoIngresso.create({
                idIngresso: ingresso.idIngresso,
                data: new Date(),
                descricao: `Confirmado - ${descricao}`,
                idUsuario
            }, { transaction });
        }));
        // Commita tudo
        await transaction.commit();
        return true;
    }
    catch (error) {
        await transaction.rollback();
        console.error('Erro ao processar transação paga:', error);
        throw error;
    }
}
async function transacaoCancelada(idTransacao, descricao, idUsuario) {
    const transaction = await database_1.default.transaction(); // substitua pela instância correta do Sequelize
    try {
        // Atualiza status da transação
        await Transacao_1.Transacao.update({ status: 'Cancelado' }, { where: { id: idTransacao }, transaction });
        // Cria histórico da transação
        await Transacao_1.HistoricoTransacao.create({
            idTransacao,
            data: new Date(),
            descricao,
            idUsuario
        }, { transaction });
        // Busca ingressos relacionados
        const ingressos = await Transacao_1.IngressoTransacao.findAll({
            where: { idTransacao },
            transaction,
        });
        // Atualiza os ingressos e cria histórico
        await Promise.all(ingressos.map(async (ingresso) => {
            await Ingresso_1.Ingresso.update({ status: 'Reembolsado' }, { where: { id: ingresso.idIngresso }, transaction });
            await Ingresso_1.HistoricoIngresso.create({
                idIngresso: ingresso.idIngresso,
                data: new Date(),
                descricao: `Confirmado - ${descricao}`,
                idUsuario
            }, { transaction });
        }));
        // Commita tudo
        await transaction.commit();
        return true;
    }
    catch (error) {
        await transaction.rollback();
        console.error('Erro ao processar transação paga:', error);
        throw error;
    }
}
async function geraTokenSplit() {
    try {
        const empresa = await Empresa_1.Empresa.findOne({
            where: { id: 1 },
        });
        if (!empresa || !empresa.accessTokenInicial) {
            console.log('Empresa não encontrada ou accessTokenInicial não definido');
            throw new customError_1.CustomError('Empresa não encontrada ou accessTokenInicial não definido', 404, null);
        }
        const client = new mercadopago_1.MercadoPagoConfig({ accessToken: empresa.accessTokenInicial });
        const oauth = new mercadopago_1.OAuth(client);
        // Ajuste conforme as propriedades válidas de OAuthCreateData
        const body = {
            client_secret: ClienteSecret,
            client_id: ClienteID,
            code: empresa.refreshToken,
            redirect_uri: 'https://tanztecnologia.com.br/', // Substitua pela sua URL de redirecionamento                    
        };
        console.log('Gerando token split com os seguintes dados:', body);
        const response = await oauth.create({
            body: body,
        });
        console.log('Token Split gerado:', response);
        // Atualiza o accessToken da empresa
        empresa.accessToken = response.access_token;
        empresa.refreshToken = response.refresh_token;
        await empresa.save();
        return empresa;
    }
    catch (error) {
        console.error('Erro ao gerar token split:', error);
        throw new customError_1.CustomError('Erro ao gerar token split', 500, error);
    }
}
module.exports = {
    async pagamento(req, res, next) {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, idTransacao, salvarCartao, deviceId, items } = req.body;
        const users = await Usuario_1.Usuario.findAll({
            where: { email: payer.email },
        });
        const first_name = users[0].nomeCompleto;
        const last_name = users[0].sobreNome;
        let empresa = await Empresa_1.Empresa.findOne({
            where: { id: 1 },
        });
        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit();
        }
        const transacao = await Transacao_1.Transacao.findOne({
            where: { id: idTransacao },
        });
        const client = new mercadopago_1.MercadoPagoConfig({ accessToken: empresa.accessToken ?? "" });
        const tanzMP = new mercadopago_1.MercadoPagoConfig({ accessToken: TanzAcessToken });
        // const client = new MercadoPagoConfig({ accessToken: JangoAcessToken });
        // const tanzMP = new MercadoPagoConfig({ accessToken: JangoAcessToken });
        const payment = new mercadopago_1.Payment(client);
        const customer = new mercadopago_1.Customer(tanzMP);
        const customerCard = new mercadopago_1.CustomerCard(tanzMP);
        try {
            // Buscar se cliente já existe
            const customers = await customer.search({ options: { email: payer.email } });
            let customerId;
            if (customers.results && customers.results.length > 0) {
                customerId = customers.results[0].id?.toString() || '';
            }
            else {
                // Criar novo customer
                const created = await customer.create({ body: { email: payer.email } });
                customerId = created.id?.toString() || '';
            }
            try {
                if (salvarCartao) {
                    const bodyCard = {
                        token: token
                    };
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
            }
            catch (error) {
                console.error('Erro ao criar cartão:', error);
            }
            const body = {
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
                application_fee: parseFloat((transacao?.taxaServico ?? "0").toString()) || 0.00,
            };
            console.log('body', body);
            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(), // Gere uma chave de idempotência única
            };
            const idUsuario = users[0].id;
            // res.status(200).json({ data: { teste: 'teste' } })
            const data = new Date(); // Data atual
            await Transacao_1.HistoricoTransacao.create({ idTransacao, data, descricao: 'Tentativa Pagamento com Cartão Crédito', idUsuario });
            // Realiza o pagamento
            const response = await payment.create({ body, requestOptions });
            if (response.id) {
                // Salvar dados de pagamento
                await Transacao_1.TransacaoPagamento.create({
                    idTransacao: idTransacao,
                    PagamentoCodigo: response.id.toString() || '',
                });
            }
            if (response.status === 'approved') {
                await transacaoPaga(idTransacao, 'Pagamento Aprovado com Cartão de Crédito', idUsuario);
            }
            else {
                await Transacao_1.HistoricoTransacao.create({ idTransacao, data, descricao: `Pagamento ${response.status} - ${response.status_detail}`, idUsuario });
            }
            // Salvar dados de pagamento
            // await savePaymentData(response, payer, idUsuario, token);
            res.status(200).json({
                status: response.status,
                status_detail: response.status_detail,
                id: response.id,
                transaction_details: response.transaction_details,
                payer: response.payer,
                additional_info: response.additional_info,
            });
        }
        catch (error) {
            console.error(error);
            const err = error;
            res.status(500).json({
                error: 'Erro ao processar pagamento',
                details: err.message,
            });
        }
    },
    async pagamentoCardSalvo(req, res, next) {
        const { token, payment_method_id, transaction_amount, installments, payer, items, cvv, deviceId, idTransacao } = req.body;
        const users = await Usuario_1.Usuario.findAll({
            where: { email: payer.email },
        });
        let empresa = await Empresa_1.Empresa.findOne({
            where: { id: 1 },
        });
        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit();
        }
        const transacao = await Transacao_1.Transacao.findOne({
            where: { id: idTransacao },
        });
        const client = new mercadopago_1.MercadoPagoConfig({ accessToken: empresa.accessToken ?? "" });
        const tanzMP = new mercadopago_1.MercadoPagoConfig({ accessToken: TanzAcessToken });
        // const client = new MercadoPagoConfig({ accessToken: JangoAcessToken });
        // const tanzMP = new MercadoPagoConfig({ accessToken: JangoAcessToken });
        const payment = new mercadopago_1.Payment(client);
        const customer = new mercadopago_1.Customer(tanzMP);
        try {
            // Buscar se cliente já existe
            const customers = await customer.search({ options: { email: payer.email } });
            let customerId = null;
            if (customers.results && customers.results.length > 0) {
                customerId = customers.results[0].id?.toString() || '';
            }
            else {
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
            const body = {
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
                application_fee: parseFloat((transacao?.taxaServico ?? "0").toString()) || 0.00,
            };
            console.log('body', body);
            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(), // Gere uma chave de idempotência única
            };
            // res.status(200).json({ data: { teste: 'teste' } })
            // Realiza o pagamento
            const response = await payment.create({ body });
            const idUsuario = users[0].id;
            const data = new Date(); // Data atual
            if (response.id) {
                // Salvar dados de pagamento
                await Transacao_1.TransacaoPagamento.create({
                    idTransacao: idTransacao,
                    PagamentoCodigo: response.id.toString() || '',
                });
            }
            if (response.status === 'approved') {
                await transacaoPaga(idTransacao, 'Pagamento Aprovado com Cartão de Crédito', idUsuario);
            }
            else {
                await Transacao_1.HistoricoTransacao.create({ idTransacao, data, descricao: `Pagamento ${response.status} - ${response.status_detail}`, idUsuario });
            }
            // Salvar dados de pagamento
            // await savePaymentData(response, payer, idUsuario, token);
            res.status(200).json({
                status: response.status,
                status_detail: response.status_detail,
                id: response.id,
                transaction_details: response.transaction_details,
                payer: response.payer,
                additional_info: response.additional_info,
            });
        }
        catch (error) {
            console.error('error', error);
            const err = error;
            res.status(500).json({
                error: 'Erro ao processar pagamento',
                details: err.message,
            });
        }
    },
    async pagamentoPix(req, res) {
        try {
            const { valorTotal, descricao, email, idTransacao, deviceId } = req.body;
            let empresa = await Empresa_1.Empresa.findOne({
                where: { id: 1 },
            });
            if (!empresa || !empresa.accessToken) {
                empresa = await geraTokenSplit();
            }
            const transacao = await Transacao_1.Transacao.findOne({
                where: { id: idTransacao },
            });
            const client = new mercadopago_1.MercadoPagoConfig({ accessToken: empresa.accessToken ?? "" });
            // const client = new MercadoPagoConfig({ accessToken: TanzAcessToken });
            // const client = new MercadoPagoConfig({ accessToken: acessToken });
            const payment = new mercadopago_1.Payment(client);
            const users = await Usuario_1.Usuario.findAll({
                where: { email: email },
            });
            console.log('deviceId', deviceId);
            const body = {
                body: {
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
                    application_fee: parseFloat((transacao?.taxaServico ?? "0").toString()) || 0.00,
                },
            };
            const result = await payment.create(body);
            // Salvar dados de pagamento
            await Transacao_1.TransacaoPagamento.create({
                idTransacao: idTransacao,
                PagamentoCodigo: result.id?.toString() || '',
            });
            const idUsuario = users[0].id;
            const data = new Date(); // Data atual
            await Transacao_1.HistoricoTransacao.create({ idTransacao, data, descricao: 'Pagamento via Pix Criado', idUsuario });
            return res.status(200).json({
                id: result.id,
                status: result.status,
                status_detail: result.status_detail,
                point_of_interaction: result.point_of_interaction,
            });
        }
        catch (error) {
            console.error('Erro ao criar pagamento PIX:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Pix' });
        }
    },
    async buscarParcelas(req, res, next) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const amount = filters.amount;
        const bin = filters.bin;
        const payment_method_id = filters.payment_method_id;
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/installments?amount=${amount}&bin=${bin}&payment_method_id=${payment_method_id}`, {
                headers: {
                    Authorization: `Bearer ${TanzAcessToken}`,
                },
            });
            const data = await mpRes.json();
            console.log('parcelas', data);
            // const data = await mpRes.json();
            res.status(200).json({ data: data });
        }
        catch (error) {
            res.status(500).json({ error: 'Erro ao buscar parcelas' });
        }
    },
    async getCardsCustomer(req, res, next) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const email = filters.email;
        const client = new mercadopago_1.MercadoPagoConfig({
            accessToken: TanzAcessToken,
        });
        const customer = new mercadopago_1.Customer(client);
        const card = new mercadopago_1.CustomerCard(client);
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
            console.log('cards', cards);
            return res.status(200).json({
                data: {
                    customerId,
                    cards: cards.map((c) => ({
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
        }
        catch (error) {
            console.error('Erro ao buscar cartões do cliente:', error);
            res.status(500).json({
                error: 'Erro interno ao buscar os cartões do cliente',
                details: error.message,
            });
        }
    },
    async consultaPagamento(req, res, next) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const id = filters.id;
        try {
            const users = await Usuario_1.Usuario.findAll({
                where: { email: filters.email },
            });
            const idUsuario = users[0].id;
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${TanzAcessToken}`,
                }
            });
            const data = await response.json();
            if (data.status === 'approved') {
                const transacaoPagamento = await Transacao_1.TransacaoPagamento.findOne({
                    where: { PagamentoCodigo: id }
                });
                if (transacaoPagamento) {
                    const idTransacao = transacaoPagamento.idTransacao;
                    const transacao = await Transacao_1.Transacao.findOne({
                        where: { id: idTransacao },
                    });
                    if (!transacao) {
                        return res.status(404).json({ error: 'Transação não encontrada' });
                    }
                    transacao.valorTaxaProcessamento = data.fee_details
                        ?.find((fee) => fee.type === 'mercadopago_fee')?.amount || 0;
                    transacao.valorRecebido = data.transaction_details?.net_received_amount || 0;
                    transacao.idTransacaoRecebidoMP = id;
                    transacao.save();
                    // Atualiza status da transação
                    await transacaoPaga(idTransacao, 'Pagamento Via Pix Aprovado', idUsuario);
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
            });
        }
        catch (error) {
            console.error('Erro ao consultar pagamento:', error);
            res.status(500).json({
                error: 'Erro ao consultar pagamento',
                details: error.message,
            });
        }
    },
    async getPaymentData(req, res, next) {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        console.log('req.body', req.body);
        const idUsuario = filters.idUsuario;
        console.log('idUsuario', idUsuario);
        try {
            const paymentData = await ClienteMetodoPagamento_1.UsuarioMetodoPagamento.findAll({
                where: { idUsuario: idUsuario },
            });
            console.log('paymentData', paymentData);
            const decryptedData = paymentData.map((data) => {
                return (0, encryption_1.decrypt)(data.dados);
            });
            console.log('decryptedData', decryptedData);
            res.status(200).json({
                data: decryptedData,
            });
        }
        catch (error) {
            console.error(error);
            res.status(500).json({
                error: 'Erro ao buscar dados de pagamento',
            });
        }
    },
    async createPreferencePayment(req, res, next) {
        const { transaction_amount, items, payer, idTransacao } = req.body;
        let empresa = await Empresa_1.Empresa.findOne({
            where: { id: 1 },
        });
        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplit();
        }
        const transacao = await Transacao_1.Transacao.findOne({
            where: { id: idTransacao },
        });
        const client = new mercadopago_1.MercadoPagoConfig({ accessToken: TanzAcessToken });
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
            console.log('preference', preference);
            const preferenceInstance = new mercadopago_1.Preference(client);
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
        }
        catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Erro ao criar preferência' });
        }
    },
    async estornoPagamento(req, res, next) {
        const { idTransacao, idUsuario } = req.body;
        if (!idTransacao) {
            return res.status(400).json({ error: 'ID da transação é obrigatório' });
        }
        if (!idUsuario) {
            return res.status(400).json({ error: 'ID do usuário é obrigatório' });
        }
        try {
            let empresa = await Empresa_1.Empresa.findOne({ where: { id: 1 } });
            if (!empresa || !empresa.accessToken) {
                empresa = await geraTokenSplit();
            }
            const transacao = await Transacao_1.Transacao.findOne({
                where: { id: idTransacao },
            });
            if (!transacao) {
                return res.status(404).json({ error: 'Transação não encontrada' });
            }
            const ingressoTransacao = await Transacao_1.IngressoTransacao.findAll({
                where: { idTransacao },
            });
            if (!ingressoTransacao || ingressoTransacao.length === 0) {
                return res
                    .status(404)
                    .json({ error: 'Ingressos da transação não encontrados' });
            }
            // Verifica se todos os ingressos estão com status 'Confirmado'
            const ingressosNaoConfirmados = [];
            for (const ingresso of ingressoTransacao) {
                const ingressoDetails = await Ingresso_1.Ingresso.findOne({
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
            const client = new mercadopago_1.MercadoPagoConfig({
                accessToken: empresa.accessToken ?? '',
            });
            const paymentRefund = new mercadopago_1.PaymentRefund(client);
            console.log('Transação PagamentoCodigo:', transacao.idTransacaoRecebidoMP);
            if (!transacao.idTransacaoRecebidoMP) {
                return res.status(400).json({ error: 'ID da transação de pagamento não encontrado' });
            }
            const response = await paymentRefund.create({
                payment_id: transacao.idTransacaoRecebidoMP,
            });
            console.log('response', response);
            await transacaoCancelada(idTransacao, 'Estorno realizado com sucesso id:' + response.id, idUsuario);
            console.log('Estorno realizado:', response);
            return res.status(200).json({
                status: response.status,
                id: response.id,
            });
        }
        catch (error) {
            console.error('Erro ao realizar estorno:', error);
            return res.status(500).json({ error: 'Erro ao realizar estorno' });
        }
    },
    async webHookMercadoPago(req, res) {
        const { type, data } = req.body;
        console.log('type', type);
        console.log('data', data);
        console.log('WebHook Mercado Pago recebido:', req.body);
        if (type === 'payment') {
            const paymentId = data.id;
            try {
                let empresa = await Empresa_1.Empresa.findOne({
                    where: { id: 1 },
                });
                if (!empresa || !empresa.accessToken) {
                    console.log('Empresa não encontrada ou accessToken não definido');
                    return res.status(404).json({ error: 'Empresa não encontrada ou accessToken não definido' });
                }
                const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${TanzAcessToken}`,
                    }
                });
                const data = await response.json();
                console.log('Dados do pagamento:', data);
                if (data.status === 'approved') {
                    const transacaoPagamento = await Transacao_1.TransacaoPagamento.findOne({
                        where: { PagamentoCodigo: paymentId }
                    });
                    if (transacaoPagamento) {
                        const idTransacao = transacaoPagamento.idTransacao;
                        const transacao = await Transacao_1.Transacao.findOne({
                            where: { id: idTransacao },
                        });
                        if (!transacao) {
                            return res.status(404).json({ error: 'Transação não encontrada' });
                        }
                        transacao.valorTaxaProcessamento = data.fee_details
                            ?.find((fee) => fee.type === 'mercadopago_fee')?.amount || 0;
                        transacao.valorRecebido = data.transaction_details?.net_received_amount || 0;
                        transacao.idTransacaoRecebidoMP = paymentId;
                        transacao.save();
                        if (transacao.status != 'Pago') {
                            await transacaoPaga(idTransacao, 'Pagamento Realizado e enviado por WebHook', transacao.idUsuario);
                        }
                    }
                }
                res.status(200).json({ message: 'Webhook processado com sucesso' });
            }
            catch (error) {
                console.error('Erro ao processar webhook:', error);
                res.status(500).json({ error: 'Erro ao processar webhook' });
            }
        }
        else {
            res.status(400).json({ error: 'Tipo de webhook não suportado' });
        }
    }
};
