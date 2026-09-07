const jwt = require("jsonwebtoken");

const secret = process.env.JWT_SECRET as string;

export const generateToken = (user: any) => {
  return jwt.sign({ id: user.id, email: user.email }, secret, {
    expiresIn: "48h",
  });
};

export const verifyToken = (token: any) => {
  return jwt.verify(token, secret);
};

export const resolveLoginToken = (
  usuario: { id: number; email: string; token?: string | null },
  manterOutrasConexoes: boolean
): { token: string; persist: boolean } => {
  if (manterOutrasConexoes && usuario.token) {
    try {
      verifyToken(usuario.token);
      return { token: usuario.token, persist: false };
    } catch {
      // token ausente, inválido ou expirado — gera novo abaixo
    }
  }

  const token = generateToken(usuario);
  return { token, persist: true };
};
