import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Payment, MercadoPagoConfig, Customer, CustomerCard } from 'mercadopago'
const axios = require('axios')
import { encrypt, decrypt } from '../utils/encryption'; // Supondo que você tenha funções de criptografia
import { UsuarioMetodoPagamento } from "../models/ClienteMetodoPagamento";
import { addHistorico } from "./TransacaoController";
import { HistoricoTransacao, IngressoTransacao, Transacao, TransacaoPagamento } from "../models/Transacao";
import { Usuario } from "../models/Usuario";
import { HistoricoIngresso, Ingresso } from "../models/Ingresso";
import connection from "../database";

// const acessToken = "APP_USR-2517899600225439-032009-f1127f8e355bf2605cc6e80250129500-488781000"
const acessToken = "TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000"

// const MP_PUBLIC_KEY = "APP_USR-8ccbd791-ea60-4e70-a915-a89fd05f5c23"; // Chave pública do Mercado Pago
const MP_PUBLIC_KEY = "TEST-98f4cccd-2514-4062-a671-68df4b579410"; // Chave pública do Mercado Pago

// Função para gerar uma chave de idempotência única
function generateUniqueIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Função para salvar dados de pagamento
async function savePaymentData(paymentResponse: any, payer: any, idUsuario: number, token: string) {
    const encryptedData = encrypt(JSON.stringify({
        payment_method_id: paymentResponse.payment_method_id,
        issuer_id: paymentResponse.issuer_id,
        card: paymentResponse.card,
        payer: payer,
        token: token,
    }));

    // Supondo que você tenha um modelo de banco de dados PaymentData
    await UsuarioMetodoPagamento.create({
        idUsuario: idUsuario,
        dados: encryptedData,
    });
}

async function transacaoPaga(idTransacao: number, descricao: string, idUsuario: number) {
    const transaction = await connection.transaction(); // substitua pela instância correta do Sequelize

    try {
        // Atualiza status da transação
        await Transacao.update(
            { status: 'Pago' },
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

        return true;
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao processar transação paga:', error);
        throw error;
    }
}

module.exports = {
    async pagamento(req: any, res: any, next: any) {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, idTransacao, salvarCartao, deviceId, items } = req.body

        console.log('payer', payer)

        const users = await Usuario.findAll({
            where: { email: payer.email },
        });

        const first_name = users[0].nomeCompleto
        const last_name = users[0].sobreNome

        const client = new MercadoPagoConfig({ accessToken: acessToken });

        const payment = new Payment(client)
        const customer = new Customer(client);
        const customerCard = new CustomerCard(client)
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

                    res.status(200).json({
                        data: {
                            customerId,
                            createdCard: createdCard?.id,
                            message: 'Cartão salvo com sucesso',
                        }
                    });
                    console.log('Cartão salvo:', createdCard.id);
                }
            } catch (error) {
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
                }
            }

            console.log('body', body)

            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(),  // Gere uma chave de idempotência única
            };

            const idUsuario = users[0].id

            // res.status(200).json({ data: { teste: 'teste' } })

            const data = new Date(); // Data atual
            await HistoricoTransacao.create({ idTransacao, data, descricao: 'Tentativa Pagamento com Cartão Crédito', idUsuario });

            // Realiza o pagamento
            const response = await payment.create({ body, requestOptions });
            console.log(response);

            if (response.status === 'approved') {
                await transacaoPaga(idTransacao, 'Pagamento Aprovado com Cartão de Crédito', idUsuario)
            } else {
                await HistoricoTransacao.create({ idTransacao, data, descricao: `Pagamento ${response.status} - ${response.status_detail}`, idUsuario });
            }

            // Salvar dados de pagamento
            await savePaymentData(response, payer, idUsuario, token);

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
        const { token, payment_method_id, transaction_amount, installments, payer, items } = req.body

        console.log('tokensalvo', token)
        console.log('payment_method_id', payment_method_id)
        console.log('transaction_amount', transaction_amount)
        console.log('installments', installments)
        console.log('payer', payer)


        const client = new MercadoPagoConfig({ accessToken: acessToken });

        const payment = new Payment(client)
        const customer = new Customer(client);
        try {
            // Buscar se cliente já existe
            const customers = await customer.search({ options: { email: payer.email } });

            let customerId: string | null = null;

            if (customers.results && customers.results.length > 0) {
                customerId = customers.results[0].id?.toString() || '';
            } else {
                throw new Error('Customer ID not found');
            }

            const body = {
                transaction_amount: transaction_amount,
                token: token,
                description: 'Compra de Ingressos',
                installments: installments,
                // payment_method_id: payment_method_id,
                payer: {
                    type: "customer",
                    id: customerId,
                    // email: payer.email,
                },
            }

            console.log('body', body)

            const requestOptions = {
                idempotencyKey: generateUniqueIdempotencyKey(),  // Gere uma chave de idempotência única
            };

            // res.status(200).json({ data: { teste: 'teste' } })

            // Realiza o pagamento
            const response = await payment.create({ body });
            console.log(response);

            // Salvar dados de pagamento
            await savePaymentData(response, payer, req.body.idUsuario, token);

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

    async pagamentoPix(req: any, res: any) {
        try {
            const { valorTotal, descricao, email, idTransacao, deviceId } = req.body;
            const client = new MercadoPagoConfig({ accessToken: acessToken });
            const payment = new Payment(client);
            const users = await Usuario.findAll({
                where: { email: email },
            });

            console.log('deviceId', deviceId)

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
                    }
                },
            }

            const result = await payment.create(body);

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
                        Authorization: `Bearer ${acessToken}`,
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
            accessToken: acessToken,
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
                    Authorization: `Bearer ${acessToken}`,
                }
            })

            const data = await response.json()

            if (data.status === 'approved') {
                const Transacao = await TransacaoPagamento.findOne({
                    where: { PagamentoCodigo: id }
                })

                console.log('Transacao', Transacao)

                if (Transacao) {
                    const idTransacao = Transacao.idTransacao

                    // Atualiza status da transação
                    await transacaoPaga(idTransacao, 'Pagamento Via Pix Aprovado', idUsuario)
                }
            }

            res.status(200).json({ data: { status: data.status } })
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

    async createCardToken(req: any, res: any, next: any) {
        const { card_number, expiration_month, expiration_year, security_code, cardholder } = req.body;
        console.log('createCardToken', req.body)

        // Validar formato do número do cartão
        const cardNumberPattern = /^[0-9]{16}$/;
        if (!cardNumberPattern.test(card_number)) {
            console.error("Número do cartão inválido:", card_number);
            return res.status(400).json({ error: 'Número do cartão inválido', details: 'O número do cartão deve conter 16 dígitos numéricos.' });

        }


        const cardData = {
            card_number: card_number,
            expiration_month: expiration_month,
            expiration_year: expiration_year,
            security_code: security_code,
            cardholder: cardholder,
        };

        try {
            const response = await axios.post(
                "https://api.mercadopago.com/v1/card_tokens",
                cardData,
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000`,
                    },
                }
            );

            const data = await response.data;
            if (data.id) {
                res.status(200).json({ token: data.id });
            } else {
                console.error("Erro ao gerar token de cartão:", data);
                res.status(500).json({ error: "Erro ao gerar token de cartão", details: data });
            }
        } catch (error) {
            console.error("Erro ao gerar token de cartão:", error);
            res.status(500).json({ error: "Erro ao gerar token de cartão" });
        }
    },

    async getPreferenceId(req: any, res: any, next: any) {
        const { email, title, description, quantity, currency_id, unit_price } = req.body;
        console.log('entrou')
        console.log(email, title, description, quantity, currency_id, unit_price);
        const response = await fetch(
            `https://api.mercadopago.com/checkout/preferences?access_token=TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000`,
            {
                method: 'POST',
                body: JSON.stringify({
                    items: [
                        {
                            title: 'title',
                            description: 'description',
                            quantity: 1000,
                            // currency_id: currency_id,
                            unit_price: 1,
                        },
                    ],
                    // payer: {
                    //     email: email,
                    // },
                }),
            }
        );


        const preference = await response.json();
        console.log(preference);

        return res.status(200).json({ preference: preference.id });
    },

    async createCustomer(req: any, res: any, next: any) {
        const { email, firstName, lastName } = req.body;

        try {
            // Verifica se o cliente já existe
            const existing = await axios.get(
                `https://api.mercadopago.com/v1/customers/search?email=${email}`,
                {
                    headers: {
                        Authorization: `Bearer ${"TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000"}`,
                    },
                }
            );

            if (existing.data.results.length > 0) {
                // Cliente já existe, retorna ele
                console.log('Cliente já existe:', existing.data.results[0]);
                return res.json(existing.data.results[0]);
            }

            // Cliente não existe, então cria um novo
            const response = await axios.post(
                'https://api.mercadopago.com/v1/customers',
                {
                    email,
                    first_name: firstName,
                    last_name: lastName,
                },
                {
                    headers: {
                        Authorization: `Bearer ${"TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000"}`,
                    },
                }
            );

            res.json(response.data);
        } catch (error: any) {
            console.error(error.response?.data || error.message);
            res.status(500).json({ error: error.response?.data || error.message });
        }
    },

    async saveCard(req: any, res: any, next: any) {
        const { customerId, token } = req.body;

        try {
            const response = await axios.post(
                `https://api.mercadopago.com/v1/customers/${customerId}/cards`,
                { token },
                { headers: { Authorization: `Bearer ${"TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000"}` } }
            );

            res.json(response.data);
        } catch (error: any) {
            res.status(500).json({ error: error.response.data });
        }
    },

    async processPayment(req: any, res: any, next: any) {
        const { customerId, cardId, transactionAmount, description, installments, paymentMethodId } = req.body;

        try {
            const response = await axios.post(
                'https://api.mercadopago.com/v1/payments',
                {
                    transaction_amount: transactionAmount,
                    token: null,
                    description,
                    installments,
                    payment_method_id: paymentMethodId,
                    payer: {
                        type: 'customer',
                        id: customerId,
                    },
                    metadata: { fromApp: true },
                    captured: true,
                    customer_id: customerId,
                    card_id: cardId,
                },
                { headers: { Authorization: `Bearer ${"TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000"}` } }
            );

            res.json(response.data);
        } catch (error: any) {
            res.status(500).json({ error: error.response.data });
        }
    }
}
