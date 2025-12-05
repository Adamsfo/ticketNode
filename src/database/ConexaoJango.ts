import util from 'util';
import { connect } from '../config/databaseJango';

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const db = await connect();

    try {
        const exec = util.promisify(db.query).bind(db);
        const result = (await exec(sql, params ?? [])) as T[];
        return result;
    } finally {
        db.detach();
    }
}
