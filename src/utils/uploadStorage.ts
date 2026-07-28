import fs from 'fs';
import path from 'path';

/**
 * Storage local de uploads do Jango.
 * Único ponto de acesso a public/uploads — facilita migração futura (S3/CDN).
 */
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

/** Limite alinhado ao body parser (~4mb) com folga. */
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

function ensureUploadsDir() {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
}

function sanitizePrefix(raw: string): string {
    return (
        String(raw || 'Upload')
            .replace(/[^a-zA-Z0-9_-]/g, '')
            .slice(0, 40) || 'Upload'
    );
}

function sanitizeFilename(filename: string): string {
    const base = path.basename(String(filename || '').trim());
    if (!base || base === '.' || base === '..') {
        throw new Error('Nome de arquivo inválido.');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
        throw new Error('Nome de arquivo contém caracteres inválidos.');
    }
    return base;
}

function detectExtension(mimeType: string, nomeOriginal: string): string {
    const mime = String(mimeType || '').toLowerCase();
    const nome = String(nomeOriginal || '').toLowerCase();

    if (mime.includes('pdf') || nome.endsWith('.pdf')) return 'pdf';
    if (
        mime.includes('jpeg') ||
        mime.includes('jpg') ||
        nome.endsWith('.jpg') ||
        nome.endsWith('.jpeg')
    ) {
        return 'jpg';
    }
    if (mime.includes('heic') || nome.endsWith('.heic')) return 'heic';
    if (mime.includes('webp') || nome.endsWith('.webp')) return 'webp';
    if (mime.includes('png') || nome.endsWith('.png')) return 'png';
    return 'png';
}

export type SaveUploadInput = {
    /** Base64 puro ou data-URL */
    file: string;
    prefixo?: string;
    /** Compatível com ImageUploader legado (Codigo) */
    Codigo?: string;
    mimeType?: string;
    nomeOriginal?: string;
};

export type SaveUploadResult = {
    filename: string;
    /** Caminho público relativo (ex.: /uploads/Suite_123.png) */
    publicPath: string;
};

export type DeleteUploadResult = {
    deleted: boolean;
    filename: string;
    /** Arquivo ausente ou falha de IO — operação de negócio não deve abortar */
    warning?: string;
};

export const uploadStorage = {
    getUploadsDir(): string {
        ensureUploadsDir();
        return uploadsDir;
    },

    /** Caminho físico absoluto do arquivo. */
    resolvePath(filename: string): string {
        const safe = sanitizeFilename(filename);
        const full = path.join(uploadsDir, safe);
        const resolved = path.resolve(full);
        const root = path.resolve(uploadsDir);
        if (!resolved.startsWith(root + path.sep) && resolved !== root) {
            throw new Error('Caminho de upload inválido.');
        }
        return resolved;
    },

    /** URL/path público relativo servido pelo Express. */
    publicUrl(filename: string): string {
        const safe = sanitizeFilename(filename);
        return `/uploads/${safe}`;
    },

    async saveFromBase64(input: SaveUploadInput): Promise<SaveUploadResult> {
        ensureUploadsDir();
        if (!input?.file) {
            throw new Error('Nenhum arquivo foi enviado.');
        }

        const base64Data = String(input.file).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        if (!buffer.length) {
            throw new Error('O arquivo enviado está vazio ou inválido.');
        }
        if (buffer.length > MAX_UPLOAD_BYTES) {
            throw new Error(
                'Arquivo muito grande. Envie uma imagem de até 3,5 MB.'
            );
        }

        const mime = String(input.mimeType || '').toLowerCase();
        const nome = String(input.nomeOriginal || '').toLowerCase();
        const seemsImage =
            !mime ||
            mime.startsWith('image/') ||
            mime.includes('pdf') ||
            /\.(png|jpe?g|heic|webp|pdf)$/i.test(nome);
        if (!seemsImage && mime && !mime.includes('octet-stream')) {
            throw new Error(
                'Formato não suportado. Use JPG, PNG, WEBP, HEIC ou PDF.'
            );
        }

        const prefixo = sanitizePrefix(input.prefixo || input.Codigo || 'Upload');
        const ext = detectExtension(
            input.mimeType || '',
            input.nomeOriginal || ''
        );
        const filename = `${prefixo}_${Date.now()}.${ext}`;
        const fullPath = this.resolvePath(filename);

        await fs.promises.writeFile(fullPath, new Uint8Array(buffer));

        return {
            filename,
            publicPath: this.publicUrl(filename),
        };
    },

    /**
     * Remove arquivo físico. Nunca lança se o arquivo não existir —
     * retorna warning para log.
     */
    async deleteFile(filename: string | null | undefined): Promise<DeleteUploadResult> {
        if (!filename) {
            return {
                deleted: false,
                filename: '',
                warning: 'Filename vazio na exclusão de upload.',
            };
        }

        try {
            const fullPath = this.resolvePath(filename);
            if (!fs.existsSync(fullPath)) {
                console.warn(
                    `[uploadStorage] Arquivo já inexistente: ${filename}`
                );
                return {
                    deleted: false,
                    filename: path.basename(filename),
                    warning: `Arquivo não encontrado: ${filename}`,
                };
            }
            await fs.promises.unlink(fullPath);
            return { deleted: true, filename: path.basename(filename) };
        } catch (err: any) {
            const message = err?.message || String(err);
            console.warn(
                `[uploadStorage] Falha ao excluir ${filename}: ${message}`
            );
            return {
                deleted: false,
                filename: path.basename(String(filename)),
                warning: message,
            };
        }
    },
};

export default uploadStorage;
