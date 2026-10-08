// The local Gearshift panel: one self-contained page served by the helper on
// loopback. Everything the page shows is set with textContent; it never builds
// HTML from data. The script avoids template literals because this whole file
// is one raw template string.
export const localPanel = String.raw`<!doctype html><html lang="en"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Gearshift Desktop</title><style>
:root{color-scheme:light dark;--fg:#16181d;--muted:#565d6b;--bg:#ffffff;--card:#f5f6f8;--line:#c9ced8;--accent:#1d4ed8;--ok:#0f6b3a;--warn:#8a4b00;--bad:#a11a1a}
@media (prefers-color-scheme:dark){:root{--fg:#eceef2;--muted:#aab1bf;--bg:#14161a;--card:#1d2026;--line:#3a404c;--accent:#8ab4ff;--ok:#6fd49a;--warn:#f0b866;--bad:#ff8f8f}}
[hidden]{display:none!important}
body{font:16px/1.45 system-ui,sans-serif;max-width:820px;margin:28px auto;padding:0 20px;color:var(--fg);background:var(--bg)}
h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:1.15rem}.lede,.muted{color:var(--muted)}
button,input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
button{cursor:pointer}button:disabled{opacity:.55;cursor:default}button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}
textarea{width:100%;box-sizing:border-box;resize:vertical}input[type=text]{width:100%;box-sizing:border-box}
fieldset{border:1px solid var(--line);border-radius:12px;margin:16px 0;padding:12px 16px}legend{font-weight:600;padding:0 6px}
label{display:block;margin:8px 0 4px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>.grow{flex:1 1 260px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
#error,.err{color:var(--bad)}
.task{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:12px 16px;margin:14px 0}
.task header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.task header strong{flex:1 1 240px;overflow-wrap:anywhere}
.state{font-size:.85rem;border:1px solid var(--line);border-radius:999px;padding:1px 10px}
.badge{margin:6px 0;font-weight:600}.badge.ok{color:var(--ok)}.badge.warn{color:var(--warn)}.badge.bad{color:var(--bad)}
.log{max-height:360px;overflow:auto;border-top:1px solid var(--line);margin-top:8px;padding-top:8px}
.entry{margin:6px 0;overflow-wrap:anywhere}.entry .who{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.entry.command pre,.entry.tool pre,.entry.file_change pre{font-family:ui-monospace,Consolas,monospace;font-size:.9rem}
.ask{border:1px solid var(--warn);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--bg)}
.ask pre{font-family:ui-monospace,Consolas,monospace;font-size:.9rem;margin:6px 0}
dialog{color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:12px;width:min(680px,calc(100% - 64px));padding:20px}dialog::backdrop{background:#0008}dialog h2{margin:0 0 12px}.folder-list{max-height:40vh;overflow:auto;margin:12px 0;display:flex;flex-direction:column;gap:4px}.folder-list button{text-align:left;overflow-wrap:anywhere}
</style>
<h1>Gearshift Desktop</h1>
<p class=lede>Automatic model and reasoning effort for Codex on this computer.</p>
<p id=summary role=status>Loading status...</p>

<fieldset id=composer><legend>Start a task</legend>
<p id=composerNote class=muted></p>
<label for=cwd>Workspace folder</label>
<div class=row><input class=grow id=cwd type=text list=folders autocomplete=off spellcheck=false placeholder="The project folder Codex should work in"><button id=pick type=button>Browse</button></div>
<datalist id=folders></datalist>
<label for=task>Task</label>
<textarea id=task rows=4 placeholder="Describe what you want done"></textarea>
<div class=row><label for=preset style="margin:0">Model</label><select id=preset><option value="">Auto</option></select><label for=access style="margin:0">Access</label><select id=access><option value="">Your Codex default</option><option value="read-only">Read only</option><option value="workspace-write">This folder</option><option value="danger-full-access">Full access</option></select><button id=start class=primary type=button>Start task</button><span id=appserver class=muted></span></div>
<p id=accessNote class=muted></p>
<p id=sandboxWarn class=err role=status hidden></p>
<p id=composeError class=err role=alert></p>
<p class=muted>Main tasks are routed here. A chat you start in the Codex app keeps the model you pick there; only its subagents are routed.</p>
</fieldset>
<dialog id=folderPicker aria-labelledby=folderTitle>
<h2 id=folderTitle>Choose a workspace folder</h2>
<div class=row><button id=folderHome type=button>Home</button><button id=folderUp type=button>Up</button></div>
<label for=folderPath>Folder path</label>
<div class=row><input id=folderPath class=grow type=text autocomplete=off spellcheck=false><button id=folderGo type=button>Open folder</button></div>
<p id=folderStatus role=status></p><p id=folderError class=err role=alert></p>
<div id=folderList class=folder-list></div>
<div class=row><button id=folderUse class=primary type=button disabled>Use this folder</button><button id=folderCancel type=button>Cancel</button></div>
</dialog>
<div id=tasks></div>

<fieldset><legend>Subagent routing</legend><label><input type=checkbox id=enabled> On</label><button id=apply>Apply</button><label>Goal <select id=goal><option>balanced</option><option>quality</option><option>economy</option></select></label><p class=muted>When on, Gearshift automatically sets the model and reasoning effort of eligible new subagents before they start, in the Codex app and in tasks started here. The same switch controls Auto above.</p><p id=settingsstate></p><p id=adaptive class=muted></p><details><summary>Diagnostics</summary><p>Preview makes classification requests and records the choice without applying it; it can use API credits.</p><button id=preview>Enable preview</button><button id=catalog>Refresh model list</button><pre id=diagnostics></pre><h3>Routing evidence</h3><pre id=status></pre></details></fieldset>
<fieldset><legend>API connection</legend><p>Decisions classification uses your API project. Coding stays on your Codex account.</p><form id=connect><input id=key aria-label="OpenAI API key" type=password autocomplete=off placeholder="OpenAI API key" required><button>Connect securely</button></form><button id=test>Test connection</button><button id=disconnect>Disconnect</button></fieldset>
<p id=error role=alert></p>
<h2>Why a subagent was not routed</h2><pre id=reasons></pre>
<p class=muted>Waiting for an eligible subagent is normal. Gearshift does not create work or authorize delegation.</p>
<button id=pair hidden>Pair with ChatGPT</button><button id=refresh>Refresh status</button>
<script>
var q=function(id){return document.getElementById(id)};
var dirty=false,lastStatus=null,drafts={},deltas={},stream=null,refreshTimer=null,PENDING_KEY='gearshift_pending';
q('enabled').onchange=q('goal').onchange=function(){dirty=true};
async function call(op,payload){var r=await fetch('/api/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});var v=await r.json();if(!r.ok)throw Error(v.error||'operation_failed');return v}
function words(code){return String(code||'').replace(/_/g,' ')}
function el(tag,text,cls){var n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(cls)n.className=cls;return n}
function uuid(){return crypto.randomUUID()}
// Cards are found by comparing the attribute, never by building a selector from data.
function findCard(id){var cards=q('tasks').children;for(var i=0;i<cards.length;i+=1)if(cards[i].getAttribute('data-task')===id)return cards[i];return null}

// ---- what a routing decision looks like to a person -------------------------
var WHY={refusal:'Decisions declined to classify this task',access_denied:'your API key is not allowed to use Decisions (403)',manual_preset_unavailable:'that model is not available in this Codex',mode_off:'routing is off',no_credential:'no API key is connected',no_task_text:'sharing task text is turned off',settings_sync_pending:'settings are still being confirmed',config_invalid:'the Gearshift settings file is invalid',timeout:'Decisions did not answer in time',abstain:'Decisions was not sure',low_confidence:'Decisions was not confident enough',api_auth:'the API key was rejected',rate_limited:'rate limit or no quota on the API project',api_unavailable:'Decisions could not be reached',invalid_response:'Decisions gave an unusable answer',catalog_missing:'no model list yet',catalog_stale:'the model list is out of date',catalog_mismatch:'the model list is for another Codex version',no_eligible_candidate:'no preset is runnable here'};
function why(reason){return WHY[reason]||words(reason)}
function badge(r){
  if(!r)return {text:'',tone:''};
  var pair=r.model?r.model+' · '+r.effort:'',text='',tone='';
  if(r.status==='blocked'){text='Not started: '+why(r.reason);tone='bad'}
  else if(r.source==='manual')text='Manual '+pair;
  else if(r.status==='passthrough'){text=(r.reason==='mode_off'?'Routing off':'Not routed: '+why(r.reason))+" · Codex's own settings";tone=r.reason==='mode_off'?'':'warn'}
  else if(r.dry_run){text='Preview: would pick '+pair+', not applied'}
  else if(r.source==='decisions'&&r.reason==='cautious'){
    var lean=r.leaned_model&&(r.leaned_model!==r.model||r.leaned_effort!==r.effort)?'it leaned '+r.leaned_model+' · '+r.leaned_effort+'; ':'';
    text='Auto-selected '+pair+(r.decide_ms!==null&&r.decide_ms!==undefined?' · '+r.decide_ms+' ms':'')+' (Decisions, '+lean+'cautious pick'+(typeof r.cover==='number'?' covering '+Math.round(r.cover*100)+'%':'')+')';
  }
  else if(r.source==='decisions')text='Auto-selected '+pair+(r.decide_ms!==null&&r.decide_ms!==undefined?' · '+r.decide_ms+' ms':'')+' (Decisions)';
  else if(r.source==='cache')text='Auto-selected '+pair+' (cached)';
  else if(r.source==='fallback'){text='Fallback '+pair+' ('+why(r.reason)+(r.leaned_model?'; it leaned '+r.leaned_model+' · '+r.leaned_effort+(typeof r.confidence==='number'?' at '+Math.round(r.confidence*100)+'%':''):'')+')';tone='warn'}
  else if(r.source==='single_candidate')text='Only runnable preset '+pair;
  else text=words(r.reason);
  if(r.turn_id){
    var ran=r.effective_model?r.effective_model+' · '+r.effective_effort:'';
    if(r.verified===true){text+=' · verified';if(!tone)tone='ok'}
    else if(r.verified===false){text+=ran?' · but ran as '+ran:' · not verified';tone='warn'}
    else if(ran)text+=' · ran as '+ran;
    else text+=' · checking';
  }
  if(r.rerouted_to){text+=' · Codex rerouted to '+r.rerouted_to;tone='warn'}
  return {text:text,tone:tone};
}
var STATE={idle:'Ready',routing:'Choosing model',starting:'Starting',running:'Working',blocked:'Not started',failed:'Stopped with a problem',paused:'Queued messages waiting'};
var NOTE={interrupted:'You stopped this turn.',failed:'The turn ended with an error.',interrupted_by_restart:'Gearshift restarted while this was running. Send a message to continue.',app_server_exited:'Codex stopped unexpectedly. Send a message to continue.',app_server_failed:'Codex could not be started.',app_server_timeout:'Codex did not answer in time.',app_server_unstable:'Codex keeps stopping. Try again later.',codex_not_found:'The Codex app was not found on this computer.',codex_rejected:'Codex rejected the request.',internal_error:'Something went wrong inside Gearshift.'};
var WHO={user:'You',agent:'Codex',command:'Command',file_change:'Files changed',tool:'Tool',web_search:'Web search',plan:'Plan',subagent:'Subagent',notice:'Note',error:'Problem'};

// ---- tasks ------------------------------------------------------------------
function entryNode(entry){
  var box=el('div',null,'entry '+entry.kind);box.append(el('div',WHO[entry.kind]||entry.kind,'who'));
  var text=entry.text||'';
  if(entry.kind==='command'){text='$ '+text;if(entry.status==='inProgress')text+='  (running)';else if(entry.problem==='codex_sandbox')text+='  (did not run: Codex could not set up its Windows sandbox)';else if(entry.exit_code!==null&&entry.exit_code!==undefined)text+='  (exit '+entry.exit_code+')'}
  var body=el('pre',text);if(entry.kind==='error')body.className='err';box.append(body);return box;
}
function askNode(task,request){
  var box=el('div',null,'ask');
  var answer=function(response){return async function(){try{await call('compose/respond',{task_id:task.task_id,request_id:request.request_id,response:response});scheduleRefresh()}catch(e){box.append(el('p',words(e.message),'err'))}}};
  var title={command_approval:'Codex wants to run a command',file_approval:'Codex wants to change files',permissions:'Codex asks for more access',user_input:'Codex has a question',elicitation:'A tool asks for input',legacy_approval:'Codex asks for approval'}[request.kind]||'Codex is waiting';
  box.append(el('strong',title));
  if(request.reason)box.append(el('p',request.reason));
  if(request.command)box.append(el('pre',request.command));
  if(request.cwd)box.append(el('p','In '+request.cwd,'muted'));
  if(request.grant_root)box.append(el('p','Write access under '+request.grant_root,'muted'));
  if(request.requested)box.append(el('pre',request.requested));
  if(request.kind==='user_input'){
    var fields=[];
    request.questions.forEach(function(question){
      box.append(el('p',(question.header?question.header+': ':'')+question.question));
      var input;
      if(question.options.length&&!question.is_other){input=el('select');question.options.forEach(function(o){var opt=el('option',o.label+(o.description?': '+o.description:''));opt.value=o.label;input.append(opt)})}
      else{input=el('input');input.type=question.is_secret?'password':'text';input.autocomplete='off';if(question.options.length)input.placeholder=question.options.map(function(o){return o.label}).join(' / ')}
      box.append(input);fields.push([question.id,input]);
    });
    var send=el('button','Answer','primary');send.onclick=function(){var answers={};fields.forEach(function(f){answers[f[0]]=f[1].value?[f[1].value]:[]});answer({answers:answers})()};box.append(send);
    return box;
  }
  var LABEL={accept:'Allow once',acceptForSession:'Allow for this task',decline:'Decline',cancel:'Decline and stop',approved:'Allow',abort:'Stop'};
  var row=el('div',null,'row');
  (request.decisions||[]).forEach(function(decision){var b=el('button',LABEL[decision]||decision,decision==='accept'||decision==='approved'?'primary':'');b.onclick=answer({decision:decision});row.append(b)});
  box.append(row);return box;
}
function presetOptions(select,presets){
  // Rebuilt only when the list itself changes, so an open menu is never closed by a refresh.
  var key=(presets||[]).map(function(p){return p.id}).join(',');
  if(select.getAttribute('data-presets')===key)return;
  select.setAttribute('data-presets',key);
  var value=select.value;select.replaceChildren();
  var auto=el('option','Auto (Gearshift picks)');auto.value='';select.append(auto);
  (presets||[]).forEach(function(p){var o=el('option',p.model+' · '+p.effort);o.value=p.id;select.append(o)});
  select.value=value||'';
}
function renderTask(task,presets){
  var id=task.task_id,card=findCard(id),fresh=!card;
  if(fresh){
    card=el('article',null,'task');card.setAttribute('data-task',id);
    var head=el('header');head.append(el('strong',null,'title'),el('span',null,'folder muted'),el('span',null,'state'));
    var follow=el('div',null,'row follow'),box=el('textarea');box.rows=2;box.className='grow draft';box.placeholder='Send a follow-up';
    box.oninput=function(){drafts[id]=box.value};
    var pick=el('select',null,'followPreset'),sendBtn=el('button','Send','primary send');
    sendBtn.onclick=function(){var text=box.value.trim();if(!text)return;submit({task_id:id,text:text,preset_id:pick.value||null});box.value='';drafts[id]=''};
    follow.append(box,pick,sendBtn);
    card.append(head,el('p',null,'badge'),el('p',null,'note muted'),el('div',null,'log'),el('div',null,'asks'),follow,el('div',null,'row actions'));
  }
  var log=card.querySelector('.log'),pinned=log.scrollHeight-log.scrollTop-log.clientHeight<24;
  card.querySelector('.title').textContent=task.title||'Task';
  card.querySelector('.folder').textContent=task.cwd+(task.sandbox?' · '+({'read-only':'read only','workspace-write':'this folder','danger-full-access':'full access'}[task.sandbox]||task.sandbox):'');
  var busy=task.status==='routing'||task.status==='starting'||task.status==='running';
  card.querySelector('.state').textContent=(STATE[task.status]||task.status)+(task.pending_count?' · '+task.pending_count+' queued':'');
  var b=badge(task.routing),badgeNode=card.querySelector('.badge');badgeNode.textContent=b.text;badgeNode.className='badge '+b.tone;
  card.querySelector('.note').textContent=task.status==='blocked'?'':(NOTE[task.note]||'');
  // The page refreshes often. Parts that have not changed are left alone, so a
  // refresh never moves what you are reading, clears what you are typing, or
  // swaps a button out from under a click.
  var liveId=task.streaming?task.streaming.item_id:'';
  var logKey=JSON.stringify([task.transcript.map(function(e){return [e.id,e.kind,e.status,e.exit_code,(e.text||'').length]}),liveId]);
  if(card.getAttribute('data-log')!==logKey){
    card.setAttribute('data-log',logKey);
    var top=log.scrollTop;
    log.replaceChildren();
    task.transcript.forEach(function(entry){log.append(entryNode(entry))});
    if(task.streaming){
      var live=task.streaming.text;
      (deltas[id]||[]).forEach(function(d){if(d.item_id===liveId)live+=d.delta});
      var liveNode=entryNode({kind:'agent',text:live});liveNode.setAttribute('data-live',liveId);log.append(liveNode);
    }
    log.scrollTop=pinned?log.scrollHeight:top;
  }
  var asks=card.querySelector('.asks'),wanted={};
  task.requests.forEach(function(request){
    wanted[request.request_id]=true;
    var have=false;for(var i=0;i<asks.children.length;i+=1)if(asks.children[i].getAttribute('data-request')===request.request_id)have=true;
    if(!have){var node=askNode(task,request);node.setAttribute('data-request',request.request_id);asks.append(node)}
  });
  Array.prototype.slice.call(asks.children).forEach(function(node){if(!wanted[node.getAttribute('data-request')])node.remove()});
  presetOptions(card.querySelector('.followPreset'),presets);
  var draft=card.querySelector('.draft');if(fresh&&drafts[id])draft.value=drafts[id];
  draft.placeholder=busy?'Send a follow-up (it waits for this turn to finish)':'Send a follow-up';
  var actions=card.querySelector('.actions'),offered=[];
  if(busy)offered.push('stop');
  if(task.status==='paused')offered.push('resume','discard');else if(busy&&task.pending_count)offered.push('discard');
  if(!busy)offered.push('remove');
  if(card.getAttribute('data-actions')!==offered.join(',')){
    card.setAttribute('data-actions',offered.join(','));
    actions.replaceChildren();
    var DO={
      stop:['Stop',function(){return call('compose/interrupt',{task_id:id})}],
      resume:['Send queued now',function(){return call('compose/resume_queue',{task_id:id})}],
      discard:['Discard queued',function(){return call('compose/interrupt',{task_id:id,drop_queued:true})}],
      remove:['Remove from this list',function(){return call('compose/dismiss',{task_id:id})}]
    };
    offered.forEach(function(name){
      var bn=el('button',DO[name][0]);
      bn.onclick=async function(){bn.disabled=true;try{await DO[name][1]()}catch(e){actions.append(el('span',words(e.message),'err'))}finally{bn.disabled=false}scheduleRefresh()};
      actions.append(bn);
    });
  }
  return card;
}
function renderComposer(s){
  var c=s.composer_tasks;if(!c)return;
  var mode=s.routing_mode,note;
  if(mode==='auto')note='Auto: Gearshift picks the model and reasoning effort for each message you send here, then starts the turn with them.';
  else if(mode==='dry_run')note="Preview: Gearshift records what it would pick. The turn runs on Codex's own settings unless you choose a model.";
  else note="Routing is off: the turn runs on Codex's own settings unless you choose a model.";
  if(mode!=='off'&&!s.connected)note+=' No API key is connected, so Auto cannot ask Decisions yet.';
  q('composerNote').textContent=note;
  presetOptions(q('preset'),c.presets);
  var folders=q('folders');folders.replaceChildren();(c.recent_folders||[]).forEach(function(f){var o=el('option');o.value=f;folders.append(o)});
  if(!q('cwd').value&&c.recent_folders&&c.recent_folders[0])q('cwd').value=c.recent_folders[0];
  var a=c.app_server||{};q('appserver').textContent=a.state==='ready'?'Codex is ready':a.state==='starting'?'Starting Codex...':a.state==='failed'?'Codex could not start ('+words(a.last_failure)+')':'';
  var host=q('tasks'),seen={};
  c.tasks.forEach(function(task,index){
    seen[task.task_id]=true;
    // Deltas already included in this snapshot are dropped; later ones still apply.
    deltas[task.task_id]=(deltas[task.task_id]||[]).filter(function(d){return d.seq>c.seq});
    var card=renderTask(task,c.presets);
    if(host.children[index]!==card)host.insertBefore(card,host.children[index]||null);
  });
  Array.prototype.slice.call(host.children).forEach(function(card){if(!seen[card.getAttribute('data-task')])card.remove()});
}

// ---- sending ----------------------------------------------------------------
// Each message gets an id before it is sent and is remembered until the helper
// answers. After a reload it is sent again with the same id; the helper never
// runs the same id twice.
function pending(){try{return JSON.parse(sessionStorage.getItem(PENDING_KEY)||'[]')}catch(e){return []}}
function savePending(list){try{sessionStorage.setItem(PENDING_KEY,JSON.stringify(list))}catch(e){}}
async function deliver(item){
  try{
    var result=await call('compose/submit',item);
    savePending(pending().filter(function(p){return p.client_message_id!==item.client_message_id}));
    if(result.status==='blocked')q('composeError').textContent='';
    return result;
  }catch(e){
    // A refusal from the helper is final. Only a lost connection is worth keeping for a retry.
    if(e.message!=='Failed to fetch'&&e.name!=='TypeError')savePending(pending().filter(function(p){return p.client_message_id!==item.client_message_id}));
    throw e;
  }finally{scheduleRefresh()}
}
function submit(fields){
  var item=Object.assign({client_message_id:uuid()},fields);
  savePending(pending().concat([item]));
  return deliver(item).catch(function(e){q('composeError').textContent=SUBMIT_ERR[e.message]||words(e.message)});
}
var SUBMIT_ERR={text_invalid:'Type a task first (up to 32,000 characters).',cwd_invalid:'That folder does not exist. Enter the full path of your project folder.',too_many_tasks:'Four tasks are already running. Wait for one to finish.',task_not_found:'That task is no longer in the list.',preset_invalid:'Pick a model from the list.',sandbox_invalid:'Pick an access level from the list.'};
q('start').onclick=async function(){
  var text=q('task').value.trim(),cwd=q('cwd').value.trim();q('composeError').textContent='';
  if(!cwd){q('composeError').textContent=SUBMIT_ERR.cwd_invalid;return}
  if(!text){q('composeError').textContent=SUBMIT_ERR.text_invalid;return}
  q('start').disabled=true;q('task').value='';
  try{await submit({cwd:cwd,text:text,preset_id:q('preset').value||null,sandbox:q('access').value||null});if(q('composeError').textContent)q('task').value=text}finally{q('start').disabled=false}
};
var ACCESS={'':'Uses the access level from your own Codex settings.','read-only':'Codex may read this folder and may not change anything.','workspace-write':'Codex may change files in this folder only.','danger-full-access':'Codex may read, change and run anything your account can, without a sandbox. Choose this only for work you trust.'};
function showAccess(){q('accessNote').textContent=ACCESS[q('access').value||'']}
q('access').onchange=showAccess;showAccess();
var prepared=false;
q('task').onfocus=function(){if(prepared)return;prepared=true;call('compose/prepare').then(scheduleRefresh,function(){prepared=false})};
var folderCurrent=null,folderRequest=0;
var FOLDER_ERR={folder_invalid:'Enter a full folder path.',folder_not_found:'That folder does not exist.',folder_unreadable:'That folder could not be read. Choose another folder.'};
async function browseFolder(folder){
  var request=++folderRequest;folderCurrent=null;q('folderUse').disabled=true;q('folderUp').disabled=true;q('folderError').textContent='';q('folderStatus').textContent='Loading folders...';q('folderList').replaceChildren();
  try{
    var r=await call('compose/folders',{path:folder||null});if(request!==folderRequest||!q('folderPicker').open)return;
    folderCurrent=r;q('folderPath').value=r.path;q('folderUp').disabled=!r.parent;q('folderUse').disabled=false;q('folderStatus').textContent=r.folders.length?'Choose a folder below, or use this folder.':'This folder has no subfolders. You can use this folder.';
    r.folders.forEach(function(folder){var button=el('button',folder.name);button.type='button';button.onclick=function(){browseFolder(folder.path)};q('folderList').append(button)});
  }catch(e){if(request!==folderRequest||!q('folderPicker').open)return;q('folderStatus').textContent='';q('folderError').textContent=FOLDER_ERR[e.message]||'Folders could not be loaded. Try again, or type the workspace path on the main page.';}
}
q('pick').onclick=function(){q('folderPicker').showModal();return browseFolder(q('cwd').value.trim()||null)};
q('folderHome').onclick=function(){return browseFolder(null)};
q('folderUp').onclick=function(){if(folderCurrent&&folderCurrent.parent)return browseFolder(folderCurrent.parent)};
q('folderGo').onclick=function(){return browseFolder(q('folderPath').value.trim())};
q('folderPath').oninput=function(){q('folderUse').disabled=true};
q('folderPath').onkeydown=function(event){if(event.key==='Enter'){event.preventDefault();browseFolder(q('folderPath').value.trim())}};
q('folderUse').onclick=function(){if(!folderCurrent||q('folderUse').disabled)return;q('cwd').value=folderCurrent.path;q('folderPicker').close()};
q('folderCancel').onclick=function(){q('folderPicker').close()};
q('folderPicker').onclose=function(){folderRequest+=1;folderCurrent=null};

// ---- status and live updates --------------------------------------------------
async function refresh(){try{var s=await call('status');lastStatus=s;q('summary').textContent='Subagent routing: '+words(s.routing_state)+' ('+words(s.routing_reason)+')';if(!dirty){q('enabled').checked=s.routing_mode==='auto';q('goal').value=s.optimization_goal;}
  var proof=[];if(s.main_turn_selection_verified)proof.push('A Decisions-selected main task was verified.');if(s.decisions_selection_verified)proof.push('A Decisions-selected subagent was verified.');else if(s.host_rewrite_verified)proof.push('Subagent settings were applied and verified (a local default, not a Decisions selection).');
  q('adaptive').textContent=proof.length?proof.join(' '):'Nothing has been verified on this Codex version yet.';
  q('settingsstate').textContent=s.settings_error?'Settings failed: '+s.settings_error:(s.settings_update||s.routing_reason==='settings_sync_pending')&&s.paired?'Settings pending local/hosted reconciliation':'Settings confirmed locally';
  var sandbox=s.codex_sandbox&&s.codex_sandbox.state==='failing'?s.codex_sandbox.advice+' This comes from Codex, not from Gearshift. Tasks set to Full access do not use the sandbox.':'';q('sandboxWarn').textContent=sandbox;q('sandboxWarn').hidden=!sandbox;
  q('pair').hidden=!s.hosted_controls;
  q('reasons').textContent=Object.entries(s.passthrough_counts||{}).map(function(kv){return words(kv[0])+': '+kv[1]}).join('\n')||'No skipped spawns recorded';
  q('diagnostics').textContent=JSON.stringify({local:s.local_diagnostics,codex_session:s.composer,model_list_refresh:s.catalog_refresh,connection:s.transport},null,2);
  q('status').textContent=JSON.stringify({main_tasks:s.main_turns,subagents:s.recent,decisions_calls:s.decisions_calls},null,2);
  renderComposer(s);return s}catch(e){q('error').textContent=e.message}}
function scheduleRefresh(){if(refreshTimer)return;refreshTimer=setTimeout(function(){refreshTimer=null;refresh()},40)}
function onDelta(event){
  var d=JSON.parse(event.data),seq=Number(event.lastEventId);(deltas[d.task_id]=deltas[d.task_id]||[]).push({seq:seq,item_id:d.item_id,delta:d.delta});
  var card=findCard(d.task_id),liveNode=card&&card.querySelector('[data-live]');
  // Text for a message the page is not showing yet: take a fresh snapshot instead of guessing.
  if(!liveNode||liveNode.getAttribute('data-live')!==d.item_id)return scheduleRefresh();
  var node=liveNode.querySelector('pre');
  var log=card.querySelector('.log'),pinned=log.scrollHeight-log.scrollTop-log.clientHeight<24;node.textContent+=d.delta;if(pinned)log.scrollTop=log.scrollHeight;
}
function listen(after){
  if(typeof EventSource==='undefined')return;
  if(stream)stream.close();
  stream=new EventSource('/api/events?after='+after);
  stream.addEventListener('agent_delta',onDelta);
  ['task_created','task_updated','routing','turn_started','agent_started','agent_message','item','notice','request','request_resolved','verified','rerouted','turn_completed','queue_changed','task_failed','task_dismissed','app_server'].forEach(function(type){stream.addEventListener(type,scheduleRefresh)});
  // Too far behind to catch up: start again from a fresh snapshot.
  stream.addEventListener('reset',function(){refresh().then(function(s){if(s&&s.composer_tasks)listen(s.composer_tasks.seq)})});
}
function action(id,fn){q(id).onclick=async function(){q(id).disabled=true;q('error').textContent='';try{await fn();await refresh()}catch(e){q('error').textContent=e.message}finally{q(id).disabled=false}}}
action('apply',async function(){await call('settings',{mode:q('enabled').checked?'auto':'off',optimization_goal:q('goal').value});dirty=false});action('preview',function(){return call('settings',{mode:'dry_run'})});action('catalog',function(){return call('refresh_catalog')});action('test',function(){return call('connection_test')});action('disconnect',function(){return call('disconnect')});action('refresh',refresh);
q('connect').onsubmit=async function(e){e.preventDefault();var key=q('key').value;q('key').value='';try{await call('connect',{key:key});await refresh()}catch(err){q('error').textContent=err.message}};
action('pair',async function(){var w=window.open('about:blank');try{var p=await call('pair');w.location=p.url}catch(e){w.close();throw e}});
refresh().then(function(s){
  if(!s||!s.composer_tasks)return;
  listen(s.composer_tasks.seq);
  // Anything sent just before a reload is sent again with its original id.
  pending().forEach(function(item){deliver(item).catch(function(){})});
});
setInterval(refresh,10000);
</script></html>`;
