'use strict';
const JournalCloud = (()=>{
  class Client {
    constructor(config){
      this.url=(config.url||'').replace(/\/$/,'');this.key=config.publishableKey||'';
      this.configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.url)&&!!this.key;
      this.storageKey='market-journal-auth:'+this.url;this.session=null;
      if(this.configured){try{this.session=JSON.parse(localStorage.getItem(this.storageKey)||'null');}catch{}}
    }
    saveSession(s){this.session=s?{...s,expires_at:Date.now()+s.expires_in*1000}:null;if(s)localStorage.setItem(this.storageKey,JSON.stringify(this.session));else localStorage.removeItem(this.storageKey);}
    async request(path,options={},token=false){
      if(!this.configured)throw Error('클라우드 저장소 연결을 준비 중입니다. 현재는 이 기기에 저장됩니다.');
      const response=await fetch(this.url+path,{...options,signal:AbortSignal.timeout(20000),headers:{apikey:this.key,...(token?{Authorization:'Bearer '+this.session.access_token}:{}),'Content-Type':'application/json',...options.headers}});
      const body=await response.text();let result;try{result=body?JSON.parse(body):null;}catch{throw Error('서버 응답을 읽지 못했습니다.');}
      if(!response.ok)throw Error(result?.msg||result?.message||result?.error_description||'클라우드 요청 실패 ('+response.status+')');
      return result;
    }
    async user(){
      if(!this.session)return null;
      if(!this.session.expires_at||this.session.expires_at<Date.now()+60000){
        const s=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:this.session.refresh_token})});this.saveSession(s);
      }
      return this.request('/auth/v1/user',{},true);
    }
    async sendCode(email){await this.request('/auth/v1/otp',{method:'POST',body:JSON.stringify({email,create_user:true})});}
    async verify(email,token){
      let payload={email,token,type:'email'};
      if(/^https:\/\//i.test(token)){
        const link=new URL(token);if(link.origin!==this.url||!link.pathname.endsWith('/verify'))throw Error('이 저장소의 로그인 메일 링크를 입력해 주세요.');
        const hash=link.searchParams.get('token')||link.searchParams.get('token_hash'),type=link.searchParams.get('type');
        if(!hash||!['magiclink','signup','email'].includes(type))throw Error('로그인 링크 형식을 확인해 주세요.');
        payload={token_hash:hash,type};
      }
      const s=await this.request('/auth/v1/verify',{method:'POST',body:JSON.stringify(payload)});this.saveSession(s);return this.user();
    }
    async signOut(){try{if(this.session)await this.request('/auth/v1/logout',{method:'POST'},true);}finally{this.saveSession(null);}}
    async list(){
      const all=[];for(let offset=0;;offset+=500){const rows=await this.request('/rest/v1/journal_notes?select=*&order=id.asc&limit=500&offset='+offset,{},true);all.push(...rows);if(rows.length<500)return all;}
    }
    async save(n){return this.request('/rest/v1/rpc/save_journal_note',{method:'POST',body:JSON.stringify({p_id:n.id,p_revision:n.baseRevision,p_title:n.title,p_body:n.body,p_date:n.date,p_event:n.eventId,p_deleted:n.deletedAt})},true);}
    history(id){return this.request('/rest/v1/journal_history?note_id=eq.'+encodeURIComponent(id)+'&select=*&order=revision.desc&limit=50',{},true);}
  }
  return {Client};
})();
if(typeof module!=='undefined')module.exports=JournalCloud;
