import firebird, { Options } from 'node-firebird';

const options: Options = {
    host: '160.20.20.102',
    port: 3050,
    database: 'C:\\PDV\\Server\\PDV.FDB',
    user: 'SYSDBA',
    password: 'masterkey',
    lowercase_keys: false,
    // role: null,
    pageSize: 4096
};

export function connect(): Promise<firebird.Database> {
    return new Promise((resolve, reject) => {
        firebird.attach(options, (err, db) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}
