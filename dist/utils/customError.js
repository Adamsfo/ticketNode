"use strict";
// utils/CustomError.js
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomError = void 0;
class CustomError extends Error {
    constructor(message, statusCode, code, details = {}) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.code = code;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.CustomError = CustomError;
// module.exports = CustomError;
