"use strict";
const { ValidationError } = require('sequelize');
const { logger } = require('../utils/logger');
const errorHandler = (err, req, res, next) => {
    if (err instanceof ValidationError) {
        return res.status(400).json({
            message: 'Erro de validação.',
            errors: err.errors.map((e) => ({
                field: e.path,
                message: e.message,
            })),
        });
    }
    if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
            message: 'Erro de conflito. Registro duplicado.',
            field: err.errors[0].path,
        });
    }
    if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(409).json({
            message: 'Erro de conflito. Violação de chave estrangeira.',
            field: err.index,
        });
    }
    if (err.isOperational) {
        res.status(err.statusCode).json({
            status: err.status,
            message: err.message,
            code: err.code,
            details: err.details,
        });
    }
    else {
        logger.error('Internal Server Error', {
            message: err?.message,
            stack: err?.stack,
            path: req?.path,
        });
        res.status(500).json({
            status: 'error',
            message: 'Internal Server Error',
            code: 'INTERNAL_SERVER_ERROR',
        });
    }
};
module.exports = errorHandler;
