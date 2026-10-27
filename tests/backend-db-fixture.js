// Destructive tests create/drop only randomly named databases on an explicitly
// opted-in loopback PostgreSQL server. Never fall back to DATABASE_URL.
const crypto = require('node:crypto');
class TestDatabase {
 constructor() { this.ready=this.open(); }
 async open() {
  const url=new URL(process.env.BACKEND_TEST_DATABASE_URL);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Only disposable loopback PostgreSQL servers are allowed');
  const {Client,Pool}=require('pg');
  this.admin=new Client({connectionString:url.toString()}); await this.admin.connect();
  this.name='shop_backend_test_'+crypto.randomBytes(12).toString('hex');
  await this.admin.query(`CREATE DATABASE ${this.name}`);
  url.pathname='/'+this.name;
  this.pool=new Pool({connectionString:url.toString(),max:8});
 }
 async query(sql,params) {await this.ready; return this.pool.query(sql,params);}
 async exec(sql) {return this.query(sql);}
 async close() {await this.ready; await this.pool.end(); await this.admin.query(`DROP DATABASE ${this.name}`); await this.admin.end();}
}
module.exports={TestDatabase};
