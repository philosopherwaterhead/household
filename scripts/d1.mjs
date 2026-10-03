import {DatabaseSync} from "node:sqlite";
export class D1Local {
  constructor(path=":memory:"){this.db=new DatabaseSync(path);}
  prepare(sql){const database=this.db;return{bind(...params){return prepared(database,sql,params);},...prepared(database,sql,[])};}
  async batch(statements){this.db.exec("BEGIN IMMEDIATE");try{const results=[];for(const s of statements)results.push(await s.run());this.db.exec("COMMIT");return results;}catch(e){this.db.exec("ROLLBACK");throw e;}}
  exec(sql){this.db.exec(sql);}
  close(){this.db.close();}
}
function prepared(database,sql,params){return{
  bind(...values){return prepared(database,sql,values);},
  async first(column){const row=database.prepare(sql).get(...params)??null;return column&&row?row[column]:row;},
  async all(){return{success:true,results:database.prepare(sql).all(...params)};},
  async run(){const r=database.prepare(sql).run(...params);return{success:true,meta:{changes:r.changes,last_row_id:r.lastInsertRowid}};}
};}
