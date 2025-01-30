const { checkSchema } = require('express-validator')
module.exports = {
    usuario: checkSchema({
        nome: {
            trim: true,
            notEmpty: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Nome precisa ter pelo menos 2 caracteres'
        },
        nomecompleto: {
            trim: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Senha precisa ter pelo menos 2 caracteres'
        },
        senha: {
            trim: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Senha precisa ter pelo menos 2 caracteres'
        }
    }),
    editUsuario: checkSchema({
        token: {
            notEmpty: true
        },
        nome: {
            optional: true,
            trim: true,
            notEmpty: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Nome precisa ter pelo menos 2 caracteres'
        },
        nomecompleto: {
            optional: true,
            trim: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Senha precisa ter pelo menos 2 caracteres'
        },
        senha: {
            optional: true,
            trim: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Senha precisa ter pelo menos 2 caracteres'
        }
    }),
    login: checkSchema({
        nome: {
            trim: true,
            notEmpty: true,
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Nome precisa ter pelo menos 2 caracteres'
        },
        senha: {
            isLength: {
                options: { min: 2 }
            },
            errorMessage: 'Senha precisa ter pelo menos 2 caracteres'
        }
    })
}