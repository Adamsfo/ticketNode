import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const algorithm = 'aes-256-cbc';
const key = crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY)).digest('base64').substr(0, 32);

// Função para criptografar texto
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(16); // Gere um vetor de inicialização de 16 bytes (128 bits)
    const cipher = crypto.createCipheriv(algorithm, key, Uint8Array.from(iv));
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// Função para descriptografar texto
export function decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, Uint8Array.from(iv));
    let decrypted = decipher.update(encryptedText.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}