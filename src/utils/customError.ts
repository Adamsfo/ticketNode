// utils/CustomError.js

export class CustomError extends Error {
  public statusCode: number;
  public status: string;
  public code: number;
  public details: {};
  public isOperational: boolean;

  constructor(message: string, statusCode: number, code: any, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// module.exports = CustomError;
