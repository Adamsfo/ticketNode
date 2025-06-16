"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const algorithm = 'aes-256-cbc';
const key = crypto_1.default.createHash('sha256').update(String(process.env.ENCRYPTION_KEY)).digest('base64').substr(0, 32);
// Função para criptografar texto
function encrypt(text) {
    const iv = crypto_1.default.randomBytes(16); // Gere um vetor de inicialização de 16 bytes (128 bits)
    const cipher = crypto_1.default.createCipheriv(algorithm, key, Uint8Array.from(iv));
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}
// Função para descriptografar texto
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto_1.default.createDecipheriv(algorithm, key, Uint8Array.from(iv));
    let decrypted = decipher.update(encryptedText.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
