// Atomic compare-and-swap preserves pairing and command claims across Workers.
// Runtime uses DML only; Drizzle migrations own the schema.
export class D1Store {
  constructor(db){this.db=db;}
  async transaction(fn){
    for(let attempt=0;attempt<8;attempt++){
      const row=await this.db.prepare("SELECT revision, value FROM gearshift_state WHERE id = 1").first();
      if(!row){await this.db.prepare("INSERT OR IGNORE INTO gearshift_state (id, revision, value) VALUES (1, 0, ?)").bind(JSON.stringify({pairs:{},devices:{},commands:{}})).run();continue;}
      const state=JSON.parse(row.value),now=Date.now();
      for(const [id,p]of Object.entries(state.pairs))if(p.expires<now)delete state.pairs[id];
      for(const [id,c]of Object.entries(state.commands))if(c.expires<now-86400000)delete state.commands[id];
      const before=JSON.stringify(state),result=await fn(state),value=JSON.stringify(state);
      if(value.length>1000000)throw Error("preview_capacity_reached");
      // Read-only operations have a consistent snapshot and don't need a write.
      if(value===before)return result;
      const update=await this.db.prepare("UPDATE gearshift_state SET revision = revision + 1, value = ? WHERE id = 1 AND revision = ?").bind(value,row.revision).run();
      if(update.meta.changes===1)return result;
    }
    throw Error("state_busy");
  }
}
