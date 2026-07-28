export class HospedinApiError extends Error {
    public readonly status: number;
    public readonly details: unknown;

    constructor(message: string, status = 500, details: unknown = null) {
        super(message);
        this.name = 'HospedinApiError';
        this.status = status;
        this.details = details;
    }
}
