const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'secrectkey'; // Substitua por uma chave secreta segura

export const generateToken = (user: any) => {
  return jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '12h' });
};

export const verifyToken = (token: any) => {
  return jwt.verify(token, secret);
};

// module.exports = { generateToken, verifyToken };
