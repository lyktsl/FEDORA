const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let processId = 1;
let lastInput = null;
let lastResults = {};

const sample = [
  { id:"P1", at:0, bt:8, pr:2 },
  { id:"P2", at:1, bt:4, pr:1 },
  { id:"P3", at:2, bt:2, pr:3 },
  { id:"P4", at:3, bt:5, pr:2 },
  { id:"P5", at:4, bt:3, pr:1 }
];

function addProcessRow(p = null) {
  const tbody = $("#processTable tbody");
  const id = p?.id || `P${processId++}`;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="process-name">${id}</td>
    <td><input class="cell-input at" type="number" min="0" step="1" value="${p?.at ?? 0}"></td>
    <td><input class="cell-input bt" type="number" min="1" step="1" value="${p?.bt ?? 1}"></td>
    <td><input class="cell-input pr" type="number" step="1" value="${p?.pr ?? 1}"></td>
    <td><button class="delete-btn" title="Remove process">×</button></td>
  `;
  tr.querySelector(".delete-btn").onclick = () => {
    tr.remove();
    updateCount();
  };
  tbody.appendChild(tr);
  updateCount();
}

function updateCount() {
  const n = $("#processTable tbody").children.length;
  $("#processCount").textContent = `${n} process${n === 1 ? "" : "es"}`;
}

function getProcesses() {
  const rows = $$("#processTable tbody tr");
  if (!rows.length) throw new Error("Add at least one process.");
  return rows.map((r, i) => {
    const id = r.querySelector(".process-name").textContent.trim() || `P${i+1}`;
    const at = Number(r.querySelector(".at").value);
    const bt = Number(r.querySelector(".bt").value);
    const pr = Number(r.querySelector(".pr").value);
    if (!Number.isFinite(at) || at < 0) throw new Error(`${id}: arrival time must be 0 or greater.`);
    if (!Number.isFinite(bt) || bt <= 0) throw new Error(`${id}: burst time must be greater than 0.`);
    if (!Number.isFinite(pr)) throw new Error(`${id}: priority must be a number.`);
    return { id, at, bt, pr, index:i };
  });
}

function cloneProcesses(ps) {
  return ps.map(p => ({...p, remaining:p.bt, firstStart:null, ct:null}));
}

function tieSort(a,b, primary) {
  return a[primary] - b[primary] || a.at - b.at || a.index - b.index;
}

function fcfs(ps) {
  const jobs = [...ps].sort((a,b)=>a.at-b.at || a.index-b.index);
  let t=0, timeline=[], metrics=[];
  for (const p of jobs) {
    if (t < p.at) { timeline.push({id:"IDLE", start:t, end:p.at}); t=p.at; }
    const start=t; t += p.bt;
    timeline.push({id:p.id,start,end:t});
    metrics.push({...p, firstStart:start, ct:t});
  }
  return finalize(metrics,timeline);
}

function sjf(ps) {
  const jobs = cloneProcesses(ps);
  let t=0, done=0, timeline=[], metrics=[];
  while(done<jobs.length) {
    const available=jobs.filter(p=>p.ct===null && p.at<=t);
    if(!available.length) {
      const next=Math.min(...jobs.filter(p=>p.ct===null).map(p=>p.at));
      timeline.push({id:"IDLE",start:t,end:next}); t=next; continue;
    }
    const p=available.sort((a,b)=>tieSort(a,b,"bt"))[0];
    if(p.firstStart===null) p.firstStart=t;
    const start=t; t+=p.bt; p.ct=t;
    timeline.push({id:p.id,start,end:t}); done++;
  }
  return finalize(jobs,timeline);
}

function srtf(ps) {
  const jobs=cloneProcesses(ps);
  let t=0, done=0, timeline=[];
  while(done<jobs.length) {
    const available=jobs.filter(p=>p.ct===null && p.at<=t && p.remaining>0);
    if(!available.length) {
      const future=jobs.filter(p=>p.ct===null && p.at>t);
      const next=Math.min(...future.map(p=>p.at));
      timeline.push({id:"IDLE",start:t,end:next}); t=next; continue;
    }
    const p=available.sort((a,b)=>tieSort(a,b,"remaining"))[0];
    if(p.firstStart===null) p.firstStart=t;
    const nextArrival=Math.min(...jobs.filter(x=>x.ct===null && x.at>t).map(x=>x.at), Infinity);
    const run=Math.min(p.remaining, nextArrival-t);
    const start=t; t+=run; p.remaining-=run;
    if(p.remaining===0) { p.ct=t; done++; }
    appendSegment(timeline,p.id,start,t);
  }
  return finalize(jobs,timeline);
}

function rr(ps, quantum) {
  const jobs=cloneProcesses(ps).sort((a,b)=>a.at-b.at || a.index-b.index);
  let t=0, i=0, done=0, queue=[], timeline=[];
  while(done<jobs.length) {
    while(i<jobs.length && jobs[i].at<=t) queue.push(jobs[i++]);
    if(!queue.length) {
      const next=jobs[i].at;
      timeline.push({id:"IDLE",start:t,end:next}); t=next;
      continue;
    }
    const p=queue.shift();
    if(p.firstStart===null) p.firstStart=t;
    const start=t, run=Math.min(quantum,p.remaining);
    t+=run; p.remaining-=run;
    appendSegment(timeline,p.id,start,t);
    while(i<jobs.length && jobs[i].at<=t) queue.push(jobs[i++]);
    if(p.remaining>0) queue.push(p);
    else { p.ct=t; done++; }
  }
  return finalize(jobs,timeline);
}

function priority(ps, preemptive) {
  const jobs=cloneProcesses(ps);
  let t=0, done=0, timeline=[];
  while(done<jobs.length) {
    const available=jobs.filter(p=>p.ct===null && p.at<=t);
    if(!available.length) {
      const next=Math.min(...jobs.filter(p=>p.ct===null).map(p=>p.at));
      timeline.push({id:"IDLE",start:t,end:next}); t=next; continue;
    }
    const p=available.sort((a,b)=>tieSort(a,b,"pr"))[0];
    if(p.firstStart===null) p.firstStart=t;
    if(preemptive) {
      const nextArrival=Math.min(...jobs.filter(x=>x.ct===null && x.at>t).map(x=>x.at),Infinity);
      const run=Math.min(p.remaining,nextArrival-t);
      const start=t; t+=run; p.remaining-=run;
      if(p.remaining===0){p.ct=t;done++;}
      appendSegment(timeline,p.id,start,t);
    } else {
      const start=t; t+=p.remaining; p.remaining=0; p.ct=t;
      appendSegment(timeline,p.id,start,t); done++;
    }
  }
  return finalize(jobs,timeline);
}

function appendSegment(timeline,id,start,end) {
  if(end<=start) return;
  const last=timeline[timeline.length-1];
  if(last && last.id===id && last.end===start) last.end=end;
  else timeline.push({id,start,end});
}

function finalize(jobs,timeline) {
  const metrics=jobs.map(p=>({
    id:p.id, at:p.at, bt:p.bt, pr:p.pr,
    ct:p.ct, tat:p.ct-p.at, wt:(p.ct-p.at)-p.bt,
    rt:p.firstStart-p.at
  })).sort((a,b)=>a.index-b.index);
  const avgWT=metrics.reduce((s,p)=>s+p.wt,0)/metrics.length;
  const avgTAT=metrics.reduce((s,p)=>s+p.tat,0)/metrics.length;
  const avgRT=metrics.reduce((s,p)=>s+p.rt,0)/metrics.length;
  return {metrics,timeline,avgWT,avgTAT,avgRT,totalTime: timeline.length ? timeline[timeline.length-1].end : 0};
}

const algorithmNames = {
  FCFS:"First-Come, First-Served (FCFS)",
  SJF:"Shortest Job First (SJF)",
  SRTF:"Shortest Remaining Time First (SRTF)",
  RR:"Round Robin (RR)",
  PRIORITY_NP:"Priority Scheduling — Non-Preemptive",
  PRIORITY_P:"Priority Scheduling — Preemptive"
};

function runAlgorithm(ps, alg, q=2) {
  switch(alg) {
    case "FCFS": return fcfs(ps);
    case "SJF": return sjf(ps);
    case "SRTF": return srtf(ps);
    case "RR": return rr(ps,q);
    case "PRIORITY_NP": return priority(ps,false);
    case "PRIORITY_P": return priority(ps,true);
    default: throw new Error("Unknown algorithm.");
  }
}

function renderGantt(result) {
  const el=$("#gantt"); el.innerHTML="";
  const row=document.createElement("div"); row.className="gantt-row";
  result.timeline.forEach((seg,i)=>{
    const d=document.createElement("div");
    d.className="gantt-segment"+(seg.id==="IDLE"?" idle":"");
    const width=Math.max(70,(seg.end-seg.start)*65);
    d.style.width=width+"px";
    d.innerHTML=`<strong>${seg.id}</strong>
      <small class="start-time">${seg.start}</small>
      <small class="end-time">${seg.end}</small>`;
    row.appendChild(d);
  });
  el.appendChild(row);
}

function renderMetrics(result) {
  $("#avgWT").textContent=result.avgWT.toFixed(2);
  $("#avgTAT").textContent=result.avgTAT.toFixed(2);
  $("#avgRT").textContent=result.avgRT.toFixed(2);
  $("#totalTime").textContent=result.totalTime;
  const tbody=$("#metricsTable tbody"); tbody.innerHTML="";
  result.metrics.forEach(p=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td class="process-name">${p.id}</td><td>${p.at}</td><td>${p.bt}</td><td>${p.pr}</td>
      <td>${p.ct}</td><td>${p.tat}</td><td>${p.wt}</td><td>${p.rt}</td>`;
    tbody.appendChild(tr);
  });
}


function simulate(showError=true) {
  try {
    const ps=getProcesses();
    const alg=$("#algorithm").value;
    const q=Number($("#quantum").value);
    if(alg==="RR" && (!Number.isInteger(q) || q<1)) throw new Error("Round Robin time quantum must be a whole number of at least 1.");
    lastInput=ps;
    const result=runAlgorithm(ps,alg,q);
    lastResults[alg]=result;
    renderGantt(result); renderMetrics(result); 
    $("#resultAlgorithm").textContent=algorithmNames[alg];
    $("#results").classList.remove("hidden");
    $("#results").scrollIntoView({behavior:"smooth",block:"start"});
    return result;
  } catch(e) {
    if(showError) alert(e.message);
    return null;
  }
}

function compareAll() {
  try {
    const ps=getProcesses(), q=Number($("#quantum").value);
    if(!Number.isInteger(q)||q<1) throw new Error("Set a valid Round Robin time quantum first.");
    const list=["FCFS","SJF","SRTF","RR","PRIORITY_NP"];
    const tbody=$("#comparisonTable tbody"); tbody.innerHTML="";
    list.forEach(alg=>{
      const r=runAlgorithm(ps,alg,q);
      lastResults[alg]=r;
      const tr=document.createElement("tr");
      tr.innerHTML=`<td class="process-name">${algorithmNames[alg]}</td>
        <td>${r.avgWT.toFixed(2)}</td><td>${r.avgTAT.toFixed(2)}</td><td>${r.avgRT.toFixed(2)}</td><td>${r.timeline.length}</td>`;
      tbody.appendChild(tr);
    });
    $("#comparison").scrollIntoView({behavior:"smooth",block:"start"});
  } catch(e) { alert(e.message); }
}

$("#addProcess").onclick=()=>addProcessRow();
$("#clearProcesses").onclick=()=>{ $("#processTable tbody").innerHTML=""; processId=1; updateCount(); };
$("#loadSample").onclick=()=>{
  $("#processTable tbody").innerHTML=""; processId=1;
  sample.forEach(p=>addProcessRow(p));
  $("#quantum").value=2;
  $("#algorithm").value="FCFS";
};
$("#runSimulation").onclick=()=>simulate(true);
$("#runTop").onclick=()=>simulate(true);
$("#compareAll").onclick=compareAll;

$("#algorithm").onchange=()=>{
  $("#quantumGroup").classList.toggle("hidden", $("#algorithm").value!=="RR");
};

sample.forEach(p=>addProcessRow(p));
