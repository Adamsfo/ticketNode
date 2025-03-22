import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Payment, MercadoPagoConfig } from 'mercadopago'
const axios = require('axios')

module.exports = {
    async pagamento(req: any, res: any, next: any) {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, items } = req.body

        const client = new MercadoPagoConfig({ accessToken: "TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000" });

        const payment = new Payment(client)

        const body = {
            transaction_amount: transaction_amount,
            token: token,
            description: 'description',
            installments: installments,
            payment_method_id: payment_method_id,
            issuer_id: issuer_id,
            payer: payer
        }

        console.log(body)

        const requestOptions = {
            idempotencyKey: '1111111',
        };

        try {
            const response = await payment.create({ body, requestOptions });
            console.log(response);
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

    async getPreferenceId(req: any, res: any, next: any) {
        const { email, title, description, quantity, currency_id, unit_price } = req.body;
        console.log(email, title, description, quantity, currency_id, unit_price);
        const response = await fetch(
            `https://api.mercadopago.com/checkout/preferences?access_token=TEST-2517899600225439-032009-c36d88bc4644365b9245fbb39abf20d6-488781000`,
            {
                method: 'POST',
                body: JSON.stringify({
                    items: [
                        {
                            title: title,
                            description: description,
                            quantity: quantity,
                            currency_id: currency_id,
                            unit_price: unit_price,
                        },
                    ],
                    payer: {
                        email: email,
                    },
                }),
            }
        );

        const preference = await response.json();
        console.log(preference);

        return res.status(200).json({ preference: preference.id });
    }
}
