'use strict';
// The published catalog is authoritative. Only private overrides/notes are stored in the browser.
const CalendarStore = (() => {
  const empty = () => ({schema:3,custom:{},overrides:{},hidden:[],notes:{}});
  const flat = days => days.flatMap(d=>d.events.map(event=>({date:d.date,event})));
  const group = items => {
    const map=new Map();
    for(const {date,event} of items){if(!map.has(date))map.set(date,[]);map.get(date).push(event);}
    return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,events])=>({date,events}));
  };
  const forbidden = key => ['__proto__','prototype','constructor'].includes(key);
  const same = (a,b) => a.date===b.date && ['type','text','time','note','source','status','priority','archived','dateBasis'].every(k=>JSON.stringify(a.event[k]??'')===JSON.stringify(b.event[k]??''));
  function validate(value,normalize) {
    if(!value || value.schema!==3)throw Error('지원하지 않는 개인 백업 형식입니다.');
    const state=empty();
    for(const field of ['custom','overrides']){
      if(!value[field] || typeof value[field]!=='object' || Array.isArray(value[field]))throw Error('개인 일정 형식이 올바르지 않습니다.');
      for(const [id,item] of Object.entries(value[field])){
        if(forbidden(id)||!item||!item.event||item.event.id!==id)throw Error('개인 일정 ID가 올바르지 않습니다.');
        const day=normalize([{date:item.date,events:[item.event]}])[0];
        if(!day)throw Error('개인 일정이 비어 있습니다.');
        state[field][id]={date:day.date,event:day.events[0]};
      }
    }
    if(!Array.isArray(value.hidden) || value.hidden.some(id=>typeof id!=='string'||forbidden(id)))throw Error('숨김 일정 형식이 올바르지 않습니다.');
    state.hidden=[...new Set(value.hidden)];
    if(!value.notes||typeof value.notes!=='object'||Array.isArray(value.notes))throw Error('개인 메모 형식이 올바르지 않습니다.');
    for(const [id,note] of Object.entries(value.notes)){
      if(forbidden(id)||typeof note!=='string')throw Error('개인 메모 형식이 올바르지 않습니다.');
      if(note.trim())state.notes[id]=note;
    }
    return state;
  }
  function build(catalog,state) {
    const items=new Map(flat(catalog).filter(x=>!state.hidden.includes(x.event.id)).map(x=>[x.event.id,x]));
    for(const item of Object.values(state.overrides))if(!state.hidden.includes(item.event.id))items.set(item.event.id,{date:item.date,event:{...item.event,localOnly:true}});
    for(const item of Object.values(state.custom))items.set(item.event.id,{date:item.date,event:{...item.event,localOnly:true}});
    return group([...items.values()]);
  }
  function save(catalog,state,date,event,note) {
    if(forbidden(event.id))throw Error('사용할 수 없는 일정 ID입니다.');
    const original=flat(catalog).find(x=>x.event.id===event.id);
    const clean={...event};delete clean.localOnly;
    if(original){
      if(same({date,event:clean},original))delete state.overrides[event.id];
      else state.overrides[event.id]={date,event:clean};
    }else state.custom[event.id]={date,event:clean};
    state.hidden=state.hidden.filter(id=>id!==event.id);
    if(note.trim())state.notes[event.id]=note;else delete state.notes[event.id];
  }
  function remove(catalog,state,id) {
    if(flat(catalog).some(x=>x.event.id===id))state.hidden=[...new Set([...state.hidden,id])];
    else {delete state.custom[id];delete state.notes[id];}
    delete state.overrides[id];
  }
  function restore(state,id){delete state.overrides[id];state.hidden=state.hidden.filter(x=>x!==id);}
  function migrate(saved,previous,catalog) {
    const state=empty(),before=new Map(flat(previous).map(x=>[x.event.id,x])),current=new Map(flat(catalog).map(x=>[x.event.id,x]));
    for(const item of flat(saved)){
      const id=item.event.id;if(id.startsWith('demo-'))continue;
      if(forbidden(id))throw Error('사용할 수 없는 일정 ID입니다.');
      const old=before.get(id),present=current.get(id);
      if(present){
        // Raw v1 data did not have classification fields; compare the original content too.
        const contentMatches=other=>other&&item.date===other.date&&['type','text','time','note','source','status'].every(k=>(item.event[k]||'')===(other.event[k]||''));
        if(same(item,present)||contentMatches(old))continue;
        state.overrides[id]={date:item.date,event:{...item.event,reviewReason:'이전 버전에서 수정한 개인 일정입니다. 공통 일정 복원으로 최신 공개 자료를 적용할 수 있습니다.'}};
      } else state.custom[id]=item;
    }
    return state;
  }
  function mergePrivate(a,b) {
    return {schema:3,custom:{...a.custom,...b.custom},overrides:{...a.overrides,...b.overrides},hidden:[...new Set([...a.hidden,...b.hidden])],notes:{...a.notes,...b.notes}};
  }
  return {empty,flat,group,same,validate,build,save,remove,restore,migrate,mergePrivate};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CalendarStore;
