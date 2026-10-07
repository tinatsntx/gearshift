import pg from "pg";
const empty=()=>({clients:{},flows:{},codes:{},tokens:{},users:{},pairs:{},devices:{},commands:{}});
// A locked singleton keeps one-use pairing, OAuth codes and command claims
// atomic across web instances. Suitable for the bounded private preview.
export class PostgresStore {
  constructor(url){this.pool=new pg.Pool({connectionString:url,max:4});}
  async init(){await this.pool.query("CREATE TABLE IF NOT EXISTS gearshift_state(id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL)");await this.pool.query("INSERT INTO gearshift_state VALUES(1,$1) ON CONFLICT DO NOTHING",[empty()]);}
  async transaction(fn){const c=await this.pool.connect();try{await c.query("BEGIN");const {rows}=await c.query("SELECT data FROM gearshift_state WHERE id=1 FOR UPDATE");const data=rows[0].data,result=await fn(data);await c.query("UPDATE gearshift_state SET data=$1 WHERE id=1",[data]);await c.query("COMMIT");return result;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
}
export class MemoryStore {
  constructor(){this.data=empty();this.tail=Promise.resolve();}
  transaction(fn){const run=this.tail.then(async()=>{const copy=structuredClone(this.data);const result=await fn(copy);this.data=copy;return result;});this.tail=run.catch(()=>{});return run;}
}
