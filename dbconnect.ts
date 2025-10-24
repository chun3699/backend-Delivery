import { createPool } from 'mysql2/promise';

export const conn = createPool({
    connectionLimit: 10,
    host: '202.28.34.203',
    user: 'mb68_65011212037',
    password: '2RqCwkcgr*$w',
    database: 'mb68_65011212037'
});