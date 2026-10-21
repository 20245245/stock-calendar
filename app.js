'use strict';
const $ = id => document.getElementById(id);
const TYPES = {macro:['경제지표','#81c8d5'],earnings:['실적·매출','#87aefa'],disclosure:['공시·증자','#eeaf7b'],policy:['회의·정책','#bc9bef'],event:['수급·행사','#87dec4']};
const KEY = 'stock-calendar-private-v3';
const LEGACY_KEY = 'market-calendar-v1';
const VERSION = typeof CALENDAR_CATALOG_REVISION==='string'?CALENDAR_CATALOG_REVISION:'2026-10-22.1';
const VIEWS = {core:'핵심',watch:'관심',review:'확인 필요',all:'전체·보관'};
const HELP = {core:'공식 날짜를 확인한 핵심 일정만 표시합니다. 미확정 핵심 후보는 ‘확인 필요’에서 확인하세요.',watch:'관련 종목·업종을 볼 때 선택하는 후보입니다. 미확정 항목은 점선으로 표시합니다.',review:'원문 날짜·기업명·시간대 또는 공식 발표일을 확인해야 합니다. 중요도와 확정 여부는 별도로 관리합니다.',all:'원문 보관용 항목까지 표시합니다. 기본 화면에서 제외한 기존 기록도 여기에서 확인할 수 있습니다.'};
const now = new Date();
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let cursor = new Date(now.getFullYear(),now.getMonth(),1);
let catalogRevision=VERSION, lastCatalogCheck=0, catalogOnline=false, refreshing=false;
let filter = 'all', query = '', view = 'core', editing = null, selectedDate = '', storageOK = true;
const dateValid = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s>='1900-01-01' && s<='2100-12-31' && localDate(new Date(s+'T12:00:00'))===s;
function normalize(input) {
  if (!Array.isArray(input)) throw Error('날짜별 배열 형식의 JSON이 필요합니다.');
  const map = new Map(), seen = new Set(); let n = 0;
  for (const day of input) {
    if (!day || !dateValid(day.date) || !Array.isArray(day.events)) throw Error('날짜 또는 events 배열을 확인해 주세요.');
    for (const e of day.events) {
      if (!e || !TYPES[e.type] || typeof e.text!=='string' || !e.text.trim()) throw Error('일정의 type과 text를 확인해 주세요.');
      if (e.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) throw Error('시각은 HH:MM 형식이어야 합니다.');
      if (e.source && (typeof e.source!=='string' || !/^https?:\/\//i.test(e.source))) throw Error('출처는 http 또는 https 링크여야 합니다.');
      let id = typeof e.id==='string' && e.id ? e.id : `event-${day.date}-${n++}`;
      if (['__proto__','prototype','constructor'].includes(id))throw Error('사용할 수 없는 일정 ID입니다.');
      if (seen.has(id)) throw Error('중복된 일정 ID가 있습니다.'); seen.add(id);
      const ev = {
        id, type:e.type, text:e.text.trim(), time:e.time||'', note:String(e.note||''), source:e.source||'',
        status:e.status==='confirmed'?'confirmed':'unconfirmed', priority:e.priority==='core'?'core':'watch',
        localOnly:e.localOnly===true, archived:e.archived===true, dateBasis:['KST','local'].includes(e.dateBasis)?e.dateBasis:'unresolved',
        priorityReason:String(e.priorityReason||''), reviewReason:String(e.reviewReason||''),
        originalDate:String(e.originalDate||''), originalText:String(e.originalText||''), updatedAt:String(e.updatedAt||'')
      };
      if (!map.has(day.date)) map.set(day.date,[]); map.get(day.date).push(ev);
    }
  }
  return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,events])=>({date,events:events.sort((a,b)=>(a.time||'99').localeCompare(b.time||'99') || a.text.localeCompare(b.text))}));
}
let catalog = normalize(CALENDAR_DATA);
let privateState=CalendarStore.empty();
let data=[];
try {
  const saved=localStorage.getItem(KEY);
  if(saved!==null)privateState=CalendarStore.validate(JSON.parse(saved),normalize);
  else {
    const v2=localStorage.getItem('market-calendar-v2');
    const legacy=v2||localStorage.getItem(LEGACY_KEY);
    if(legacy!==null){
      const parsed=JSON.parse(legacy),days=normalize(v2?parsed.days:parsed);
      localStorage.setItem(KEY+'-before-migration',legacy);
      privateState=CalendarStore.migrate(days,normalize(CALENDAR_PREVIOUS),catalog);
      localStorage.setItem(KEY,JSON.stringify(privateState));
      $('message').textContent='이전 개인 변경을 보존했습니다. 공통 일정은 앞으로 자동 갱신됩니다.';
    }
  }
} catch(e) {
  storageOK=false;
  $('message').textContent='기존 개인 저장 데이터를 읽지 못했습니다. 원본을 덮어쓰지 않고 공통 일정을 표시합니다.';
}
function msg(s){$('message').textContent=s;}
function rebuild(){data=normalize(CalendarStore.build(catalog,privateState));}
function saveStateLabel(){
  $('saveState').textContent=(catalogOnline?'공통 일정 '+catalogRevision:'기본 자료 '+catalogRevision)+(storageOK?'':' · 개인 저장 불가');
}
function persist(){
  try {
    if(!storageOK)throw Error();
    localStorage.setItem(KEY,JSON.stringify(privateState));
  } catch(e){msg('개인 저장을 사용할 수 없습니다. 닫기 전에 개인 백업을 내려받아 주세요.');}
  rebuild();saveStateLabel();render();
}
async function refreshCatalog(manual=false){
  if(refreshing)return;
  refreshing=true;$('refresh').disabled=true;
  try{
    const response=await fetch('./data/calendar.json',{cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const payload=await response.json();
    if(payload.version!==1||typeof payload.revision!=='string')throw Error('자료 형식 오류');
    const incoming=normalize(payload.events),changed=payload.revision!==catalogRevision;
    catalog=incoming;catalogRevision=payload.revision;catalogOnline=true;
    rebuild();saveStateLabel();render();
    if(manual)msg(changed?'공통 일정을 최신 버전으로 갱신했습니다. 개인 메모는 유지됩니다.':'최신 공통 일정입니다. 개인 메모는 이 기기에 보관됩니다.');
  }catch(e){
    if(manual)msg('공통 일정에 연결하지 못했습니다. 현재 자료와 개인 메모는 그대로 표시합니다.');
  }finally{refreshing=false;lastCatalogCheck=Date.now();$('refresh').disabled=false;saveStateLabel();}
}
rebuild();
function el(tag,text,cls) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function inView(e,target=view) {
  if(target==='all')return true;
  if(e.archived)return false;
  if(target==='core')return e.priority==='core' && e.status==='confirmed' && e.dateBasis!=='unresolved';
  if(target==='watch')return e.priority==='watch';
  return e.status!=='confirmed' || e.dateBasis==='unresolved';
}
function matches(e) {return inView(e) && (filter==='all'||e.type===filter) && (!query||`${e.text} ${e.note}`.toLowerCase().includes(query));}
function labels(e) {return `${e.localOnly?'내 변경 · ':''}${e.priority==='core'?'핵심':'관심'} · ${e.archived?'보관':e.status==='confirmed'?(e.dateBasis==='unresolved'?'시간대 확인':'확인됨'):'미확정'}`;}
function eventButton(e) {
  const b=el('button',undefined,'event'+(e.status!=='confirmed'?' unconfirmed':'')+(e.archived?' archived':''));
  b.style.setProperty('--color',TYPES[e.type][1]);
  b.append(el('span',labels(e)+' · '+TYPES[e.type][0],'eventtype'));
  if(e.time)b.append(el('span',e.time+' KST','eventtime'));
  else if(e.dateBasis!=='KST')b.append(el('span',e.dateBasis==='local'?'현지 종일·거래일':'날짜·시간대 확인 필요','basis'));
  b.append(el('div',e.text)); b.onclick=()=>openEditor(findDate(e.id),e);return b;
}
function findDate(id) {return data.find(d=>d.events.some(e=>e.id===id))?.date;}
function render() {
  $('month').textContent=`${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;
  const prefix=localDate(cursor).slice(0,7),monthEvents=data.filter(d=>d.date.startsWith(prefix)).flatMap(d=>d.events);
  $('total').textContent=monthEvents.filter(e=>inView(e,'core')).length;
  $('earnings').textContent=monthEvents.filter(e=>inView(e,'watch')).length;
  $('macro').textContent=monthEvents.filter(e=>inView(e,'review')).length;
  $('views').replaceChildren();
  for(const [key,label] of Object.entries(VIEWS)){
    const b=el('button',label+' '+monthEvents.filter(e=>inView(e,key)).length,key===view?'active':'');
    b.setAttribute('aria-pressed',String(key===view));b.onclick=()=>{view=key;render();};$('views').append(b);
  }
  $('viewHelp').textContent=HELP[view];
  $('filters').replaceChildren();
  for(const [key,label] of [['all','전체 유형'],...Object.entries(TYPES).map(([k,v])=>[k,v[0]])]) {
    const b=el('button',label,key===filter?'active':'');b.setAttribute('aria-pressed',String(key===filter));
    if(key!=='all'){const dot=el('span',undefined,'legend');dot.style.setProperty('--color',TYPES[key][1]);b.prepend(dot);}
    b.onclick=()=>{filter=key;render();};$('filters').append(b);
  }
  const grid=$('grid');grid.replaceChildren();
  const start=new Date(cursor);start.setDate(1-start.getDay());
  const days=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate(),cells=Math.ceil((cursor.getDay()+days)/7)*7;
  for(let i=0;i<cells;i++) {
    const d=new Date(start);d.setDate(start.getDate()+i);
    const iso=localDate(d),events=(data.find(x=>x.date===iso)?.events||[]).filter(matches);
    const cell=el('div',undefined,'day'+(d.getMonth()!==cursor.getMonth()?' other':'')+(iso===localDate(now)?' current':'')+(i%7===0?' sun':i%7===6?' sat':''));
    const head=el('div',undefined,'dayhead'),number=el('button',d.getDate(),'number');
    number.setAttribute('aria-label',`${iso} 일정 보기`);number.onclick=()=>showDay(iso);
    head.append(number,el('span',events.length?events.length+'건':'','daycount'));cell.append(head);
    const list=el('div',undefined,'events');events.forEach(e=>list.append(eventButton(e)));cell.append(list);grid.append(cell);
  }
  $('result').textContent=`${VIEWS[view]} · 이번 달 ${monthEvents.filter(matches).length}건 표시 / 활성 ${monthEvents.filter(e=>!e.archived).length}건 · 날짜를 누르면 현재 보기의 상세 일정`;
  document.querySelector('.notice').hidden=!data.some(d=>d.events.some(e=>e.id.startsWith('demo-')));
}
function showDay(date) {
  selectedDate=date;$('dayTitle').textContent=date.replaceAll('-','. ')+' · '+VIEWS[view];$('dayEvents').replaceChildren();
  const all=data.find(d=>d.date===date)?.events||[],events=all.filter(matches);
  if(!events.length)$('dayEvents').append(el('p','현재 조건에 표시할 일정이 없습니다.'));
  if(all.length!==events.length){const b=el('button',`이날 전체 ${all.length}건 보기`,'alllink');b.onclick=()=>{view='all';filter='all';query='';$('search').value='';render();$('dayDialog').close();showDay(date);};$('dayEvents').append(b);}
  for(const e of events) {
    const box=el('article',undefined,'detail');
    box.append(el('small',`${labels(e)} · ${TYPES[e.type][0]}${e.time?' · '+e.time+' KST':''}`),el('h3',e.text));
    if(e.dateBasis!=='KST')box.append(el('p',e.dateBasis==='local'?'현지 종일·거래일 기준입니다.':'원문 임시 날짜입니다. 한국시간 기준 날짜 확인이 필요합니다.','review'));
    if(e.reviewReason)box.append(el('p',e.reviewReason,'review'));
    if(e.priorityReason)box.append(el('p','선별 이유: '+e.priorityReason));
    if(e.note)box.append(el('p',e.note));
    if(privateState.notes[e.id])box.append(el('p','내 메모: '+privateState.notes[e.id],'personalnote'));
    if(e.source){const link=el('a','출처 확인 ↗');link.href=e.source;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
    const edit=el('button','수정');edit.style.marginLeft='12px';edit.onclick=()=>openEditor(date,e);box.append(edit);$('dayEvents').append(box);
  }
  $('dayDialog').showModal();
}
function openEditor(date,event) {
  if($('dayDialog').open)$('dayDialog').close();editing=event?.id||null;$('eventForm').reset();
  $('editorTitle').textContent=event?'일정 수정':'일정 추가';$('date').value=date;$('type').value=event?.type||'earnings';
  for(const field of ['time','note','source','status','priority','dateBasis'])$(field).value=event?.[field]||({status:'unconfirmed',priority:'watch',dateBasis:'KST'}[field]||'');
  $('personalNote').value=privateState.notes[event?.id]||'';$('restore').hidden=!event||!CalendarStore.flat(catalog).some(x=>x.event.id===event.id);$('archived').checked=event?.archived===true;$('title').value=event?.text||'';$('delete').hidden=!event;$('editor').showModal();
}
$('eventForm').onsubmit=e=>{
  e.preventDefault();if(!dateValid($('date').value))return msg('유효한 날짜를 입력해 주세요.');
  if($('source').value&&!/^https?:\/\//i.test($('source').value)){alert('출처 링크는 http 또는 https 주소를 입력해 주세요.');return;}
  if(!$('title').value.trim())return;
  const prior=data.flatMap(d=>d.events).find(e=>e.id===editing)||{};
  const event={...prior,id:editing||`event-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,type:$('type').value,text:$('title').value.trim(),time:$('time').value,note:$('note').value,source:$('source').value,status:$('status').value,priority:$('priority').value,dateBasis:$('dateBasis').value,archived:$('archived').checked,updatedAt:localDate(new Date())};
  if(event.status==='confirmed')event.reviewReason='';
  CalendarStore.save(catalog,privateState,$('date').value,event,$('personalNote').value);
  cursor=new Date($('date').value+'T12:00:00');cursor.setDate(1);persist();$('editor').close();
  msg(event.priority==='core'&&event.status!=='confirmed'?'저장했습니다. 미확정 핵심 일정은 확인 필요 탭에 표시됩니다.':'이 기기의 개인 일정·메모를 저장했습니다.');
};
$('delete').onclick=()=>{if(confirm('이 기기에서 이 일정을 숨기거나 내 일정을 삭제할까요?')){CalendarStore.remove(catalog,privateState,editing);persist();$('editor').close();msg('이 기기에 반영했습니다. 공통 자료는 유지됩니다.');}};
$('restore').onclick=()=>{CalendarStore.restore(privateState,editing);persist();$('editor').close();msg('최신 공통 일정으로 되돌렸습니다. 개인 메모는 유지됩니다.');};
for(const [k,v] of Object.entries(TYPES))$('type').append(new Option(v[0],k));
$('add').onclick=()=>openEditor(localDate(cursor.getFullYear()===now.getFullYear()&&cursor.getMonth()===now.getMonth()?now:cursor));
$('dayAdd').onclick=()=>openEditor(selectedDate);
for(const id of ['prev','next'])$(id).onclick=()=>{const target=new Date(cursor.getFullYear(),cursor.getMonth()+(id==='prev'?-1:1),1);if(target.getFullYear()>=1900&&target.getFullYear()<=2100){cursor=target;render();}};
$('today').onclick=()=>{cursor=new Date(now.getFullYear(),now.getMonth(),1);render();};
$('search').oninput=e=>{query=e.target.value.trim().toLowerCase();render();};
$('rules').onclick=()=>$('rulesDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('export').onclick=()=>{
  const blob=new Blob([JSON.stringify(privateState,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download=`stock-calendar-${localDate(new Date())}.private.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);msg('이 기기의 개인 일정·메모를 백업했습니다.');
};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{
  try{
    const file=e.target.files[0];if(!file)return;
    const raw=JSON.parse(await file.text());
    const incoming=Array.isArray(raw)?CalendarStore.migrate(normalize(raw),normalize(CALENDAR_PREVIOUS),catalog):CalendarStore.validate(raw,normalize);
    if(!confirm('개인 백업을 이 기기에 병합합니다. 공통 일정은 GitHub의 최신 자료를 유지하고, 같은 ID의 개인 변경·메모는 가져온 값으로 바꿉니다. 계속할까요?'))return;
    localStorage.setItem(KEY+'-before-import',JSON.stringify(privateState));
    privateState=CalendarStore.mergePrivate(privateState,incoming);storageOK=true;persist();msg('개인 백업을 복원했습니다. 공통 일정은 최신 자료를 유지합니다.');
  }catch(err){msg('복원 실패: '+err.message);}finally{e.target.value='';}
};
$('clearDemo').onclick=()=>{msg('이 버전에는 공개 예시 일정이 없습니다.');};
$('refresh').onclick=()=>refreshCatalog(true);
window.addEventListener('focus',()=>{if(Date.now()-lastCatalogCheck>60000)refreshCatalog();});
render();saveStateLabel();refreshCatalog();
