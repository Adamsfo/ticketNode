const { ValidationError } = require('sequelize');

const errorHandler = (err: any, req: any, res: any, next: any) => {
  // res.setHeader('Content-Type', 'application/json');

  if (err instanceof ValidationError) {
    // Erro de validação do Sequelize
    return res.status(400).json({
      message: 'Erro de validação.',
      errors: err.errors.map((e: any) => ({
        field: e.path,
        message: e.message
      }))
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    // Erro de violação de chave única
    return res.status(409).json({
      message: 'Erro de conflito. Registro duplicado.',
      field: err.errors[0].path
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    // Erro de violação de chave estrangeira
    return res.status(409).json({
      message: 'Erro de conflito. Violação de chave estrangeira.',
      field: err.index
    });
  }

  // Tratamento de erros genéricos
  if (err.isOperational) {

    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      code: err.code,
      details: err.details,
    });
  } else {
    console.error('ERROR:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal Server Error',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
};

module.exports = errorHandler;
