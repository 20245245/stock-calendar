'use strict';
(async()=>{
  const S=JournalStore,cloud=new JournalCloud.Client(window.JOURNAL_CLOUD||{});
  let writeCount=0;
  let repo,scope='local',user=null,notes=[],active=null,timer=null,pending=null,saving=Promise.resolve(),syncing=false,readMode=false,lastSnapshot=0,mode='calendar';
  const node=id=>document.getElementById(id);
  const say=s=>{node('journalStatus').textContent=s;};
  const report=s=>{node('noteSaveStatus').textContent=s;};
  const dateToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const formatTime=s=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  function status(){say(user?'계정 노트 · 동기화 사용':'이 기기에 저장 · 동기화 미연결');node('cloudAccount').textContent=user?'계정 · 동기화':'동기화 설정';}
  function switchMode(next){mode=next;node('calendarWorkspace').hidden=next!=='calendar';node('journalWorkspace').hidden=next!=='journal';for(const key of ['calendar','journal']){node(key+'Tab').classList.toggle('active',next===key);node(key+'Tab').setAttribute('aria-pressed',String(next===key));}if(next==='journal')renderLibrary();}
  function visibleNotes(){return notes.filter(n=>!n.deletedAt);}
  async function reload(){notes=await repo.list(scope);node('noteCount').textContent=visibleNotes().length;renderLibrary();render();}
  function renderLibrary(){
    const list=node('notesList');list.replaceChildren();const q=node('noteSearch').value.toLowerCase(),trash=node('noteListMode').value==='trash';
    const rows=notes.filter(n=>!!n.deletedAt===trash&&`${n.title}\n${n.body}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt));
    if(!rows.length){const empty=el('div',undefined,'journal-empty');empty.append(el('span',trash?'↺':'✎','empty-symbol'),el('h3',q?'검색 결과가 없습니다.':trash?'휴지통이 비어 있습니다.':'생각을 쌓는 첫 페이지'),el('p',q?'다른 단어로 찾아보세요.':trash?'삭제한 노트는 이곳에서 복구할 수 있습니다.':'긴 시장 리뷰를 붙여넣거나, 오늘의 관점을 기록해 보세요.'));
      if(!q&&!trash){const b=el('button','첫 노트 쓰기','primary');b.onclick=()=>newNote();empty.append(b);}list.append(empty);return;}
    for(const n of rows){
      const card=el('article',undefined,'note-card'),open=el('button',undefined,'note-card-open');
      open.append(el('small',n.date+(n.eventId?' · 일정 연결':'')),el('h3',n.title||'제목 없는 노트'),el('p',n.body.slice(0,180)||'본문을 작성해 보세요.'));
      const meta=el('span',formatTime(n.updatedAt)+(user?(n.dirty?' · 업로드 대기':' · 동기화됨'):''),'note-card-meta');open.append(meta);
      open.onclick=()=>openNote(n.id);card.append(open);
      if(trash){const b=el('button','복구');b.onclick=async()=>{try{await repo.put(scope,S.changed(n,{deletedAt:null}),true);await reload();scheduleSync();}catch(e){say('복구 실패: '+e.message);}};card.append(b);}list.append(card);
    }
  }
  function preview(){
    // Render only a small text-safe Markdown subset. Never interpret pasted HTML.
    const root=node('notePreview');root.replaceChildren();
    const inline=(parent,text)=>{const chunks=text.split(/(\*\*[^*]+\*\*)/g);for(const chunk of chunks){if(chunk.startsWith('**')&&chunk.endsWith('**'))parent.append(el('b',chunk.slice(2,-2)));else parent.append(document.createTextNode(chunk));}};
    let paragraph=[];const flush=()=>{if(paragraph.length){const p=el('p');inline(p,paragraph.join('\n'));root.append(p);paragraph=[];}};
    for(const line of node('noteBody').value.split('\n')){
      if(/^#{1,3} /.test(line)){flush();const level=line.match(/^#+/)[0].length;const h=el('h'+(level+1));inline(h,line.replace(/^#+ /,''));root.append(h);}
      else if(/^> /.test(line)){flush();const p=el('blockquote');inline(p,line.slice(2));root.append(p);}
      else if(/^- /.test(line)){flush();const p=el('p',undefined,'bullet-line');inline(p,'• '+line.slice(2));root.append(p);}
      else if(!line.trim())flush();else paragraph.push(line);
    }flush();
  }
  function counts(){node('noteWords').textContent=node('noteBody').value.length.toLocaleString()+'자 · '+(user?'계정 노트':'기기 노트');if(readMode)preview();}
  function updatePending(){
    if(!active||active.deletedAt)return;
    if(!dateValid(node('noteDate').value)){report('기록일을 확인해 주세요.');return;}
    active=S.changed(active,{title:node('noteTitle').value,body:node('noteBody').value,date:node('noteDate').value});
    pending={scope,note:{...active}};report('저장 중…');counts();clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),600);
  }
  async function flush(forceSnapshot=false){
    clearTimeout(timer);const task=pending;pending=null;
    if(task){const snapshot=forceSnapshot||Date.now()-lastSnapshot>60000;if(snapshot)lastSnapshot=Date.now();
      writeCount++;saving=saving.catch(()=>{}).then(async()=>{
        try{await repo.put(task.scope,task.note,snapshot);if(scope===task.scope){const i=notes.findIndex(n=>n.id===task.note.id);if(i>=0)notes[i]=task.note;else notes.push(task.note);}
          if(active?.id===task.note.id&&!pending)report(user?'기기에 저장됨 · 업로드 대기':'이 기기에 저장됨');
          scheduleSync();
        }catch(e){if(!pending&&active?.id===task.note.id&&active.changeId===task.note.changeId)pending=task;report('저장 실패 · 창을 닫지 말고 본문을 복사해 주세요.');say('노트 저장 실패: '+e.message);throw e;}finally{writeCount--;}
      });
    }
    await saving;
  }
  async function openNote(id){
    await flush(true);await reload();const n=notes.find(x=>x.id===id);if(!n)return;
    active={...n};lastSnapshot=0;node('noteTitle').value=n.title;node('noteDate').value=n.date;node('noteBody').value=n.body;
    const event=data.flatMap(d=>d.events).find(e=>e.id===n.eventId);
    node('noteEvent').textContent=event?((event.time?event.time+' KST · ':'')+event.text):n.eventId?'연결된 일정 노트':'자유 노트';
    const source=node('noteSource');source.hidden=!event?.source;if(event?.source)source.href=event.source;
    node('noteBody').readOnly=!!n.deletedAt;node('noteTitle').readOnly=!!n.deletedAt;node('noteDate').disabled=!!n.deletedAt;node('trashNote').hidden=!!n.deletedAt;
    readMode=false;node('noteBody').hidden=false;node('notePreview').hidden=true;node('togglePreview').textContent='읽기 모드';node('togglePreview').setAttribute('aria-pressed','false');counts();
    report(n.deletedAt?'휴지통 · 목록에서 복구할 수 있습니다.':user?(n.dirty?'기기에 저장됨 · 업로드 대기':'동기화됨'):'이 기기에 저장됨');
    if(!node('noteDialog').open)node('noteDialog').showModal();node('noteBody').scrollTop=0;node('noteBody').focus();
  }
  async function newNote(date=dateToday(),eventId='',title=''){
    try{await flush(true);const n=S.fresh(date,eventId,title);await repo.put(scope,n);await reload();await openNote(n.id);}catch(e){say('노트를 열지 못했습니다: '+e.message);}
  }
  async function openEvent(date,event){const n=visibleNotes().find(n=>n.eventId===event.id);if(n)return openNote(n.id);return newNote(event.datePrecision==='month'?dateToday():date,event.id,event.text);}
  async function closeNote(){try{await flush(true);node('noteDialog').close();active=null;await reload();}catch{}}
  let syncTimer;
  function scheduleSync(){if(user){clearTimeout(syncTimer);syncTimer=setTimeout(sync,5000);}}
  async function applyRemote(server){
    const local=await repo.get(scope,server.id);
    // A focused editor may hold newer in-memory text. Flush it before merging.
    const result=S.reconcile(local,server);
    await repo.put(scope,result.note,!!local&&!S.contentEqual(local,result.note));
    if(result.conflict){await repo.put(scope,result.conflict);say('다른 기기의 수정과 겹쳐 기기 수정본을 별도 보관했습니다.');}
    return result;
  }
  async function sync(){
    if(syncing||!user||!navigator.onLine)return;
    syncing=true;node('syncNow').disabled=true;const syncScope=scope;
    try{
      await flush();await cloud.user();say('노트 동기화 중…');
      const rows=await cloud.list();
      // Queue new editor writes before applying incoming changes.
      await flush();
      for(const row of rows)await applyRemote(S.remote(row));
      const dirty=(await repo.list(scope)).filter(n=>n.dirty);
      for(const sent of dirty){
        const result=await cloud.save(sent),server=S.remote(result.note);
        await flush();
        if(result.conflict)await applyRemote(server);
        else{const current=await repo.get(scope,sent.id);await repo.put(scope,S.acknowledged(current,sent,server));}
      }
      await reload();
      const left=notes.some(n=>n.dirty);say(left?'기기에 저장됨 · 다음 동기화 대기':'동기화됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
      if(active){
        const saved=notes.find(n=>n.id===active.id);
        // Only refresh editor text if it still matches the saved draft. Otherwise preserve active input.
        if(saved&&!pending){active={...saved};node('noteTitle').value=saved.title;node('noteBody').value=saved.body;node('noteDate').value=saved.date;counts();report(saved.dirty?'기기에 저장됨 · 업로드 대기':'동기화됨');}
      }
      if(left)scheduleSync();
    }catch(e){say('기기에 저장됨 · 동기화 실패: '+e.message);if(active)report('기기에 저장됨 · 동기화 재시도 필요');}
    finally{syncing=false;node('syncNow').disabled=false;if(scope!==syncScope)status();}
  }
  function account(){
    node('accountStatus').textContent=user?user.email:cloud.configured?'이메일로 로그인하면 여러 기기에서 같은 노트를 열 수 있습니다.':'클라우드 저장소 연결 준비 중입니다. 지금 작성한 노트는 이 기기에 저장됩니다.';
    node('loginForm').hidden=!!user||!cloud.configured;node('codeForm').hidden=true;node('signedInActions').hidden=!user;node('accountMessage').textContent='';node('accountDialog').showModal();
  }
  async function enterAccount(u){
    await flush(true);node('noteDialog').close();active=null;user=u;scope='user:'+u.id;await reload();status();await sync();
  }
  async function migrateLegacy(force=false){
    if(!force&&await repo.meta('legacy-v3-imported'))return;
    // Import only this browser's own legacy notes, without transmitting anything.
    const existing=await repo.list('local');
    for(const [eventId,body] of Object.entries(privateState.notes)){
      if(existing.some(n=>n.eventId===eventId&&n.body===body))continue;
      const item=CalendarStore.flat(data).find(x=>x.event.id===eventId),n=S.fresh(item?.date||dateToday(),eventId,item?.event.text||'이전 일정 메모');
      n.body=body;await repo.put('local',n);
    }
    await repo.setMeta('legacy-v3-imported',true);
  }
  function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  try{
    repo=await S.open();await migrateLegacy();await reload();status();
  }catch(e){say('노트 저장소를 열지 못했습니다: '+e.message);for(const id of ['newNote','newNoteLibrary'])node(id).disabled=true;return;}
  window.MarketJournal={openEvent,newNote,importLegacy:async()=>{await migrateLegacy(true);await reload();},hasEvent:id=>visibleNotes().some(n=>n.eventId===id),dayLinks:(date,parent)=>{
    const list=visibleNotes().filter(n=>n.date===date&&!n.eventId);
    for(const n of list.slice(0,2)){const b=el('button','✎ '+(n.title||'제목 없는 노트'),'day-note');b.onclick=()=>openNote(n.id);parent.append(b);}
    if(list.length>2){const b=el('button','노트 '+list.length+'건','day-more');b.onclick=()=>{switchMode('journal');node('noteSearch').value='';renderLibrary();};parent.append(b);}
  }};
  for(const id of ['newNote','newNoteLibrary'])node(id).onclick=()=>newNote();
  node('calendarTab').onclick=()=>switchMode('calendar');node('journalTab').onclick=()=>switchMode('journal');
  node('noteSearch').oninput=renderLibrary;node('noteListMode').onchange=renderLibrary;
  for(const id of ['noteTitle','noteBody','noteDate'])node(id).addEventListener('input',updatePending);
  node('saveNote').onclick=async()=>{try{await flush(true);if(user)await sync();else report('이 기기에 저장됨');}catch{}};
  node('closeNote').onclick=closeNote;node('noteDialog').addEventListener('cancel',e=>{e.preventDefault();closeNote();});
  node('togglePreview').onclick=()=>{readMode=!readMode;node('noteBody').hidden=readMode;node('notePreview').hidden=!readMode;node('togglePreview').textContent=readMode?'계속 쓰기':'읽기 모드';node('togglePreview').setAttribute('aria-pressed',String(readMode));preview();};
  document.querySelectorAll('[data-insert]').forEach(b=>b.onclick=()=>{
    if(active?.deletedAt)return;const t=node('noteBody'),a=t.selectionStart,z=t.selectionEnd,selection=t.value.slice(a,z),kind=b.dataset.insert;
    const text=kind==='bold'?'**'+(selection||'강조할 내용')+'**':(a&&t.value[a-1]!=='\n'?'\n':'')+({heading:'## ',list:'- ',quote:'> '}[kind])+(selection||'');
    t.setRangeText(text,a,z,'end');if(readMode)node('togglePreview').click();t.focus();updatePending();
  });
  node('trashNote').onclick=async()=>{if(!active)return;try{await flush(true);active=S.changed(active,{deletedAt:new Date().toISOString()});await repo.put(scope,active,true);pending=null;node('noteDialog').close();active=null;await reload();scheduleSync();}catch(e){report('삭제하지 못했습니다: '+e.message);}};
  node('noteHistory').onclick=async()=>{
    try{await flush(true);const container=node('historyList');container.replaceChildren();let records=await repo.history(scope,active.id);
      if(user){try{await cloud.user();const rows=await cloud.history(active.id);records.push(...rows.map(r=>({savedAt:r.saved_at,note:{...active,...S.remote({...r,id:r.note_id})}})));}catch(e){container.append(el('p','기기 이력만 표시합니다. 클라우드 이력: '+e.message));}}
      const seen=new Set();records=records.filter(r=>{const k=JSON.stringify([r.note.title,r.note.body,r.note.date]);if(seen.has(k))return false;seen.add(k);return true;});
      if(!records.length)container.append(el('p','아직 이전 저장 내용이 없습니다. 작성 중에는 약 1분 간격과 노트를 닫을 때 복구 지점을 남깁니다.'));
      for(const r of records.slice(0,50)){const box=el('article',undefined,'history-item');box.append(el('small',formatTime(r.savedAt)),el('h3',r.note.title||'제목 없는 노트'),el('p',r.note.body.slice(0,160)));const restore=el('button','이 내용으로 복구');restore.onclick=async()=>{try{active=S.changed(active,{title:r.note.title,body:r.note.body,date:r.note.date});await repo.put(scope,active,true);node('historyDialog').close();await reload();await openNote(active.id);scheduleSync();}catch(e){report('복구 실패: '+e.message);}};box.append(restore);container.append(box);}node('historyDialog').showModal();
    }catch(e){report('이력을 열지 못했습니다: '+e.message);}
  };
  node('exportNotes').onclick=async()=>{try{await flush(true);download(await repo.export(scope),'market-journal-'+dateToday()+'.private.json');say('노트와 복구 이력을 파일로 백업했습니다.');}catch(e){say('백업 실패: '+e.message);}};
  node('importNotes').onclick=()=>node('notesFile').click();
  node('notesFile').onchange=async e=>{
    try{const file=e.target.files[0];if(!file)return;const value=JSON.parse(await file.text());
      if(value.format!=='market-journal'||value.version!==1||!Array.isArray(value.notes))throw Error('지원하지 않는 노트 백업입니다.');
      const incoming=value.notes.map(S.validate),history=Array.isArray(value.history)?value.history.map(r=>S.validate(r.note)):[];
      const backup=await repo.export(scope);download(backup,'market-journal-before-import-'+dateToday()+'.private.json');
      for(const n of incoming){const existing=await repo.get(scope,n.id);if(existing&&S.contentEqual(existing,n))continue;
        await repo.put(scope,S.changed({...n,id:existing?S.uuid():n.id,baseRevision:0},{title:n.title+(existing?' · 백업 복원본':'')}));}
      // Restore historical versions as separate documents so nothing is silently discarded.
      for(const n of history)await repo.put(scope,S.changed({...n,id:S.uuid(),baseRevision:0},{title:(n.title||'노트')+' · 백업 이력',deletedAt:n.deletedAt}));
      await reload();scheduleSync();say('백업을 복원했습니다. 겹치는 글은 별도 복원본으로 보관했습니다.');
    }catch(err){say('복원 실패: '+err.message);}finally{e.target.value='';}
  };
  node('cloudAccount').onclick=account;
  node('loginForm').onsubmit=async e=>{e.preventDefault();node('sendCode').disabled=true;try{await cloud.sendCode(node('loginEmail').value.trim());node('codeForm').hidden=false;node('accountMessage').textContent='인증 코드가 있으면 입력하세요. 링크만 있는 메일은 버튼의 링크 주소를 복사해 붙여넣으세요. 링크를 직접 클릭할 필요는 없습니다.';}catch(err){node('accountMessage').textContent=err.message;}finally{node('sendCode').disabled=false;}};
  node('codeForm').onsubmit=async e=>{e.preventDefault();try{const u=await cloud.verify(node('loginEmail').value.trim(),node('loginCode').value.trim());await enterAccount(u);node('accountDialog').close();}catch(err){node('accountMessage').textContent='로그인 실패: '+err.message;}};
  node('logout').onclick=async()=>{if(syncing)return;try{await flush(true);if(notes.some(n=>n.dirty)&&!confirm('아직 업로드하지 못한 노트는 이 기기에 남습니다. 로그아웃할까요?'))return;await cloud.signOut();node('noteDialog').close();active=null;user=null;scope='local';await reload();status();node('accountDialog').close();}catch(e){node('accountMessage').textContent=e.message;}};
  node('syncNow').onclick=()=>sync();
  node('uploadLocal').onclick=async()=>{
    if(syncing)return;try{const locals=await repo.list('local');if(!locals.length){node('accountMessage').textContent='가져올 기기 노트가 없습니다.';return;}
      if(!confirm('이 기기 노트 '+locals.length+'건을 '+user.email+' 계정으로 복사할까요?'))return;
      for(const n of locals){const current=await repo.get(scope,n.id);if(current){if(S.contentEqual(current,n))continue;await repo.put(scope,S.changed({...n,id:S.uuid(),baseRevision:0},{title:n.title+' · 기기 가져오기'}));}else await repo.put(scope,S.changed({...n,baseRevision:0},{}));}
      await reload();await sync();node('accountMessage').textContent='기기 노트를 계정에 복사했습니다. 기기 원본도 유지됩니다.';
    }catch(e){node('accountMessage').textContent='가져오기 실패: '+e.message;}
  };
  window.addEventListener('beforeunload',e=>{if(pending||writeCount){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flush(true).catch(()=>{});else if(user)sync();});
  window.addEventListener('online',()=>sync());window.addEventListener('focus',async()=>{if(!node('noteDialog').open)await reload();if(user)sync();});
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'&&node('noteDialog').open){e.preventDefault();node('saveNote').click();}});
  if(cloud.configured&&cloud.session){try{await enterAccount(await cloud.user());}catch(e){say('로그인이 만료되었거나 연결할 수 없습니다. 동기화 설정에서 다시 로그인하세요.');}}
  setInterval(()=>{if(user&&!document.hidden)sync();},60000);
  render();
})();
