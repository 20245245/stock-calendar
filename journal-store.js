'use strict';
// Private documents never become part of the public calendar catalog.
const JournalStore = (() => {
  const uuid=()=>globalThis.crypto.randomUUID();
  function validate(n) {
    if(!n || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n.id) || typeof n.title!=='string' || typeof n.body!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.date))throw Error('노트 형식을 확인해 주세요.');
    if(!Number.isFinite(Date.parse(n.date+'T12:00:00Z')) || new Date(n.date+'T12:00:00Z').toISOString().slice(0,10)!==n.date || n.date<'1900-01-01' || n.date>'2100-12-31')throw Error('기록일을 확인해 주세요.');
    if(n.title.length>500 || n.body.length>1000000)throw Error('노트가 너무 큽니다. 본문은 100만 자까지 저장할 수 있습니다.');
    return {id:n.id,title:n.title,body:n.body,date:n.date,eventId:typeof n.eventId==='string'?n.eventId:'',updatedAt:typeof n.updatedAt==='string'?n.updatedAt:new Date().toISOString(),deletedAt:n.deletedAt||null,baseRevision:Number(n.baseRevision)||0,dirty:!!n.dirty,changeId:n.changeId||uuid()};
  }
  const fresh=(date,eventId='',title='')=>validate({id:uuid(),date,eventId,title,body:'',dirty:true});
  const changed=(n,patch)=>validate({...n,...patch,updatedAt:new Date().toISOString(),changeId:uuid(),dirty:true});
  const contentEqual=(a,b)=>['title','body','date','eventId','deletedAt'].every(k=>(a[k]||'')===(b[k]||''));
  const remote=r=>validate({id:r.id,title:r.title,body:r.body,date:r.note_date,eventId:r.event_id,updatedAt:r.updated_at,deletedAt:r.deleted_at,baseRevision:r.revision,dirty:false});
  function reconcile(local,server) {
    if(!local)return {note:server};
    if(!local.dirty)return {note:server};
    if(contentEqual(local,server))return {note:{...local,baseRevision:server.baseRevision,dirty:false}};
    if(local.baseRevision===server.baseRevision)return {note:local};
    // Keep both versions; never silently use last-write-wins for long-form writing.
    return {note:server,conflict:changed({...local,id:uuid(),baseRevision:0},{title:(local.title||'제목 없는 노트')+' · 기기 수정본'})};
  }
  function acknowledged(current,sent,server) {
    if(!current)return server;
    return current.changeId===sent.changeId ? server : {...current,baseRevision:server.baseRevision,dirty:true};
  }
  function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('stock-calendar-journal',1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        db.createObjectStore('notes',{keyPath:['scope','id']});
        db.createObjectStore('history',{keyPath:'key',autoIncrement:true});
        db.createObjectStore('meta',{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(new Repository(request.result));request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('다른 탭을 닫고 다시 열어 주세요.'));
    });
  }
  class Repository {
    constructor(db){this.db=db;}
    run(store,mode,action){return new Promise((resolve,reject)=>{const tx=this.db.transaction(store,mode);let value;const r=action(tx.objectStore(store));if(r)r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장이 중단되었습니다.'));});}
    async list(scope){return (await this.run('notes','readonly',s=>s.getAll(IDBKeyRange.bound([scope,''],[scope,'\uffff'])))).map(({scope,...n})=>n);}
    get(scope,id){return this.run('notes','readonly',s=>s.get([scope,id]));}
    async put(scope,n,snapshot=false){
      n=validate(n);
      return new Promise((resolve,reject)=>{
        const tx=this.db.transaction(['notes','history'],'readwrite'),notes=tx.objectStore('notes');
        const req=notes.get([scope,n.id]);req.onsuccess=()=>{
          const prev=req.result;
          if(snapshot && prev && !contentEqual(prev,n))tx.objectStore('history').add({scope,id:n.id,savedAt:new Date().toISOString(),note:prev});
          notes.put({scope,...n});
        };
        tx.oncomplete=()=>resolve(n);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장이 중단되었습니다.'));
      });
    }
    async history(scope,id){return (await this.run('history','readonly',s=>s.getAll())).filter(r=>r.scope===scope&&r.id===id).sort((a,b)=>b.key-a.key);}
    meta(key){return this.run('meta','readonly',s=>s.get(key));}
    setMeta(key,value){return this.run('meta','readwrite',s=>s.put({key,value}));}
    async export(scope){return {format:'market-journal',version:1,exportedAt:new Date().toISOString(),notes:await this.list(scope),history:(await this.run('history','readonly',s=>s.getAll())).filter(r=>r.scope===scope)};}
  }
  return {uuid,validate,fresh,changed,contentEqual,remote,reconcile,acknowledged,open};
})();
if(typeof module!=='undefined')module.exports=JournalStore;
