(function(){
'use strict';

function $(id){ return document.getElementById(id); }

// ---------- utils ----------
function pad(num, width){
  const s = String(num);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseISODate(s){
  if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d] = s.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  if(Number.isNaN(dt.getTime())) return null;
  dt.setHours(0,0,0,0);
  return dt;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function clampHoursToQuarter(h){
  const x = Number(h);
  if(!Number.isFinite(x)) return 0;
  return Math.round(x*4)/4;
}
function downloadText(filename, text){
  const blob = new Blob([text], {type:"text/yaml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- schema ----------
function createEmptyData(){
  return {
    meta: {
      schema_version: "1.0",
      last_task_seq: 0,
      semantic: {
        task_status_not_started: "01_未着手",
        task_status_done: "03_完了",
        todo_status_done: "03_完了"
      }
    },
    masters: {
      assignees: [],
      task_statuses: [
        {id_name:"01_未着手"},
        {id_name:"02_進行中"},
        {id_name:"03_完了"}
      ],
      todo_statuses: [
        {id_name:"01_未着手"},
        {id_name:"02_進行中"},
        {id_name:"03_完了"}
      ],
      categories: [],
      priorities: [
        {id_name:"01_高"},
        {id_name:"02_中"},
        {id_name:"03_低"}
      ],
      todo_actions: [
        {id_name:"01_検証"},
        {id_name:"02_改修"},
        {id_name:"03_調査"},
        {id_name:"04_管理"}
      ],
      phases: []
    },
    tasks: [],
    worklogs: []
  };
}
function nextTaskId(data){
  const seq = (data?.meta?.last_task_seq ?? 0) + 1;
  data.meta.last_task_seq = seq;
  return pad(seq, 4);
}
function createNewTask(data){
  const id = nextTaskId(data);
  const today = todayISO();
  const masters = data.masters;

  const pickDefault = (arr, fallback) => (arr && arr.length ? arr[0].id_name : fallback);

  const task = {
    id,
    name: "新規タスク",
    category: pickDefault(masters.categories, "00_未設定"),
    priority: pickDefault(masters.priorities, "01_高"),
    phase: pickDefault(masters.phases, "00_未設定"),
    status: pickDefault(masters.task_statuses, "01_未着手"),
    assignee: pickDefault(masters.assignees, "00_未設定"),
    start_date: today,
    end_date: today,
    memo: "",
    todos: [],
    urls: []
  };

  data.tasks.push(task);
  return task;
}

// ---------- yaml io ----------
function parseYaml(text){
  if(!window.jsyaml) throw new Error("js-yaml が読み込めていません (window.jsyaml)");
  return window.jsyaml.load(text);
}
function dumpYaml(obj){
  if(!window.jsyaml) throw new Error("js-yaml が読み込めていません (window.jsyaml)");
  return window.jsyaml.dump(obj, { noRefs:true, lineWidth:120, sortKeys:false });
}
function downloadYaml(filename, data){
  const text = dumpYaml(data);
  downloadText(filename, text);
}

// ---------- validate ----------
function validateData(data){
  const errors = [];
  if(!data || typeof data !== "object"){
    return { ok:false, errors:["YAMLのトップレベルがオブジェクトではありません。"] };
  }
  const meta = data.meta ?? {};
  if(typeof meta.schema_version !== "string") errors.push("meta.schema_version がありません。");
  if(!Number.isInteger(meta.last_task_seq ?? 0)) errors.push("meta.last_task_seq は整数である必要があります。");

  const masters = data.masters ?? {};
  const required = ["assignees","task_statuses","todo_statuses","categories","priorities","todo_actions","phases"];
  for(const k of required){
    if(!Array.isArray(masters[k])) errors.push(`masters.${k} は配列である必要があります。`);
  }

  const masterMap = {};
  for(const key of required){
    const arr = masters[key];
    if(!Array.isArray(arr)) continue;
    const set = new Set();
    for(const row of arr){
      const idn = row?.id_name;
      if(typeof idn !== "string" || !/^\d{2}_.+/.test(idn)){
        errors.push(`masters.${key} に不正な id_name があります: ${JSON.stringify(idn)}`);
        continue;
      }
      if(set.has(idn)) errors.push(`masters.${key} に重複 id_name があります: ${idn}`);
      set.add(idn);
    }
    masterMap[key] = set;
  }

  if(Array.isArray(masters.phases)){
    for(const ph of masters.phases){
      const s = ph?.start_date, e = ph?.end_date;
      if(!parseISODate(s) || !parseISODate(e)) errors.push(`phases の start_date/end_date が不正です: ${ph?.id_name ?? ""}`);
      else if(s > e) errors.push(`phases の start_date > end_date です: ${ph?.id_name ?? ""}`);
    }
  }

  if(!Array.isArray(data.tasks)){
    errors.push("tasks は配列である必要があります。");
  } else {
    const ids = new Set();
    for(const t of data.tasks){
      const id = t?.id;
      if(typeof id !== "string" || !/^\d{4}$/.test(id)) errors.push(`タスクIDが不正です: ${JSON.stringify(id)}`);
      if(ids.has(id)) errors.push(`タスクIDが重複しています: ${id}`);
      ids.add(id);

      if(typeof t?.name !== "string" || !t.name.trim()) errors.push(`tasks.${id}.name が空です。`);
      const s = t?.start_date, e = t?.end_date;
      if(!parseISODate(s) || !parseISODate(e)) errors.push(`tasks.${id} の start_date/end_date が不正です。`);
      else if(s > e) errors.push(`tasks.${id} の start_date > end_date です。`);

      const refChecks = [["category","categories"],["priority","priorities"],["phase","phases"],["status","task_statuses"],["assignee","assignees"]];
      for(const [field, masterKey] of refChecks){
        const v = t?.[field];
        if(typeof v !== "string") errors.push(`tasks.${id}.${field} が文字列ではありません。`);
        else if(v.startsWith("00_")) continue;
        else if(masterMap[masterKey] && !masterMap[masterKey].has(v)) errors.push(`tasks.${id}.${field} がマスタに存在しません: ${v}`);
      }

      if(t?.todos != null && !Array.isArray(t.todos)) errors.push(`tasks.${id}.todos は配列である必要があります。`);
      if(t?.urls != null && !Array.isArray(t.urls)) errors.push(`tasks.${id}.urls は配列である必要があります。`);
    }
  }

  if(data.worklogs != null && !Array.isArray(data.worklogs)) errors.push("worklogs は配列である必要があります。");
  if(Array.isArray(data.worklogs)){
    for(const wl of data.worklogs){
      if(!parseISODate(wl?.date)) errors.push(`worklogs.date が不正です: ${wl?.date ?? ""}`);
      const h = wl?.hours;
      if(typeof h !== "number") errors.push("worklogs.hours は数値である必要があります。");
      else{
        const q = h*4;
        if(Math.abs(q - Math.round(q)) > 1e-9) errors.push(`worklogs.hours は0.25刻みです: ${h}`);
      }
    }
  }

  return { ok: errors.length===0, errors };
}
function formatValidation(errors){
  if(!errors.length) return "";
  const head = `不整合が ${errors.length} 件あります。\n`;
  return head + errors.map((e,i)=>`${String(i+1).padStart(2,"0")}. ${e}`).join("\n");
}

// ---------- state ----------
const state = {
  data: createEmptyData(),
  filename: "tasks.yaml",
  dirty: false,
  view: "list"
};
function setData(data, filename){
  state.data = data;
  state.filename = filename || "tasks.yaml";
  state.dirty = false;
}
function markDirty(){
  state.dirty = true;
}

// ---------- alerts ----------
function computeAlerts(data){
  const meta = data.meta ?? {};
  const semantic = meta.semantic ?? {};
  const statusNotStarted = semantic.task_status_not_started ?? "01_未着手";
  const statusDone = semantic.task_status_done ?? "03_完了";
  const today = todayISO();

  const phaseBounds = new Map();
  for(const ph of (data.masters?.phases ?? [])){
    if(ph?.id_name && ph?.start_date && ph?.end_date){
      phaseBounds.set(ph.id_name, {start: ph.start_date, end: ph.end_date});
    }
  }

  let A=0,B=0,D=0;
  const details = {A:[],B:[],D:[]};
  for(const t of (data.tasks ?? [])){
    const st = t.status;
    const s = t.start_date, e = t.end_date;
    if(st === statusNotStarted && s && s < today){ A++; details.A.push(t.id); }
    if(st !== statusDone && e && e < today){ B++; details.B.push(t.id); }
    const pb = phaseBounds.get(t.phase);
    if(pb && s && e && (s < pb.start || e > pb.end)){ D++; details.D.push(t.id); }
  }
  return {A,B,D,details};
}
function updateFooter(){
  const a = computeAlerts(state.data);
  $("alertA").textContent = `A ${a.A}`;
  $("alertB").textContent = `B ${a.B}`;
  $("alertD").textContent = `D ${a.D}`;
}

// ---------- modal ----------
let modalTaskId = null;
let modalDraft = null;

function initModal(){
  $("modalClose").addEventListener("click", closeModal);
  $("modalCancel").addEventListener("click", closeModal);
  $("modalOverlay").addEventListener("click", (e)=>{ if(e.target?.id==="modalOverlay") closeModal(); });
  $("modalSave").addEventListener("click", saveModal);
}
function openTaskModal(taskId){
  const task = (state.data.tasks ?? []).find(t=>t.id===taskId);
  if(!task) return;
  modalTaskId = taskId;
  modalDraft = JSON.parse(JSON.stringify(task));
  $("modalTitle").textContent = `タスク詳細: ${taskId}`;
  renderModal();
  $("modalOverlay").classList.remove("hidden");
}
function closeModal(){
  modalTaskId = null; modalDraft = null;
  $("modalOverlay").classList.add("hidden");
}
function masters(){ return state.data.masters ?? {}; }
function renderModal(){
  const m = masters();
  const opts = (arr)=> ["00_未設定", ...(arr??[]).map(x=>x.id_name)];
  const catOpts = opts(m.categories), prioOpts = opts(m.priorities), phaseOpts = opts(m.phases),
        stOpts = opts(m.task_statuses), asOpts = opts(m.assignees),
        todoStOpts = opts(m.todo_statuses), todoActOpts = opts(m.todo_actions);

  const todos = modalDraft.todos ?? [];
  const urls = modalDraft.urls ?? [];

  function selectHtml(id,label,value,options){
    return `<label class="row" style="align-items:center;gap:10px">
      <span style="min-width:120px;color:var(--muted);font-weight:700">${escapeHtml(label)}</span>
      <select id="${escapeHtml(id)}" class="input" style="min-width:240px">${options.map(o=>`<option value="${escapeHtml(o)}" ${o===value?"selected":""}>${escapeHtml(o)}</option>`).join("")}</select>
    </label>`;
  }
  function inputHtml(id,label,value,type="text"){
    return `<label class="row" style="align-items:center;gap:10px">
      <span style="min-width:120px;color:var(--muted);font-weight:700">${escapeHtml(label)}</span>
      <input id="${escapeHtml(id)}" class="input" type="${escapeHtml(type)}" value="${escapeHtml(value ?? "")}" style="min-width:240px" />
    </label>`;
  }
  function textareaHtml(id,label,value){
    return `<div>
      <div style="color:var(--muted);font-weight:700;margin-bottom:6px">${escapeHtml(label)}</div>
      <textarea id="${escapeHtml(id)}" class="input">${escapeHtml(value ?? "")}</textarea>
    </div>`;
  }
  function todoRowHtml(todo){
    const tid = escapeHtml(todo.id);
    return `<div class="item" data-todo-id="${tid}">
      <div class="item-head">
        <div class="item-title">Todo: ${tid}</div>
        <button class="icon-btn" id="todo_del_${tid}" title="削除">×</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="todo_name_${tid}" class="input" style="flex:1" value="${escapeHtml(todo.name ?? "")}" />
        <select id="todo_action_${tid}" class="input">${todoActOpts.map(o=>`<option value="${escapeHtml(o)}" ${o===todo.action?"selected":""}>${escapeHtml(o)}</option>`).join("")}</select>
        <select id="todo_status_${tid}" class="input">${todoStOpts.map(o=>`<option value="${escapeHtml(o)}" ${o===todo.status?"selected":""}>${escapeHtml(o)}</option>`).join("")}</select>
      </div>
    </div>`;
  }
  function urlRowHtml(u){
    const uid = escapeHtml(u.id);
    return `<div class="item" data-url-id="${uid}">
      <div class="item-head">
        <div class="item-title">URL: ${uid}</div>
        <button class="icon-btn" id="url_del_${uid}" title="削除">×</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="url_name_${uid}" class="input" style="min-width:160px" value="${escapeHtml(u.name ?? "")}" placeholder="名称" />
        <input id="url_url_${uid}" class="input" style="flex:1" value="${escapeHtml(u.url ?? "")}" placeholder="https://..." />
      </div>
    </div>`;
  }

  $("modalBody").innerHTML = `
    <div class="two-col">
      <div class="card">
        <div class="toolbar">
          ${inputHtml("m_name","名称", modalDraft.name)}
          ${selectHtml("m_category","カテゴリ", modalDraft.category, catOpts)}
          ${selectHtml("m_priority","優先度", modalDraft.priority, prioOpts)}
          ${selectHtml("m_phase","フェーズ", modalDraft.phase, phaseOpts)}
          ${selectHtml("m_status","ステータス", modalDraft.status, stOpts)}
          ${selectHtml("m_assignee","担当者", modalDraft.assignee, asOpts)}
          ${inputHtml("m_start","開始日", modalDraft.start_date, "date")}
          ${inputHtml("m_end","終了日", modalDraft.end_date, "date")}
        </div>
        ${textareaHtml("m_memo","メモ", modalDraft.memo)}
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <div style="font-weight:800">Todo</div>
          <button class="btn primary" id="btnAddTodo">＋</button>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">ドラッグで順序変更 / ×で削除</div>
        <div id="todoList" class="list-inline">${todos.map(todoRowHtml).join("")}</div>

        <div class="hr"></div>

        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <div style="font-weight:800">URL</div>
          <button class="btn primary" id="btnAddUrl">＋</button>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">ドラッグで順序変更 / ×で削除</div>
        <div id="urlList" class="list-inline">${urls.map(urlRowHtml).join("")}</div>
      </div>
    </div>
  `;

  const bindField = (id, key) => {
    const el = $(id);
    const handler = ()=> { modalDraft[key] = el.value; };
    el.addEventListener("change", handler);
    el.addEventListener("input", handler);
  };
  bindField("m_name","name"); bindField("m_category","category"); bindField("m_priority","priority");
  bindField("m_phase","phase"); bindField("m_status","status"); bindField("m_assignee","assignee");
  bindField("m_start","start_date"); bindField("m_end","end_date"); bindField("m_memo","memo");

  $("btnAddTodo").addEventListener("click", ()=>{
    const next = (modalDraft.todos?.length ?? 0) + 1;
    const exists = new Set((modalDraft.todos??[]).map(x=>x.id));
    let n = next; let tid = `t${n}`;
    while(exists.has(tid)){ n++; tid = `t${n}`; }
    modalDraft.todos = modalDraft.todos ?? [];
    modalDraft.todos.push({id: tid, name:"新規Todo", action:"01_検証", status:"01_未着手"});
    renderModal();
  });
  $("btnAddUrl").addEventListener("click", ()=>{
    const next = (modalDraft.urls?.length ?? 0) + 1;
    const exists = new Set((modalDraft.urls??[]).map(x=>x.id));
    let n = next; let uid = `u${n}`;
    while(exists.has(uid)){ n++; uid = `u${n}`; }
    modalDraft.urls = modalDraft.urls ?? [];
    modalDraft.urls.push({id: uid, name:"リンク", url:""});
    renderModal();
  });

  // bind delete and edits
  for(const todo of todos){
    const tid = todo.id;
    $(`todo_name_${tid}`).addEventListener("input", (e)=>{ todo.name = e.target.value; });
    $(`todo_action_${tid}`).addEventListener("change", (e)=>{ todo.action = e.target.value; });
    $(`todo_status_${tid}`).addEventListener("change", (e)=>{ todo.status = e.target.value; });
    $(`todo_del_${tid}`).addEventListener("click", ()=>{ modalDraft.todos = modalDraft.todos.filter(x=>x.id!==tid); renderModal(); });
  }
  for(const u of urls){
    const uid = u.id;
    $(`url_name_${uid}`).addEventListener("input", (e)=>{ u.name = e.target.value; });
    $(`url_url_${uid}`).addEventListener("input", (e)=>{ u.url = e.target.value; });
    $(`url_del_${uid}`).addEventListener("click", ()=>{ modalDraft.urls = modalDraft.urls.filter(x=>x.id!==uid); renderModal(); });
  }

  // sortable
  if(window.Sortable){
    new window.Sortable($("todoList"), {animation:150, onEnd: ()=>{
      const ids = Array.from(document.querySelectorAll("[data-todo-id]")).map(el=>el.getAttribute("data-todo-id"));
      modalDraft.todos = ids.map(id=>modalDraft.todos.find(t=>t.id===id)).filter(Boolean);
    }});
    new window.Sortable($("urlList"), {animation:150, onEnd: ()=>{
      const ids = Array.from(document.querySelectorAll("[data-url-id]")).map(el=>el.getAttribute("data-url-id"));
      modalDraft.urls = ids.map(id=>modalDraft.urls.find(u=>u.id===id)).filter(Boolean);
    }});
  }
}
function saveModal(){
  if(!modalTaskId || !modalDraft) return;
  if(!modalDraft.name?.trim()){ alert("名称は必須です。"); return; }
  if(!modalDraft.start_date || !modalDraft.end_date){ alert("開始日・終了日は必須です。"); return; }
  if(modalDraft.start_date > modalDraft.end_date){ alert("開始日が終了日より後です。"); return; }

  const idx = (state.data.tasks ?? []).findIndex(t=>t.id===modalTaskId);
  if(idx < 0) return;
  state.data.tasks[idx] = modalDraft;
  markDirty();
  closeModal();
  renderCurrent();
  setStatus(`${state.filename} 読込済 / 未保存`);
}

// ---------- views ----------
function renderList(container){
  const data = state.data;
  const m = data.masters ?? {};
  const opts = (arr)=> ["00_未設定", ...(arr??[]).map(x=>x.id_name)];
  const catOpts = opts(m.categories), prioOpts = opts(m.priorities), phaseOpts = opts(m.phases),
        stOpts = opts(m.task_statuses), asOpts = opts(m.assignees);

  container.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="f_q" class="input" style="min-width:220px" placeholder="検索（ID/名称）" />
        <select id="f_status" class="input"><option value="">ステータス: 全て</option>${stOpts.map(o=>`<option>${o}</option>`).join("")}</select>
        <select id="f_phase" class="input"><option value="">フェーズ: 全て</option>${phaseOpts.map(o=>`<option>${o}</option>`).join("")}</select>
        <select id="f_assignee" class="input"><option value="">担当者: 全て</option>${asOpts.map(o=>`<option>${o}</option>`).join("")}</select>
        <span class="muted">※IDをダブルクリックで詳細</span>
      </div>
      <div style="overflow:auto">
        <table class="table">
          <thead>
            <tr>
              <th style="min-width:70px">ID</th>
              <th style="min-width:220px">名称</th>
              <th style="min-width:140px">カテゴリ</th>
              <th style="min-width:120px">優先度</th>
              <th style="min-width:160px">フェーズ</th>
              <th style="min-width:140px">ステータス</th>
              <th style="min-width:160px">担当者</th>
              <th style="min-width:120px">開始日</th>
              <th style="min-width:120px">終了日</th>
              <th style="min-width:90px"></th>
            </tr>
          </thead>
          <tbody id="listBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const qEl = container.querySelector("#f_q");
  const sEl = container.querySelector("#f_status");
  const pEl = container.querySelector("#f_phase");
  const aEl = container.querySelector("#f_assignee");
  const tbody = container.querySelector("#listBody");

  function sel(opts, v, id, field){
    return `<select id="${field}_${id}" class="input">${opts.map(o=>`<option value="${o}" ${o===v?"selected":""}>${o}</option>`).join("")}</select>`;
  }
  function rowHtml(t){
    const id = t.id;
    return `
      <tr>
        <td><span class="kbd" id="id_${id}" title="ダブルクリックで詳細">${id}</span></td>
        <td><input id="name_${id}" class="input" style="width:100%" value="${escapeHtml(t.name ?? "")}"/></td>
        <td>${sel(catOpts, t.category, id, "category")}</td>
        <td>${sel(prioOpts, t.priority, id, "priority")}</td>
        <td>${sel(phaseOpts, t.phase, id, "phase")}</td>
        <td>${sel(stOpts, t.status, id, "status")}</td>
        <td>${sel(asOpts, t.assignee, id, "assignee")}</td>
        <td><input id="start_date_${id}" class="input" type="date" value="${escapeHtml(t.start_date ?? "")}" /></td>
        <td><input id="end_date_${id}" class="input" type="date" value="${escapeHtml(t.end_date ?? "")}" /></td>
        <td><button class="btn" id="del_${id}" style="border-color:rgba(239,68,68,.25)">削除</button></td>
      </tr>
    `;
  }

  function renderRows(){
    const q = (qEl.value ?? "").trim().toLowerCase();
    const fs = sEl.value, fp = pEl.value, fa = aEl.value;
    const rows = (data.tasks ?? []).slice().sort((x,y)=>x.id.localeCompare(y.id)).filter(t=>{
      if(q){
        const hay = `${t.id} ${t.name}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      if(fs && t.status !== fs) return false;
      if(fp && t.phase !== fp) return false;
      if(fa && t.assignee !== fa) return false;
      return true;
    });
    tbody.innerHTML = rows.map(rowHtml).join("");

    for(const t of rows){
      const id = t.id;
      container.querySelector(`#id_${id}`).addEventListener("dblclick", ()=> openTaskModal(id));

      const bindText = (field, evt="input")=>{
        container.querySelector(`#${field}_${id}`).addEventListener(evt, (e)=>{
          const tt = state.data.tasks.find(x=>x.id===id); if(!tt) return;
          tt[field] = e.target.value;
          markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
        });
      };
      const bindSelect = (field)=>{
        container.querySelector(`#${field}_${id}`).addEventListener("change", (e)=>{
          const tt = state.data.tasks.find(x=>x.id===id); if(!tt) return;
          tt[field] = e.target.value;
          markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
        });
      };

      bindText("name");
      bindSelect("category"); bindSelect("priority"); bindSelect("phase"); bindSelect("status"); bindSelect("assignee");
      bindText("start_date","change"); bindText("end_date","change");

      container.querySelector(`#del_${id}`).addEventListener("click", ()=>{
        if(!confirm(`タスク ${id} を削除しますか？`)) return;
        state.data.tasks = state.data.tasks.filter(x=>x.id!==id);
        state.data.worklogs = (state.data.worklogs ?? []).filter(w=>w.task_id!==id);
        markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
        renderRows();
      });
    }
  }

  qEl.addEventListener("input", renderRows);
  sEl.addEventListener("change", renderRows);
  pEl.addEventListener("change", renderRows);
  aEl.addEventListener("change", renderRows);

  renderRows();
}


function ganttClassForTask(t){
  const doneToken = "_完了";
  const inProgress = "02_進行中";
  const done = (t.status ?? "").includes(doneToken);
  const today = todayISO();
  const delayed = (!done) && (t.end_date && t.end_date < today);
  if(delayed) return "gantt-delayed";
  if(done) return "gantt-done";
  if((t.status ?? "") === inProgress) return "gantt-progress";
  return "";
}

function renderGantt(container){
  container.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <span class="muted">ドラッグで移動 / 端を伸縮で期間変更（start/endが更新されます）</span>
      </div>
      <div style="overflow:auto"><svg id="gantt"></svg></div>
    </div>
  `;
  if(!window.Gantt){
    container.innerHTML = `<div class="notice"><strong>ガントライブラリが読み込めません</strong>CDNへのアクセス可否を確認してください。</div>`;
    return;
  }

  const doneId = state.data.meta?.semantic?.todo_status_done ?? "03_完了";
  const tasks = (state.data.tasks ?? []).slice().sort((a,b)=>a.id.localeCompare(b.id)).map(t=>{
    const todos = t.todos ?? [];
    let progress = 0;
    if(todos.length){
      const done = todos.filter(x=>x.status===doneId).length;
      progress = Math.round((done/todos.length)*100);
    } else {
      progress = (t.status ?? "").includes("_完了") ? 100 : 0;
    }
    return {
      id: t.id,
      name: `${t.id} ${t.name}`,
      start: t.start_date,
      end: t.end_date,
      progress,
      custom_class: ganttClassForTask(t)
    };
  });

  new window.Gantt("#gantt", tasks, {
    view_mode: "Day",
    date_format: "YYYY-MM-DD",
    on_date_change: (task, start, end)=>{
      const s = isoFromDate(start);
      const e = isoFromDate(end);
      const t = state.data.tasks.find(x=>x.id===task.id);
      if(!t) return;
      t.start_date = s; t.end_date = e;
      markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
    }
  });

  function isoFromDate(d){
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${yyyy}-${mm}-${dd}`;
  }
}

function renderKanban(container){
  const data = state.data;
  const m = data.masters ?? {};
  const axisOptions = [
    {key:"status", label:"ステータス"},
    {key:"phase", label:"フェーズ"},
    {key:"assignee", label:"担当者"},
    {key:"priority", label:"優先度"},
    {key:"category", label:"カテゴリ"}
  ];
  container.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <select id="axis" class="input">${axisOptions.map(o=>`<option value="${o.key}">${o.label}</option>`).join("")}</select>
        <input id="q" class="input" style="min-width:220px" placeholder="検索（ID/名称）" />
        <select id="f_phase" class="input"></select>
        <select id="f_status" class="input"></select>
        <select id="f_assignee" class="input"></select>
        <select id="f_priority" class="input"></select>
        <select id="f_category" class="input"></select>
        <span class="muted">※カードのダブルクリックで詳細</span>
      </div>
      <div id="kanban" class="kanban"></div>
    </div>
  `;

  const axisEl = container.querySelector("#axis");
  const qEl = container.querySelector("#q");
  const kanEl = container.querySelector("#kanban");

  const f = {
    phase: container.querySelector("#f_phase"),
    status: container.querySelector("#f_status"),
    assignee: container.querySelector("#f_assignee"),
    priority: container.querySelector("#f_priority"),
    category: container.querySelector("#f_category"),
  };

  const opt = (arr, label) => [`<option value="">${label}: 全て</option>`].concat((arr ?? []).map(x=>`<option value="${x.id_name}">${x.id_name}</option>`)).join("");
  f.phase.innerHTML = opt(m.phases, "フェーズ");
  f.status.innerHTML = opt(m.task_statuses, "ステータス");
  f.assignee.innerHTML = opt(m.assignees, "担当者");
  f.priority.innerHTML = opt(m.priorities, "優先度");
  f.category.innerHTML = opt(m.categories, "カテゴリ");

  function masterArrayForAxis(axisKey){
    const map = { status:m.task_statuses, phase:m.phases, assignee:m.assignees, priority:m.priorities, category:m.categories };
    return map[axisKey] ?? [];
  }
  function colHtml(id_name){
    return `<div class="kan-col" data-col="${escapeHtml(id_name)}">
      <div class="kan-col-head"><div class="kan-col-title">${escapeHtml(id_name)}</div></div>
      <div class="kan-col-body"></div>
    </div>`;
  }
  function cardHtml(t){
    return `<div class="kan-card" data-task-id="${escapeHtml(t.id)}">
      <div class="kan-card-id">${escapeHtml(t.id)}</div>
      <div class="kan-card-name">${escapeHtml(t.name ?? "")}</div>
    </div>`;
  }

  function render(){
    if(!window.Sortable){
      kanEl.innerHTML = `<div class="notice"><strong>SortableJSが読み込めません</strong>CDNへのアクセス可否を確認してください。</div>`;
      return;
    }
    const axisKey = axisEl.value;
    const cols = (masterArrayForAxis(axisKey) ?? []).map(x=>x.id_name);
    const query = (qEl.value ?? "").trim().toLowerCase();

    const tasks = (data.tasks ?? []).filter(t=>{
      if(query){
        const hay = `${t.id} ${t.name}`.toLowerCase();
        if(!hay.includes(query)) return false;
      }
      for(const k of Object.keys(f)){
        const v = f[k].value;
        if(v && t[k] !== v) return false;
      }
      return true;
    });

    kanEl.innerHTML = cols.map(colHtml).join("");

    for(const t of tasks){
      const key = t[axisKey];
      const col = Array.from(kanEl.querySelectorAll(".kan-col")).find(el=>el.getAttribute("data-col")===key);
      if(!col) continue;
      col.querySelector(".kan-col-body").insertAdjacentHTML("beforeend", cardHtml(t));
    }

    const bodies = Array.from(kanEl.querySelectorAll(".kan-col-body"));
    for(const b of bodies){
      new window.Sortable(b, {
        group: "kanban",
        animation: 150,
        onAdd: (evt)=>{
          const card = evt.item;
          const tid = card.getAttribute("data-task-id");
          const colId = evt.to.closest(".kan-col")?.getAttribute("data-col");
          const t = state.data.tasks.find(x=>x.id===tid);
          if(t && colId){
            t[axisKey] = colId;
            markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
          }
        }
      });
    }

    for(const el of kanEl.querySelectorAll(".kan-card")){
      el.addEventListener("dblclick", ()=> openTaskModal(el.getAttribute("data-task-id")));
    }
  }

  axisEl.addEventListener("change", render);
  qEl.addEventListener("input", render);
  for(const k of Object.keys(f)) f[k].addEventListener("change", render);

  render();
}

function renderWorklogs(container){
  const data = state.data;
  const m = data.masters ?? {};
  const assignees = ["00_未設定", ...(m.assignees ?? []).map(x=>x.id_name)];
  const tasks = (data.tasks ?? []).slice().sort((a,b)=>a.id.localeCompare(b.id));

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="toolbar">
          <input id="wl_date" class="input" type="date" value="${todayISO()}" />
          <select id="wl_assignee" class="input">${assignees.map(a=>`<option value="${a}">${a}</option>`).join("")}</select>
          <button id="wl_add" class="btn primary">＋ 行追加</button>
          <span class="muted">hours: 0.25刻み</span>
        </div>
        <div style="overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th style="min-width:110px">日付</th>
                <th style="min-width:160px">担当者</th>
                <th style="min-width:90px">タスク</th>
                <th style="min-width:140px">Todo</th>
                <th style="min-width:90px">工数(h)</th>
                <th style="min-width:220px">メモ</th>
                <th style="min-width:80px"></th>
              </tr>
            </thead>
            <tbody id="wl_body"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:800;margin-bottom:8px">サマリ</div>
        <div id="wl_summary"></div>
        <div class="hr"></div>
        <div class="notice">
          <strong>ポイント</strong>
          <div>・Todoは任意（タスク工数だけなら空でOK）</div>
          <div>・0.25h刻み</div>
        </div>
      </div>
    </div>
  `;

  const wlDate = container.querySelector("#wl_date");
  const wlAssignee = container.querySelector("#wl_assignee");
  const addBtn = container.querySelector("#wl_add");
  const tbody = container.querySelector("#wl_body");
  const summary = container.querySelector("#wl_summary");

  function todoOptionsForTask(taskId, selected){
    const t = tasks.find(x=>x.id===taskId);
    const todos = t?.todos ?? [];
    return [`<option value="">(タスクのみ)</option>`].concat(todos.map(td=>{
      return `<option value="${td.id}" ${td.id===selected?"selected":""}>${td.id} ${escapeHtml(td.name)}</option>`;
    })).join("");
  }

  function renderSummary(){
    const date = wlDate.value;
    const who = wlAssignee.value;
    const filtered = (data.worklogs ?? []).filter(w=>{
      if(date && w.date !== date) return false;
      if(who && who !== "00_未設定" && w.assignee !== who) return false;
      return true;
    });
    const total = filtered.reduce((acc,w)=> acc + (Number(w.hours)||0), 0);
    summary.innerHTML = `
      <div class="row">
        <span class="badge">日付: ${date}</span>
        <span class="badge">担当者: ${who}</span>
        <span class="badge">合計: ${total.toFixed(2)} h</span>
      </div>
    `;
  }

  function renderRows(){
    const rows = (data.worklogs ?? []).slice().sort((a,b)=>{
      if(a.date !== b.date) return a.date.localeCompare(b.date);
      if(a.assignee !== b.assignee) return a.assignee.localeCompare(b.assignee);
      return (a.task_id ?? "").localeCompare(b.task_id ?? "");
    });

    tbody.innerHTML = rows.map((r, idx)=>{
      const taskOpts = [`<option value="">(未選択)</option>`].concat(tasks.map(t=>`<option value="${t.id}" ${t.id===r.task_id?"selected":""}>${t.id} ${escapeHtml(t.name)}</option>`)).join("");
      return `
        <tr>
          <td><input id="date_${idx}" class="input" type="date" value="${escapeHtml(r.date ?? "")}" /></td>
          <td><select id="assignee_${idx}" class="input">${assignees.map(a=>`<option value="${a}" ${a===r.assignee?"selected":""}>${a}</option>`).join("")}</select></td>
          <td><select id="task_id_${idx}" class="input">${taskOpts}</select></td>
          <td><select id="todo_id_${idx}" class="input">${todoOptionsForTask(r.task_id, r.todo_id)}</select></td>
          <td><input id="hours_${idx}" class="input" type="number" step="0.25" min="0" value="${escapeHtml(r.hours ?? 0)}" /></td>
          <td><input id="note_${idx}" class="input" style="width:100%" value="${escapeHtml(r.note ?? "")}" /></td>
          <td><button class="btn" id="del_${idx}" style="border-color:rgba(239,68,68,.25)">削除</button></td>
        </tr>
      `;
    }).join("");

    rows.forEach((r, idx)=>{
      const bind = (field, evt="change")=>{
        container.querySelector(`#${field}_${idx}`).addEventListener(evt, (e)=>{
          if(field==="hours") r.hours = clampHoursToQuarter(e.target.value);
          else r[field] = e.target.value;
          markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
          if(field==="task_id"){
            // rerender to refresh todo choices
            renderRows();
            return;
          }
          renderSummary();
        });
      };
      bind("date"); bind("assignee"); bind("task_id"); bind("todo_id"); bind("hours","input"); bind("note","input");

      container.querySelector(`#del_${idx}`).addEventListener("click", ()=>{
        if(!confirm("この行を削除しますか？")) return;
        data.worklogs.splice(data.worklogs.indexOf(r), 1);
        markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
        renderRows();
      });
    });

    renderSummary();
  }

  addBtn.addEventListener("click", ()=>{
    const date = wlDate.value || todayISO();
    const assignee = wlAssignee.value || "00_未設定";
    data.worklogs = data.worklogs ?? [];
    data.worklogs.push({ date, assignee, task_id: tasks[0]?.id ?? "", todo_id:"", hours:0.25, note:"" });
    markDirty(); setStatus(`${state.filename} 読込済 / 未保存`); updateFooter();
    renderRows();
  });

  renderRows();
}

function renderDashboard(container){
  const data = state.data;
  const today = todayISO();
  const start = isoAddDays(today, -30);
  const end = isoAddDays(today, 30);

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="toolbar">
          <label class="row"><span class="muted" style="min-width:90px;font-weight:700">期間</span>
            <input id="d_from" class="input" type="date" value="${start}" />
            <span class="muted">〜</span>
            <input id="d_to" class="input" type="date" value="${end}" />
          </label>
          <button id="d_refresh" class="btn primary">更新</button>
        </div>
        <div id="d_cards" class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"></div>
        <div class="hr"></div>
        <div id="d_tables"></div>
      </div>

      <div class="card">
        <div style="font-weight:800;margin-bottom:8px">アラート詳細</div>
        <div id="d_alerts"></div>
        <div class="hr"></div>
        <div class="notice">
          <strong>定義</strong>
          <div>A: 開始日が過去なのに未着手</div>
          <div>B: 終了日が過去（期限超過）なのに未完了</div>
          <div>D: フェーズ期間外</div>
        </div>
      </div>
    </div>
  `;

  const fromEl = container.querySelector("#d_from");
  const toEl = container.querySelector("#d_to");
  const refresh = container.querySelector("#d_refresh");
  const cardsEl = container.querySelector("#d_cards");
  const tablesEl = container.querySelector("#d_tables");
  const alertsEl = container.querySelector("#d_alerts");

  function groupSum(rows, keyFn, valFn){
    const m = new Map();
    for(const r of rows){
      const k = keyFn(r) || "(未設定)";
      const v = valFn(r) || 0;
      m.set(k, (m.get(k)||0) + v);
    }
    return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]);
  }
  function tableFromEntries(title, entries){
    const rows = entries.map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v.toFixed(2)}</td></tr>`).join("");
    return `
      <div style="margin-top:12px">
        <div style="font-weight:900;margin-bottom:6px">${escapeHtml(title)}</div>
        <table class="table">
          <thead><tr><th>キー</th><th style="text-align:right">工数(h)</th></tr></thead>
          <tbody>${rows || "<tr><td class='muted'>(なし)</td><td></td></tr>"}</tbody>
        </table>
      </div>
    `;
  }

  function render(){
    const from = fromEl.value;
    const to = toEl.value;

    const tasksInRange = (data.tasks ?? []).filter(t=>{
      if(!t.start_date || !t.end_date) return false;
      return !(t.end_date < from || t.start_date > to);
    });
    const wlInRange = (data.worklogs ?? []).filter(w=> w.date >= from && w.date <= to);

    const hoursTotal = wlInRange.reduce((a,w)=>a+(Number(w.hours)||0),0);
    const tasksTotal = (data.tasks ?? []).length;
    const tasksActive = tasksInRange.length;

    cardsEl.innerHTML = `
      <div class="card"><div class="muted">タスク総数</div><div style="font-size:28px;font-weight:900">${tasksTotal}</div></div>
      <div class="card"><div class="muted">期間内タスク</div><div style="font-size:28px;font-weight:900">${tasksActive}</div></div>
      <div class="card"><div class="muted">期間内工数(h)</div><div style="font-size:28px;font-weight:900">${hoursTotal.toFixed(2)}</div></div>
    `;

    const byAssignee = groupSum(wlInRange, w=>w.assignee, w=>Number(w.hours)||0);
    const byTask = groupSum(wlInRange, w=>w.task_id, w=>Number(w.hours)||0);
    tablesEl.innerHTML = tableFromEntries("担当者別 工数(h)", byAssignee) + tableFromEntries("タスク別 工数(h)", byTask);

    const a = computeAlerts(data);
    alertsEl.innerHTML = `
      <div class="row" style="gap:10px;margin-bottom:10px">
        <span class="chip">A ${a.A}</span>
        <span class="chip">B ${a.B}</span>
        <span class="chip">D ${a.D}</span>
      </div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">対象タスクID</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        ${["A","B","D"].flatMap(k => a.details[k].map(id=>`<span class="kbd">${k}:${id}</span>`)).join("") || "<span class='muted'>(なし)</span>"}
      </div>
    `;
  }

  refresh.addEventListener("click", render);
  render();

  function isoAddDays(iso, days){
    const [y,m,d] = iso.split("-").map(Number);
    const dt = new Date(y, m-1, d);
    dt.setDate(dt.getDate()+days);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth()+1).padStart(2,"0");
    const dd = String(dt.getDate()).padStart(2,"0");
    return `${yyyy}-${mm}-${dd}`;
  }
}

// ---------- app ----------
const views = {
  list: { id:"view-list", render: renderList },
  gantt: { id:"view-gantt", render: renderGantt },
  kanban: { id:"view-kanban", render: renderKanban },
  worklogs: { id:"view-worklogs", render: renderWorklogs },
  dashboard: { id:"view-dashboard", render: renderDashboard }
};

function setStatus(text){
  $("statusline").textContent = text;
  document.title = (state.dirty ? "● " : "") + "YAML Task Manager";
}
function showView(name){
  state.view = name;
  for(const [k,v] of Object.entries(views)){
    $(v.id).classList.toggle("hidden", k !== name);
  }
  for(const btn of document.querySelectorAll(".tab")){
    btn.classList.toggle("active", btn.dataset.view === name);
  }
  renderCurrent();
}
function renderCurrent(){
  const v = views[state.view];
  if(!v) return;
  v.render($(v.id));
  updateFooter();
}

function ensureDefaults(data){
  data.meta = data.meta ?? {schema_version:"1.0", last_task_seq:0};
  data.meta.schema_version = data.meta.schema_version ?? "1.0";
  data.meta.last_task_seq = Number.isInteger(data.meta.last_task_seq) ? data.meta.last_task_seq : 0;
  data.meta.semantic = data.meta.semantic ?? {
    task_status_not_started: "01_未着手",
    task_status_done: "03_完了",
    todo_status_done: "03_完了"
  };

  data.masters = data.masters ?? {};
  const mk = data.masters;
  mk.assignees = mk.assignees ?? [];
  mk.task_statuses = mk.task_statuses ?? [{id_name:"01_未着手"},{id_name:"02_進行中"},{id_name:"03_完了"}];
  mk.todo_statuses = mk.todo_statuses ?? [{id_name:"01_未着手"},{id_name:"02_進行中"},{id_name:"03_完了"}];
  mk.categories = mk.categories ?? [];
  mk.priorities = mk.priorities ?? [{id_name:"01_高"},{id_name:"02_中"},{id_name:"03_低"}];
  mk.todo_actions = mk.todo_actions ?? [{id_name:"01_検証"},{id_name:"02_改修"},{id_name:"03_調査"},{id_name:"04_管理"}];
  mk.phases = mk.phases ?? [];

  data.tasks = data.tasks ?? [];
  data.worklogs = data.worklogs ?? [];
  return data;
}

function onLoaded(){
  initModal();

  $("tabs").addEventListener("click", (e)=>{
    const btn = e.target.closest(".tab");
    if(!btn) return;
    showView(btn.dataset.view);
  });

  $("fileInput").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    try{
      const data = ensureDefaults(parseYaml(text));
      const v = validateData(data);
      if(!v.ok) alert(formatValidation(v.errors));
      setData(data, file.name || "tasks.yaml");
      setStatus(`${state.filename} 読込済`);
      renderCurrent();
    } catch(err){
      console.error(err);
      alert("YAMLの読み込みに失敗しました。Consoleも確認してください。");
    } finally {
      e.target.value = "";
    }
  });

  $("btnDownload").addEventListener("click", ()=>{
    const v = validateData(state.data);
    if(!v.ok){
      if(!confirm(formatValidation(v.errors) + "\n\n不整合のまま保存しますか？")) return;
    }
    try{
      downloadYaml(state.filename || "tasks.yaml", state.data);
      state.dirty = false;
      setStatus(`${state.filename} 読込済 / 保存済(ダウンロード)`);
      updateFooter();
    }catch(err){
      console.error(err);
      alert("保存に失敗しました。Consoleを確認してください。");
    }
  });

  $("btnNewTask").addEventListener("click", ()=>{
    const t = createNewTask(state.data);
    markDirty();
    setStatus(`${state.filename} 読込済 / 未保存`);
    renderCurrent();
    openTaskModal(t.id);
  });

  setData(createEmptyData(), "tasks.yaml");
  setStatus("YAML未読込（sample/tasks.yaml を読み込むと動作確認できます）");
  renderCurrent();
}

document.addEventListener("DOMContentLoaded", onLoaded);

})();