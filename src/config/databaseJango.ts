import "dotenv/config";
import firebird, { Options } from "node-firebird";

const options: Options = {
  host: process.env.JANGO_FB_HOST,
  port: Number(process.env.JANGO_FB_PORT || 3050),
  database: process.env.JANGO_FB_DATABASE,
  user: process.env.JANGO_FB_USER,
  password: process.env.JANGO_FB_PASSWORD,
  lowercase_keys: false,
  pageSize: 4096,
};

export function connect(): Promise<firebird.Database> {
  return new Promise((resolve, reject) => {
    firebird.attach(options, (err, db) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}
