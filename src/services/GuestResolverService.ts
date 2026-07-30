import { where, fn, col } from 'sequelize';
import { Usuario } from '../models/Usuario';
import { TipoReservaHospede } from '../models/ReservaHospede';
import { onlyDigits } from '../utils/cpf';
import { pickGuestCpf } from '../utils/guestCpf';
import { HospedinLogger } from '../integrations/hospedin/logger/HospedinLogger';
import { hospedinSyncLogService } from '../integrations/hospedin/services/HospedinSyncLogService';
import { logger } from '../utils/logger';

export type GuestResolveInput = {
    nome: string;
    tipo: TipoReservaHospede | string;
    dataNascimento?: Date | null;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
    /** guest_id Hospedin, quando conhecido */
    externalGuestId?: number | null;
    /**
     * Documentos já importados (ex.: ReservaHospedeDocumento).
     * CPF válido neles tem prioridade antes de criar HÓSPEDE SEM CPF.
     */
    documentos?: Array<{ tipo?: string | null; numero?: string | null }> | null;
};

export type GuestResolveAction =
    | 'REUSED_BY_CPF'
    | 'CREATED'
    | 'TECHNICAL_CPF_MISSING'
    | 'TECHNICAL_CPF_INVALID'
    | 'UPGRADED_FROM_TECHNICAL';

export type GuestResolveResult = {
    idUsuario: number;
    action: GuestResolveAction;
    cpf: string | null;
    nome: string;
    message: string;
    /** true quando aponta para usuário técnico permanente (não cliente real). */
    isTechnical: boolean;
};

/** Logins fixos — nunca confundir com clientes reais. CPF permanece NULL. */
export const HOSPEDIN_TECHNICAL_USERS = {
    CPF_MISSING: {
        login: 'hospedin.tecnico.sem_cpf',
        nomeCompleto: 'HÓSPEDE SEM CPF',
        sobreNome: '(HOSPEDIN)',
        label: 'HÓSPEDE SEM CPF (HOSPEDIN)',
    },
    CPF_INVALID: {
        login: 'hospedin.tecnico.cpf_invalido',
        nomeCompleto: 'HÓSPEDE CPF INVÁLIDO',
        sobreNome: '(HOSPEDIN)',
        label: 'HÓSPEDE CPF INVÁLIDO (HOSPEDIN)',
    },
} as const;

function nestedReplaceCpf() {
    return ['.', '-', ' '].reduce(
        (expr, ch) => fn('REPLACE', expr, ch, ''),
        col('cpf') as any
    );
}

function splitNome(nome: string): { nomeCompleto: string; sobreNome: string } {
    const parts = String(nome || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length === 0) {
        return { nomeCompleto: 'Hóspede', sobreNome: 'Hospedin' };
    }
    if (parts.length === 1) {
        return { nomeCompleto: parts[0], sobreNome: parts[0] };
    }
    return {
        nomeCompleto: parts.slice(0, -1).join(' '),
        sobreNome: parts[parts.length - 1],
    };
}

function formatTelefoneBr(raw: unknown): string | null {
    const d = onlyDigits(raw);
    if (d.length === 10) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    if (d.length === 11) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    return null;
}

/**
 * Resolve hóspede → Usuario oficial do Jango.
 * Chave: apenas CPF. Não sobrescreve cadastro existente.
 * CPF ausente/inválido → usuários técnicos permanentes (nunca cria fantasma).
 */
export class GuestResolverService {
    private cpfCache = new Map<string, number>();
    private technicalIds: {
        missing: number | null;
        invalid: number | null;
    } = { missing: null, invalid: null };

    clearCache() {
        this.cpfCache.clear();
    }

    isTechnicalUserId(idUsuario: number | null | undefined): boolean {
        if (idUsuario == null) return false;
        const id = Number(idUsuario);
        return (
            id === this.technicalIds.missing ||
            id === this.technicalIds.invalid
        );
    }

    async ensureTechnicalUsers(): Promise<{
        missingId: number;
        invalidId: number;
    }> {
        const missing = await this.findOrCreateTechnical(
            HOSPEDIN_TECHNICAL_USERS.CPF_MISSING
        );
        const invalid = await this.findOrCreateTechnical(
            HOSPEDIN_TECHNICAL_USERS.CPF_INVALID
        );
        this.technicalIds.missing = Number(missing.id);
        this.technicalIds.invalid = Number(invalid.id);
        return {
            missingId: this.technicalIds.missing,
            invalidId: this.technicalIds.invalid,
        };
    }

    async resolveGuest(
        input: GuestResolveInput,
        meta?: {
            reservationId?: number;
            correlationId?: string;
            previousIdUsuario?: number | null;
        }
    ): Promise<GuestResolveResult> {
        const nome = String(input.nome || '').trim() || 'Hóspede';
        const picked = pickGuestCpf({
            cpf: input.cpf,
            documents: input.documentos,
        });
        const assessment = picked.assessment;
        await this.ensureTechnicalUsers();

        if (assessment.status === 'valid') {
            const result = await this.resolveValidCpf({
                nome,
                formatted: assessment.formatted,
                digits: assessment.digits,
                email: input.email,
                telefone: input.telefone,
                externalGuestId: input.externalGuestId,
                previousIdUsuario: meta?.previousIdUsuario,
            });
            if (picked.source && picked.source !== 'cpf') {
                logger.debug('guest_resolver:cpf_from_document', {
                    source: picked.source,
                    reservation_id: meta?.reservationId,
                    nome,
                });
            }
            await this.logResolve(result, meta, {
                cpfSource: picked.source,
            });
            return result;
        }

        if (assessment.status === 'missing') {
            const idUsuario = this.technicalIds.missing!;
            const result: GuestResolveResult = {
                idUsuario,
                action: 'TECHNICAL_CPF_MISSING',
                cpf: null,
                nome,
                isTechnical: true,
                message:
                    'CPF ausente — usuário técnico HÓSPEDE SEM CPF (HOSPEDIN) utilizado.',
            };
            await this.logResolve(result, meta);
            return result;
        }

        const idUsuario = this.technicalIds.invalid!;
        const result: GuestResolveResult = {
            idUsuario,
            action: 'TECHNICAL_CPF_INVALID',
            cpf: null,
            nome,
            isTechnical: true,
            message:
                'CPF inválido — usuário técnico HÓSPEDE CPF INVÁLIDO (HOSPEDIN) utilizado.',
        };
        await this.logResolve(result, meta, {
            cpfRaw: assessment.raw,
            cpfSource: picked.source,
        });
        return result;
    }

    async resolveMany(
        inputs: GuestResolveInput[],
        meta?: { reservationId?: number; correlationId?: string }
    ): Promise<GuestResolveResult[]> {
        const out: GuestResolveResult[] = [];
        for (const input of inputs) {
            out.push(await this.resolveGuest(input, meta));
        }
        return out;
    }

    private async resolveValidCpf(input: {
        nome: string;
        formatted: string;
        digits: string;
        email?: string | null;
        telefone?: string | null;
        externalGuestId?: number | null;
        previousIdUsuario?: number | null;
    }): Promise<GuestResolveResult> {
        const fromTechnical =
            input.previousIdUsuario != null &&
            (Number(input.previousIdUsuario) === this.technicalIds.missing ||
                Number(input.previousIdUsuario) === this.technicalIds.invalid);

        const cached = this.cpfCache.get(input.digits);
        if (cached) {
            return {
                idUsuario: cached,
                action: fromTechnical
                    ? 'UPGRADED_FROM_TECHNICAL'
                    : 'REUSED_BY_CPF',
                cpf: input.formatted,
                nome: input.nome,
                isTechnical: false,
                message: fromTechnical
                    ? 'CPF informado — vínculo atualizado do usuário técnico para o Usuario definitivo (cache).'
                    : 'Usuário localizado por CPF (cache do lote).',
            };
        }

        const existing = await this.findByCpfDigits(input.digits);
        if (existing) {
            this.cpfCache.set(input.digits, Number(existing.id));
            return {
                idUsuario: Number(existing.id),
                action: fromTechnical
                    ? 'UPGRADED_FROM_TECHNICAL'
                    : 'REUSED_BY_CPF',
                cpf: input.formatted,
                nome: input.nome,
                isTechnical: false,
                message: fromTechnical
                    ? 'CPF informado — usuário definitivo localizado; reserva vinculada ao Usuario correto.'
                    : 'Usuário localizado por CPF.',
            };
        }

        const created = await this.createClienteUsuario({
            nome: input.nome,
            cpf: input.formatted,
            email: input.email,
            telefone: input.telefone,
            externalGuestId: input.externalGuestId,
        });
        this.cpfCache.set(input.digits, Number(created.id));
        return {
            idUsuario: Number(created.id),
            action: fromTechnical ? 'UPGRADED_FROM_TECHNICAL' : 'CREATED',
            cpf: input.formatted,
            nome: input.nome,
            isTechnical: false,
            message: fromTechnical
                ? 'CPF informado — novo Usuario definitivo criado; reserva vinculada.'
                : 'Novo usuário criado.',
        };
    }

    private async findOrCreateTechnical(def: {
        login: string;
        nomeCompleto: string;
        sobreNome: string;
        label: string;
    }): Promise<Usuario> {
        const existing = await Usuario.findOne({ where: { login: def.login } });
        if (existing) return existing;

        HospedinLogger.info('guest_resolver:technical_user_create', {
            login: def.login,
            label: def.label,
        });

        return Usuario.create({
            login: def.login,
            email: null as any,
            senha: 'hospedin-tecnico',
            nomeCompleto: def.nomeCompleto,
            sobreNome: def.sobreNome,
            ativo: true,
            preCadastro: true,
            // CPF NULL — não usa fictício (evita colisão UNIQUE / confusão com cliente)
            cpf: undefined,
        });
    }

    private async findByCpfDigits(digits: string): Promise<Usuario | null> {
        const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
        const exact = await Usuario.findOne({ where: { cpf: formatted } });
        if (exact) return exact;

        return Usuario.findOne({
            where: where(nestedReplaceCpf(), digits) as any,
        });
    }

    private async createClienteUsuario(input: {
        nome: string;
        cpf: string;
        email?: string | null;
        telefone?: string | null;
        externalGuestId?: number | null;
    }): Promise<Usuario> {
        const { nomeCompleto, sobreNome } = splitNome(input.nome);
        const email =
            input.email && String(input.email).includes('@')
                ? String(input.email).trim()
                : null;
        const telefone = formatTelefoneBr(input.telefone);

        const suffix =
            input.externalGuestId != null
                ? String(input.externalGuestId)
                : `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        let login = email || onlyDigits(input.cpf) || `hospedin.guest.${suffix}`;

        const loginTaken = await Usuario.findOne({ where: { login } });
        if (loginTaken) {
            login = `hospedin.guest.${suffix}.${loginTaken.id}`;
        }

        if (email) {
            const emailTaken = await Usuario.findOne({ where: { email } });
            if (emailTaken) {
                return Usuario.create({
                    login: `hospedin.guest.${suffix}`,
                    email: null as any,
                    senha: onlyDigits(input.cpf).slice(-4) || '0000',
                    nomeCompleto,
                    sobreNome,
                    ativo: true,
                    preCadastro: true,
                    cpf: input.cpf,
                    telefone: telefone || undefined,
                });
            }
        }

        return Usuario.create({
            login,
            email: email || (null as any),
            senha: onlyDigits(input.cpf).slice(-4) || '0000',
            nomeCompleto,
            sobreNome,
            ativo: true,
            preCadastro: true,
            cpf: input.cpf,
            telefone: telefone || undefined,
        });
    }

    private async logResolve(
        result: GuestResolveResult,
        meta?: { reservationId?: number; correlationId?: string },
        extra?: { cpfRaw?: string; cpfSource?: string | null }
    ) {
        HospedinLogger.debug('guest_resolver', {
            action: result.action,
            idUsuario: result.idUsuario,
            cpf: result.cpf,
            nome: result.nome,
            isTechnical: result.isTechnical,
            message: result.message,
            reservation_id: meta?.reservationId,
            correlation_id: meta?.correlationId,
            ...extra,
        });

        if (result.isTechnical) {
            if (result.action === 'TECHNICAL_CPF_INVALID') {
                logger.warn(result.message, {
                    reservation_id: meta?.reservationId,
                    nome: result.nome,
                    action: result.action,
                });
            } else {
                logger.debug(result.message, {
                    reservation_id: meta?.reservationId,
                    nome: result.nome,
                    action: result.action,
                });
            }
        }

        await hospedinSyncLogService.write({
            operacao: 'guest_resolver',
            request: {
                type: result.action,
                timestamp: new Date().toISOString(),
                external_id: meta?.reservationId ?? null,
                correlation_id: meta?.correlationId ?? null,
                cpf: result.cpf,
                cpf_raw: extra?.cpfRaw ?? null,
                cpf_source: extra?.cpfSource ?? null,
                nome: result.nome,
                is_technical: result.isTechnical,
            },
            response: {
                type: result.action,
                message: result.message,
                idUsuario: result.idUsuario,
                isTechnical: result.isTechnical,
                changes: [],
            },
            status: 200,
            sucesso: true,
        });
    }
}

export const guestResolverService = new GuestResolverService();
