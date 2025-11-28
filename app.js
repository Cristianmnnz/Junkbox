// app.js — lógica completa de Beyblade Scoreboard
// --------------------------------------------------------------
// IMPORTANTE: el bracket (Double Elimination) se construye de manera
// "funcional": guardamos SOLO resultados y se recalcula en cada render.
// Así nunca se rompe y siempre se actualiza.
// --------------------------------------------------------------

(() => {
  // =======================
  // Helpers DOM / utilidades
  // =======================
  const $ = (s)=>document.querySelector(s);
  const uid = ()=>Math.random().toString(36).slice(2,9);
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const timeNow=()=>new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  const dateToday=()=>new Date().toLocaleDateString();

  // =======================
  // Estado global de la app
  // =======================
  const state = {
    players: [],          // jugadores del scoreboard
    history: [],          // historial de rondas
    round: 1,
    theme: "dark",
    skin: "classic",

    // reglas de partida
    rules: {
      mode: "firstTo",
      firstToN: 3,
      bestOfM: 5,
      pointsSpin:1, pointsOver:2, pointsBurst:3, pointsRO:2, pointsKO:2,
      sounds:"on", autoReset:"off",
      timerMode:"up", timerCountdown:180
    },

    // torneo
    tourneyName:"Torneo Beyblade",
    maxPlayers:8,
    bracketType:"double", // "double" o "single"

    seeds:[],             // array de player ids en orden

    zoom:100,

    // NUEVO bracket estable:
    bracket: null,        // {type:"double", results:{mid:1|2}}
    timer:{running:false,startAt:0,elapsed:0},
    lastAction:null
  };

  // ============= Persistencia =============
  const load=()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("junkbox-beyblade"));
      if(saved) Object.assign(state, saved);

      // SANITIZE loaded state (evita corrupciones en localStorage)
      if(!Array.isArray(state.seeds) || state.seeds.length>64) state.seeds=[];
      if(typeof state.maxPlayers!=="number" || !isFinite(state.maxPlayers)) state.maxPlayers=8;
      if(state.maxPlayers>16) state.maxPlayers=16;
      if(state.maxPlayers<2) state.maxPlayers=8;

      if(state.bracket){
        if(state.bracket.type!=="double" && state.bracket.type!=="single") state.bracket.type="double";
        if(!state.bracket.results || typeof state.bracket.results!=="object") state.bracket.results={};
        if(Object.keys(state.bracket.results).length>512) state.bracket=null;
      }
    }catch(e){}
  };
  const save=()=>localStorage.setItem("junkbox-beyblade", JSON.stringify(state));

  // ============= Sonidos =============
  let audioCtx=null;
  const beep=(type="click")=>{
    if(state.rules.sounds==="off") return;
    if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    const presets={click:[700,.04],win:[520,.12],over:[180,.18],burst:[120,.25],ro:[260,.18],spin:[420,.16],ko:[160,.22],champ:[640,.35],alarm:[880,.6]};
    const [freq,dur]=presets[type]||presets.click;
    o.type="sawtooth"; o.frequency.value=freq;
    g.gain.value=0.0001;
    g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+dur);
    o.start(); o.stop(audioCtx.currentTime+dur+0.02);
  };

  // Arena animada
  const showArena=(msg)=>{
    const top=$("#topSpin"), text=$("#arenaText");
    text.textContent=msg; top.classList.add("show");
    setTimeout(()=>top.classList.remove("show"),1200);
  };

  // ============= Tabs =============
  const setTab=(name)=>{
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===name));
    document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active", p.id==="pane-"+name));
    window.scrollTo({top:0,behavior:"smooth"});
  };
  document.querySelectorAll(".tab").forEach(t=>{
    t.addEventListener("click",()=>{beep("click"); setTab(t.dataset.tab);});
  });

  // ============= Timer =============
  let timerInterval=null;
  const fmtTime=(ms)=>{
    const s=Math.max(0,Math.floor(ms/1000));
    const m=Math.floor(s/60), r=s%60;
    return String(m).padStart(2,"0")+":"+String(r).padStart(2,"0");
  };
  const timerTotalMs=()=>state.rules.timerCountdown*1000;
  const timerDisplayedMs=()=>state.rules.timerMode==="up" ? state.timer.elapsed : timerTotalMs()-state.timer.elapsed;
  const renderTimer=()=>$("#timerValue").textContent=fmtTime(timerDisplayedMs());

  const timerTick=()=>{
    const now=Date.now();
    state.timer.elapsed+=(now-state.timer.startAt);
    state.timer.startAt=now;

    if(state.rules.timerMode==="down" && state.timer.elapsed>=timerTotalMs()){
      state.timer.elapsed=timerTotalMs();
      renderTimer(); timerPause(); beep("alarm"); showArena("⏱️ ¡Tiempo!");
    }else renderTimer();
    save();
  };
  const timerStart=()=>{
    if(state.timer.running) return;
    state.timer.running=true; state.timer.startAt=Date.now();
    timerInterval=setInterval(timerTick,250);
  };
  const timerPause=()=>{
    if(!state.timer.running) return;
    state.timer.running=false; clearInterval(timerInterval); timerInterval=null; save();
  };
  const timerReset=()=>{
    state.timer.running=false; clearInterval(timerInterval); timerInterval=null;
    state.timer.elapsed=0; state.timer.startAt=0; renderTimer(); save();
  };

  // ============= Helpers de UI =============
  const leader=()=>state.players.length?state.players.reduce((a,b)=>b.score>a.score?b:a,state.players[0]):null;
  const remainingGoalText=()=>state.rules.mode==="firstTo" ? `${state.rules.firstToN} victorias` : `${state.rules.bestOfM} rondas`;
  const modeLabelText=()=>state.rules.mode==="firstTo" ? `First to ${state.rules.firstToN}` : `Best of ${state.rules.bestOfM}`;

  const applySkinClass=()=>{
    document.body.classList.remove("skin-classic","skin-fire","skin-ice","skin-neon","skin-void");
    document.body.classList.add("skin-"+state.skin);
  };
  const applyZoom=()=>{
    const z=clamp(state.zoom,60,140);
    state.zoom=z;
    const wrap = $("#zoomWrap");
    wrap.style.transform = `scale(${z/100})`;
    wrap.style.transformOrigin = window.innerWidth <= 420 ? "top center" : "top left";
    $("#zoomSlider").value=z; 
    $("#zoomLabel").textContent=z+"%";
  };

  const renderRound=()=>{
    $("#roundLabel").textContent=state.round;
    $("#goalLabel").textContent=remainingGoalText();
    $("#modeLabel").textContent=modeLabelText();
    document.body.classList.toggle("light", state.theme==="light");
    applySkinClass();
    $("#bracketTitle").textContent=state.tourneyName||"Torneo";
    $("#bracketDate").textContent=dateToday();
    applyZoom();
  };

  // =========================
  // Seeds (orden del torneo)
  // =========================
  const ensureSeeds=()=>{
    const ids=state.players.map(p=>p.id);
    if(!state.seeds.length){ state.seeds=[...ids]; return; }
    state.seeds=state.seeds.filter(id=>ids.includes(id));
    ids.forEach(id=>{ if(!state.seeds.includes(id)) state.seeds.push(id); });
  };

  const renderSeeds=()=>{
    ensureSeeds();
    const wrap=$("#seedWrap"); wrap.innerHTML="";
    if(!state.players.length){ wrap.innerHTML=`<div class="empty">Añade jugadores primero.</div>`; return; }

    state.seeds.forEach((id,idx)=>{
      const p=state.players.find(x=>x.id===id); if(!p) return;
      const row=document.createElement("div");
      row.className="seedRow";
      row.innerHTML=`
        <div class="left">
          <div class="seedNum">${idx+1}</div>
          <div class="seedHandle" aria-label="arrastrar">⠿</div>
          <div class="dot" style="background:${p.color}"></div>
          <div class="seedName">${p.name}</div>
        </div>
        <div class="seedBtns">
          <button class="ghost" data-act="seedUp" data-idx="${idx}">▲</button>
          <button class="ghost" data-act="seedDown" data-idx="${idx}">▼</button>
        </div>
      `;
      row.dataset.seedId=id; row.dataset.seedIndex=idx;
      wrap.appendChild(row);
    });
  };

  const moveSeed=(from,to)=>{
    ensureSeeds();
    if(to<0||to>=state.seeds.length) return;
    const arr=state.seeds; const [x]=arr.splice(from,1); arr.splice(to,0,x);
    state.seeds=arr;
  };
  const shuffle=(arr)=>arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  const randomizeSeeds=()=>{ ensureSeeds(); state.seeds=shuffle(state.seeds); };
  const resetSeeds=()=>{ state.seeds=state.players.map(p=>p.id); };

  // Drag & drop seeds
  let dragSeedIndex=null;
  const getSeedRow=(el)=>el.closest(".seedRow");
  const dragEndSeeds=()=>{
    dragSeedIndex=null;
    document.querySelectorAll(".seedRow").forEach(r=>r.classList.remove("dragging","dropTarget"));
  };
  $("#seedWrap").addEventListener("pointerdown",(e)=>{
    const row=getSeedRow(e.target); if(!row||!e.target.closest(".seedHandle")) return;
    dragSeedIndex=parseInt(row.dataset.seedIndex,10);
    row.setPointerCapture(e.pointerId); row.classList.add("dragging");
  });
  $("#seedWrap").addEventListener("pointermove",(e)=>{
    if(dragSeedIndex===null) return;
    const over=document.elementFromPoint(e.clientX,e.clientY);
    const overRow=getSeedRow(over); if(!overRow) return;
    document.querySelectorAll(".seedRow").forEach(r=>r.classList.remove("dropTarget"));
    overRow.classList.add("dropTarget");
  });
  $("#seedWrap").addEventListener("pointerup",(e)=>{
    if(dragSeedIndex===null) return;
    const over=document.elementFromPoint(e.clientX,e.clientY);
    const overRow=getSeedRow(over);
    if(overRow){
      const to=parseInt(overRow.dataset.seedIndex,10);
      if(to!==dragSeedIndex){ moveSeed(dragSeedIndex,to); refreshBracketRealtime(); }
    }
    dragEndSeeds(); renderAll();
  });
  $("#seedWrap").addEventListener("pointercancel",()=>{dragEndSeeds(); renderAll();});

  // =========================
  // Scoreboard / jugadores
  // =========================
  const renderPlayers=()=>{
    const wrap=$("#playersWrap"); wrap.innerHTML="";
    if(!state.players.length){
      wrap.innerHTML=`<div class="empty" style="grid-column:1/-1;">Añade jugadores 👆</div>`;
      return;
    }
    const l=leader();
    state.players.forEach(p=>{
      const div=document.createElement("div");
      div.className="player"+(l&&l.id===p.id?" active":"");
      div.innerHTML=`
        <div class="p-head">
          <div class="dot" style="background:${p.color}"></div>
          <div class="p-name" data-act="quickSpin" data-id="${p.id}">${p.name}</div>
          ${l&&l.id===p.id?`<span class="badge">👑 Líder</span>`:""}
        </div>

        <div class="scoreBox">
          <div class="scoreMain">${p.score}</div>
          <div class="scoreWins">🏁 Victorias: <b>${p.wins}</b></div>
        </div>

        <div class="p-actions">
          <button class="bad" data-act="minus5" data-id="${p.id}">-5</button>
          <button class="bad" data-act="minus1" data-id="${p.id}">-1</button>
          <button class="good" data-act="plus1" data-id="${p.id}">+1</button>
          <button class="good" data-act="plus5" data-id="${p.id}">+5</button>
        </div>

        <div class="p-actions two">
          <button class="gold" data-act="spin" data-id="${p.id}">Spin +${state.rules.pointsSpin}</button>
          <button class="gold" data-act="over" data-id="${p.id}">Over +${state.rules.pointsOver}</button>
          <button class="gold" data-act="burst" data-id="${p.id}">Burst +${state.rules.pointsBurst}</button>
          <button class="gold" data-act="ro" data-id="${p.id}">Ring-Out +${state.rules.pointsRO}</button>
        </div>

        <div class="p-actions three">
          <button class="secondary" data-act="ko" data-id="${p.id}">KO +${state.rules.pointsKO}</button>
          <button class="ghost" data-act="rename" data-id="${p.id}">Renombrar</button>
          <button class="ghost" data-act="remove" data-id="${p.id}">Eliminar</button>
        </div>

        <div class="p-footer">
          <span>Spin: <b>${p.spins}</b></span>
          <span>Over: <b>${p.overs}</b></span>
          <span>Burst: <b>${p.bursts}</b></span>
          <span>RO: <b>${p.ringouts}</b></span>
          <span>KO: <b>${p.kos}</b></span>
          <span>Racha: <b>${p.streak}</b></span>
        </div>
      `;
      wrap.appendChild(div);
    });
  };

  const renderHistory=()=>{
    const wrap=$("#historyWrap"); wrap.innerHTML="";
    if(!state.history.length){
      wrap.innerHTML=`<div class="empty">Sin rondas todavía.</div>`; return;
    }
    [...state.history].reverse().forEach(h=>{
      const div=document.createElement("div");
      div.className="entry";
      div.innerHTML=`
        <div class="title">Ronda ${h.round} • ${h.label}</div>
        <div class="meta">${h.time} ${h.duration?`• ⏱ ${h.duration}`:""}</div>
        <div class="delta">
          ${h.deltas.map(d=>`
            <span><b style="color:${d.color}">${d.name}</b>
            ${d.delta>0?`<span style="color:var(--good)">+${d.delta}</span>`:
              d.delta<0?`<span style="color:var(--bad)">${d.delta}</span>`:
              `<span style="color:var(--muted)">0</span>`}</span>`).join("")}
        </div>
      `;
      wrap.appendChild(div);
    });
  };

  const renderStats=()=>{
    const wrap=$("#statsWrap"); wrap.innerHTML="";
    if(!state.players.length){
      wrap.innerHTML=`<div class="empty" style="grid-column:1/-1;">Sin jugadores.</div>`; return;
    }
    const totalRounds=state.history.filter(h=>/Finish|Ring-Out|KO/.test(h.label)).length||0;
    state.players.forEach(p=>{
      const played=totalRounds;
      const winRate=played?Math.round((p.wins/played)*100):0;
      const avgPts=played?(p.score/played).toFixed(2):p.score.toFixed(2);
      const card=document.createElement("div");
      card.className="statCard";
      card.innerHTML=`
        <div class="statTitle" style="display:flex;align-items:center;gap:6px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${p.color};display:inline-block;"></span>
          ${p.name}
        </div>
        <div class="row">
          <div style="flex:1"><div class="statTitle">Puntos</div><div class="statVal">${p.score}</div></div>
          <div style="flex:1"><div class="statTitle">Win rate</div><div class="statVal">${winRate}%</div></div>
        </div>
        <div class="row">
          <div style="flex:1"><div class="statTitle">Victorias</div><div class="statVal">${p.wins}</div></div>
          <div style="flex:1"><div class="statTitle">Prom pts/ronda</div><div class="statVal">${avgPts}</div></div>
        </div>
      `;
      wrap.appendChild(card);
    });
  };

  // Historial helpers
  const pushHistory=(label, roundIncrement, deltas)=>{
    const duration=state.timer.elapsed>0?fmtTime(timerDisplayedMs()):null;
    state.history.push({round:state.round,label,time:timeNow(),duration,deltas});
    if(roundIncrement) state.round++;
    timerReset();
  };
  const deltasFor=(id,delta)=>state.players.map(pl=>({id:pl.id,name:pl.name,color:pl.color,delta:pl.id===id?delta:0}));

  // Core logic players
  const addPlayer=(name,score,color)=>{
    state.players.push({
      id:uid(), name:name||`Jugador ${state.players.length+1}`,
      score:clamp(score,0,9999), color,
      wins:0, spins:0, overs:0, bursts:0, ringouts:0, kos:0,
      streak:0, bestStreak:0
    });
    ensureSeeds(); refreshBracketRealtime(); state.lastAction={type:"addPlayer"}; renderAll();
  };

  const changeScore=(id,delta,label)=>{
    const p=state.players.find(x=>x.id===id); if(!p) return;
    p.score=clamp(p.score+delta,0,9999);
    state.lastAction={type:"score",id,delta};
    pushHistory(label,false,deltasFor(id,delta));
    renderAll();
  };

  const award=(id,kind)=>{
    const p=state.players.find(x=>x.id===id); if(!p) return;
    let pts=0,label="",sound="win",arenaMsg="";
    if(kind==="spin"||kind==="quickSpin"){pts=state.rules.pointsSpin;p.spins++;label=`Spin Finish de ${p.name}`;sound="spin";arenaMsg="🌀 Spin Finish!";}
    if(kind==="over"){pts=state.rules.pointsOver;p.overs++;label=`Over Finish de ${p.name}`;sound="over";arenaMsg="💥 Over Finish!";}
    if(kind==="burst"){pts=state.rules.pointsBurst;p.bursts++;label=`Burst Finish de ${p.name}`;sound="burst";arenaMsg="🧨 Burst Finish!";}
    if(kind==="ro"){pts=state.rules.pointsRO;p.ringouts++;label=`Ring-Out de ${p.name}`;sound="ro";arenaMsg="🌪️ Ring-Out!";}
    if(kind==="ko"){pts=state.rules.pointsKO;p.kos++;label=`KO de ${p.name}`;sound="ko";arenaMsg="🔥 KO!";}

    state.players.forEach(x=>{
      if(x.id===id){x.wins++;x.streak++;x.bestStreak=Math.max(x.bestStreak,x.streak);}
      else x.streak=0;
    });
    p.score=clamp(p.score+pts,0,9999);
    state.lastAction={type:kind,id,delta:pts};
    pushHistory(label,true,deltasFor(id,pts));
    beep(sound); showArena(arenaMsg);
    checkEndCondition(); renderAll();
  };

  const checkEndCondition=()=>{
    if(state.rules.mode==="firstTo"){
      const winner=state.players.find(p=>p.wins>=state.rules.firstToN);
      if(winner){
        beep("champ"); showArena(`🏆 ${winner.name} ganó`);
        alert(`🏆 ${winner.name} ganó (First to ${state.rules.firstToN})`);
        if(state.rules.autoReset==="on") resetAll(false);
      }
    }else{
      if(state.round>state.rules.bestOfM){
        const winner=state.players.reduce((a,b)=>b.wins>a.wins?b:a,state.players[0]);
        beep("champ"); showArena(`🏆 ${winner.name} ganó`);
        alert(`🏆 ${winner.name} ganó (Best of ${state.rules.bestOfM})`);
        if(state.rules.autoReset==="on") resetAll(false);
      }
    }
  };

  const renamePlayer=(id)=>{
    const p=state.players.find(x=>x.id===id); if(!p) return;
    const n=prompt("Nuevo nombre:",p.name); if(!n) return;
    p.name=n.slice(0,18); refreshBracketRealtime(); renderAll();
  };
  const removePlayer=(id)=>{
    const p=state.players.find(x=>x.id===id); if(!p) return;
    if(!confirm(`Eliminar a ${p.name}?`)) return;
    state.players=state.players.filter(x=>x.id!==id);
    ensureSeeds(); refreshBracketRealtime(); renderAll();
  };

  const newRound=()=>{
    pushHistory("Nueva ronda manual",true,state.players.map(pl=>({id:pl.id,name:pl.name,color:pl.color,delta:0})));
    renderAll();
  };

  const undoLast=()=>{
    const a=state.lastAction; if(!a){alert("Nada que deshacer.");return;}
    const p=state.players.find(x=>x.id===a.id);
    if(a.type==="score"&&p){p.score=clamp(p.score-a.delta,0,9999); state.history.pop();}
    if(["spin","over","burst","ro","ko","quickSpin"].includes(a.type)&&p){
      p.score=clamp(p.score-a.delta,0,9999);
      if(a.type==="spin"||a.type==="quickSpin") p.spins=Math.max(0,p.spins-1);
      if(a.type==="over") p.overs=Math.max(0,p.overs-1);
      if(a.type==="burst") p.bursts=Math.max(0,p.bursts-1);
      if(a.type==="ro") p.ringouts=Math.max(0,p.ringouts-1);
      if(a.type==="ko") p.kos=Math.max(0,p.kos-1);
      p.wins=Math.max(0,p.wins-1);
      state.history.pop(); state.round=Math.max(1,state.round-1);
    }
    state.lastAction=null; renderAll();
  };

  const resetAll=(ask=true)=>{
    if(ask&&!confirm("¿Resetear partida?")) return;
    state.players=[]; state.history=[]; state.round=1; state.lastAction=null;
    state.bracket=null; state.seeds=[];
    timerReset(); renderAll();
  };

  // Export/import
  const exportJSON=()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download="beyblade.json"; a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJSON=()=>{
    const txt=prompt("Pega JSON exportado:"); if(!txt) return;
    try{ Object.assign(state, JSON.parse(txt)); ensureSeeds(); renderAll(); }
    catch(e){ alert("JSON inválido"); }
  };

  // Share code + QR
  const makeShareCode=()=>{
    const json=JSON.stringify(state);
    const code=btoa(unescape(encodeURIComponent(json)));
    $("#shareCodeArea").value=code;
    const qr=$("#qrImg");
    qr.src="https://chart.googleapis.com/chart?cht=qr&chs=220x220&chl="+encodeURIComponent(code);
    qr.style.display="block"; beep("click");
  };
  const loadShareCode=()=>{
    const code=$("#shareCodeArea").value.trim(); if(!code) return alert("Pega un código.");
    try{
      const json=decodeURIComponent(escape(atob(code)));
      Object.assign(state, JSON.parse(json)); ensureSeeds(); renderAll();
      alert("Código cargado ✅");
    }catch(e){alert("Código inválido");}
  };

  // ==========================================
  // Double Elimination ESTABLE (Opción B)
  // ==========================================
  // buildDoubleElim(seeds, results) devuelve TODA la estructura
  // de winners/losers/grandFinal siempre a partir de:
  //  - seeds: jugadores ordenados (array de player | null)
  //  - results: { mid : 1 | 2 }
  function buildDoubleElim(seeds, results){
    // Guardas de seguridad para evitar brackets corruptos
    const MAX_PLAYERS_SAFE = 16; // la UI solo permite 8 o 16
    if(!Array.isArray(seeds)) seeds=[];
    seeds = seeds.slice(0, MAX_PLAYERS_SAFE);
    if(!results || typeof results !== 'object') results = {};
    
    const padToPow2=(arr)=>{
      const n=Math.pow(2, Math.ceil(Math.log2(arr.length||1)));
      const out=[...arr];
      while(out.length<n) out.push(null);
      return out;
    };

    const W=[], L=[];
    const s=padToPow2(seeds);

    // Winners Round 1
    W[0]=[];
    for(let i=0;i<s.length;i+=2){
      W[0].push({mid:`W1-${i/2}`, p1:s[i], p2:s[i+1]});
    }

    // Crear todas las rondas Winners vacías
    let r=0;
    while(W[r].length>1){
      W[r+1]=[];
      for(let m=0;m<W[r].length;m+=2){
        W[r+1].push({mid:`W${r+2}-${m/2}`, p1:null, p2:null});
      }
      r++;
    }

    // Avanzar winners y poblar losers según resultados
    for(let ri=0; ri<W.length-1; ri++){
      W[ri].forEach((match, mi)=>{
        const winSide=results[match.mid];
        if(!winSide) return;

        const winner=winSide===1?match.p1:match.p2;
        const loser =winSide===1?match.p2:match.p1;

        // pasa ganador a siguiente ronda winners
        const next=W[ri+1][Math.floor(mi/2)];
        if(mi%2===0) next.p1=winner; else next.p2=winner;

        // perdedor cae a losers (patrón clásico)
        if(loser){
          const lrIndex=ri*2; // índice esperado
          if(lrIndex>30) return; // guardia extra
          if(!L[lrIndex]) L[lrIndex]=[];
          const slotIndex=Math.floor(mi/2);
          if(!L[lrIndex][slotIndex]){
            L[lrIndex][slotIndex]={mid:`L${lrIndex+1}-${slotIndex}`, p1:null, p2:null};
          }
          const lmatch=L[lrIndex][slotIndex];
          if(mi%2===0) lmatch.p1=loser; else lmatch.p2=loser;
        }
      });
    }

    // Construir/avanzar losers rounds a partir de sus resultados
    for(let li=0; li<L.length; li++){
      if(!L[li]) continue;
      if(!L[li+1]) L[li+1]=[];

      for(let mi=0; mi<L[li].length; mi++){
        const m=L[li][mi];
        const winSide=results[m.mid];
        if(!winSide) continue;
        const winner=winSide===1?m.p1:m.p2;
        const nextIndex=Math.floor(mi/2);

        if(!L[li+1][nextIndex]){
          L[li+1][nextIndex]={mid:`L${li+2}-${nextIndex}`, p1:null, p2:null};
        }
        const next=L[li+1][nextIndex];
        if(mi%2===0) next.p1=winner; else next.p2=winner;
      }
    }

    // Grand final (cuando hay campeones W y L)
    const lastW=W[W.length-1]?.[0]||null;
    const lastL=L.filter(Boolean).pop()?.[0]||null;
    const grandFinal=(lastW && lastL && lastW.p1 && lastL.p1)
      ? {mid:"G1-1", p1:lastW.p1, p2:lastL.p1}
      : null;

    return {W,L,grandFinal};
  }

  // ==============================
  // Single Elimination ESTABLE
  // ==============================
  // Similar al doble, pero sin losers.
  function buildSingleElim(seeds, results){
    const padToPow2=(arr)=>{
      const n=Math.pow(2, Math.ceil(Math.log2(arr.length||1)));
      const out=[...arr];
      while(out.length<n) out.push(null);
      return out;
    };

    const R=[]; // rounds
    const s=padToPow2(seeds);

    // Round 1
    R[0]=[];
    for(let i=0;i<s.length;i+=2){
      R[0].push({mid:`S1-${i/2}`, p1:s[i], p2:s[i+1]});
    }

    // Crear rondas siguientes vacías
    let r=0;
    while(R[r].length>1){
      R[r+1]=[];
      for(let m=0;m<R[r].length;m+=2){
        R[r+1].push({mid:`S${r+2}-${m/2}`, p1:null, p2:null});
      }
      r++;
    }

    // Avanzar según resultados
    for(let ri=0; ri<R.length-1; ri++){
      R[ri].forEach((match, mi)=>{
        const winSide=results[match.mid];
        if(!winSide) return;
        const winner=winSide===1?match.p1:match.p2;
        const next=R[ri+1][Math.floor(mi/2)];
        if(mi%2===0) next.p1=winner; else next.p2=winner;
      });
    }

    const finalMatch=R[R.length-1]?.[0]||null;
    return {R, finalMatch};
  }

  // Genera bracket base (limpia resultados)
  // Genera torneo según el tipo seleccionado
  const genBracket=()=>{
    ensureSeeds();
    if(state.players.length<2) return alert("Necesitas mínimo 2 jugadores.");
    state.bracket={type:state.bracketType, results:{}}; // SOLO resultados
    renderAll();
  };

  // Alias viejo por compatibilidad (botón "Generar torneo doble")
  const genDoubleElim=()=>genBracket();

  // Recalcula bracket si hay un bracket activo
  const refreshBracketRealtime=()=>{
    if(!state.bracket) return;
    renderAll();
  };

  // Marcar ganador en un match (click o drag)
  // Marcar ganador en un match (click o drag)
// Guarda ganador de forma segura y re-renderiza en el próximo frame
const setMatchWinner = (mid, side) => {
  if (!state.bracket || !mid || (side !== 1 && side !== 2)) {
    console.warn("setMatchWinner ignorado:", { mid, side, bracket: state.bracket });
    return;
  }

  // ✅ Inmutable: evitamos estados corruptos
  state.bracket = {
    ...state.bracket,
    results: {
      ...state.bracket.results,
      [mid]: side
    }
  };

  // ✅ Render en el próximo frame (evita glitches)
  requestAnimationFrame(() => {
    try {
      renderAll();
    } catch (err) {
      console.error("Render falló después de setMatchWinner:", err);
      alert("Hubo un error al actualizar el bracket. Revisa la consola.");
    }
  });
};

  // ==========================================
  // Render bracket
  // ==========================================
  function buildRoundColumn(round, title){
    const col=document.createElement("div");
    col.className="roundCol";
    col.innerHTML=`<div class="roundTitle">${title}</div>`;

    round.forEach(m=>{
      const card=document.createElement("div");
      card.className="matchCard"+((m.p1&&m.p2&&!state.bracket.results[m.mid])?" ready":"");

      const p1=m.p1?m.p1.name:"(bye)";
      const p2=m.p2?m.p2.name:"(bye)";
      const w=state.bracket?.results?.[m.mid];
      const s1=w===1?"win":"", s2=w===2?"win":"";

      card.innerHTML=`
        ${(m.p1&&m.p2&&!w)?`<div class="readyLabel">⚔️ Listo para pelear</div>`:""}
        <div class="slot ${m.p1?"":"muted"} ${s1} ${m.p1?"draggable":""}" data-mid="${m.mid}" data-side="1">
          <span class="name">${p1}</span>
          ${m.p1?`<button class="btn good" data-act="winMatch" data-mid="${m.mid}" data-win="1">Gana</button>`:""}
        </div>
        <div class="slot ${m.p2?"":"muted"} ${s2} ${m.p2?"draggable":""}" data-mid="${m.mid}" data-side="2">
          <span class="name">${p2}</span>
          ${m.p2?`<button class="btn good" data-act="winMatch" data-mid="${m.mid}" data-win="2">Gana</button>`:""}
        </div>
        <ul class="resultList">
          ${w ? `<li>✅ Ganó: <b>${w===1?p1:p2}</b></li>` : `<li>⏳ Pendiente</li>`}
        </ul>
      `;
      col.appendChild(card);
    });
    return col;
  }

  function drawLines(board){
    const cols=[...board.querySelectorAll(".roundCol")];
    if(cols.length<2) return;

    const svgNS="http://www.w3.org/2000/svg";
    const layer=document.createElement("div"); layer.className="lineLayer";
    layer.innerHTML=`<svg xmlns="${svgNS}"></svg>`;
    const svg=layer.querySelector("svg");
    const boardRect=board.getBoundingClientRect();

    for(let c=0;c<cols.length-1;c++){
      const leftCards=[...cols[c].querySelectorAll(".matchCard")];
      const rightCards=[...cols[c+1].querySelectorAll(".matchCard")];

      leftCards.forEach((lc,i)=>{
        const rc=rightCards[Math.floor(i/2)]; if(!rc) return;
        const a=lc.getBoundingClientRect(), b=rc.getBoundingClientRect();
        const x1=a.right-boardRect.left;
        const y1=(a.top+a.bottom)/2-boardRect.top;
        const x2=b.left-boardRect.left;
        const y2=(b.top+b.bottom)/2-boardRect.top;
        const midX=(x1+x2)/2;
        const path=document.createElementNS(svgNS,"path");
        path.setAttribute("d",`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
        svg.appendChild(path);
      });
    }
    board.appendChild(layer);
  }

  const renderDoubleElim=()=>{
    const wBoard=$("#bracketBoardW"), lBoard=$("#bracketBoardL"), gBoard=$("#bracketBoardG");
    wBoard.innerHTML=""; lBoard.innerHTML=""; gBoard.innerHTML="";

    if(!state.bracket){
      wBoard.innerHTML=`<div class="empty">Genera un torneo.</div>`;
      lBoard.innerHTML=`<div class="empty">Genera un torneo.</div>`;
      gBoard.innerHTML=`<div class="empty">Esperando finalistas.</div>`;
      return;
    }

    const orderedPlayers=state.seeds
      .map(id=>state.players.find(p=>p.id===id))
      .filter(Boolean)
      .slice(0,state.maxPlayers);

    // ====== SINGLE ELIM ======
    if(state.bracket.type==="single"){
      const built=buildSingleElim(orderedPlayers, state.bracket.results);
      built.R.forEach((round,ri)=>{
        wBoard.appendChild(buildRoundColumn(round,`Round ${ri+1}`));
      });
      lBoard.innerHTML=`<div class="empty">Single elim no usa losers.</div>`;
      if(built.finalMatch){
        gBoard.appendChild(buildRoundColumn([built.finalMatch], "Final"));
      }

      requestAnimationFrame(()=>{
        wBoard.querySelector(".lineLayer")?.remove();
        gBoard.querySelector(".lineLayer")?.remove();
        drawLines(wBoard); drawLines(gBoard);
      });
      return;
    }

    // ====== DOUBLE ELIM ======
    const built=buildDoubleElim(orderedPlayers, state.bracket.results);
    built.W.forEach((round,ri)=>wBoard.appendChild(buildRoundColumn(round,`Winners R${ri+1}`)));
    built.L.filter(Boolean).forEach((round,ri)=>lBoard.appendChild(buildRoundColumn(round,`Losers R${ri+1}`)));

    if(built.grandFinal){
      gBoard.appendChild(buildRoundColumn([built.grandFinal],"Grand Final"));
    }

    requestAnimationFrame(()=>{
      wBoard.querySelector(".lineLayer")?.remove();
      lBoard.querySelector(".lineLayer")?.remove();
      gBoard.querySelector(".lineLayer")?.remove();
      drawLines(wBoard); drawLines(lBoard); drawLines(gBoard);
    });
  };

  // Exportar bracket PNG
  const exportBracketPNG=async ()=>{
    const hint=$("#exportHint"); hint.textContent="Generando PNG...";
    try{
      const canvas=await html2canvas($("#bracketRoot"),{backgroundColor:null,scale:window.devicePixelRatio||2,useCORS:true});
      const png=canvas.toDataURL("image/png");
      const a=document.createElement("a");
      a.href=png; a.download=`${(state.tourneyName||"bracket").replace(/\s+/g,"_")}.png`; a.click();
      hint.textContent="PNG exportado ✅";
    }catch(e){ hint.textContent="No se pudo exportar."; }
  };

  // ==========================================
  // Drag & drop en bracket (ganador)
  // ==========================================
  let bracketDrag=null;
  const getMatchCard=(el)=>el?.closest?.(".matchCard")||null;

  document.body.addEventListener("pointerdown",(e)=>{
    const slot=e.target.closest(".slot.draggable"); if(!slot) return;
    bracketDrag={mid:slot.dataset.mid, side:parseInt(slot.dataset.side,10)};
    slot.setPointerCapture(e.pointerId); slot.classList.add("dragging");
  });
  document.body.addEventListener("pointermove",(e)=>{
    if(!bracketDrag) return;
    const over=document.elementFromPoint(e.clientX,e.clientY);
    const card=getMatchCard(over);
    document.querySelectorAll(".matchCard").forEach(c=>c.classList.remove("dragTarget"));
    if(card) card.classList.add("dragTarget");
  });
  document.body.addEventListener("pointerup",(e)=>{
    if(!bracketDrag) return;
    const over=document.elementFromPoint(e.clientX,e.clientY);
    const card=getMatchCard(over);
    document.querySelectorAll(".matchCard").forEach(c=>c.classList.remove("dragTarget"));
    document.querySelectorAll(".slot.dragging").forEach(s=>s.classList.remove("dragging"));
    if(card){
      const mid=card.querySelector(".slot")?.dataset?.mid;
      if(mid===bracketDrag.mid){ beep("win"); setMatchWinner(bracketDrag.mid, bracketDrag.side); }
    }
    bracketDrag=null;
  });
  document.body.addEventListener("pointercancel",()=>{bracketDrag=null;});

  // ==========================================
  // Reglas / skins
  // ==========================================
  const applyRules=()=>{
    state.rules.mode=$("#modeSelect").value;
    state.rules.firstToN=clamp(parseInt($("#firstToN").value,10)||3,1,20);
    state.rules.bestOfM=clamp(parseInt($("#bestOfM").value,10)||5,1,99);
    state.rules.pointsSpin=clamp(parseInt($("#pointsSpin").value,10)||1,0,10);
    state.rules.pointsOver=clamp(parseInt($("#pointsOver").value,10)||2,0,10);
    state.rules.pointsBurst=clamp(parseInt($("#pointsBurst").value,10)||3,0,10);
    state.rules.pointsRO=clamp(parseInt($("#pointsRO").value,10)||2,0,10);
    state.rules.pointsKO=clamp(parseInt($("#pointsKO").value,10)||2,0,10);
    state.rules.timerMode=$("#timerMode").value;
    state.rules.timerCountdown=clamp(parseInt($("#timerCountdown").value,10)||180,5,1800);
    state.rules.sounds=$("#soundSelect").value;
    state.rules.autoReset=$("#autoResetSelect").value;
    timerReset(); beep("click"); renderAll(); alert("Reglas aplicadas ✅");
  };

  const setRulesUI=()=>{
    $("#modeSelect").value=state.rules.mode;
    $("#firstToN").value=state.rules.firstToN;
    $("#bestOfM").value=state.rules.bestOfM;
    $("#pointsSpin").value=state.rules.pointsSpin;
    $("#pointsOver").value=state.rules.pointsOver;
    $("#pointsBurst").value=state.rules.pointsBurst;
    $("#pointsRO").value=state.rules.pointsRO;
    $("#pointsKO").value=state.rules.pointsKO;
    $("#timerMode").value=state.rules.timerMode;
    $("#timerCountdown").value=state.rules.timerCountdown;
    $("#soundSelect").value=state.rules.sounds;
    $("#autoResetSelect").value=state.rules.autoReset;
    $("#skinSelect").value=state.skin;
    $("#tourneyNameInput").value=state.tourneyName||"";
    $("#maxPlayersSelect").value=String(state.maxPlayers);
    $("#bracketTypeSelect").value=state.bracketType || "double";
    $("#zoomSlider").value=state.zoom;
  };

  const defaultRules=()=>{
    state.rules={mode:"firstTo",firstToN:3,bestOfM:5,pointsSpin:1,pointsOver:2,pointsBurst:3,pointsRO:2,pointsKO:2,sounds:"on",autoReset:"off",timerMode:"up",timerCountdown:180};
    timerReset(); setRulesUI(); renderAll();
  };

  const applySkin=()=>{ state.skin=$("#skinSelect").value; renderAll(); };

  // Render todo
  const renderAll=()=>{
    renderRound(); renderPlayers(); renderHistory(); renderSeeds();
    renderDoubleElim(); renderStats(); renderTimer(); save();
  };

  // ==========================================
  // Eventos UI
  // ==========================================
  $("#addPlayerBtn").addEventListener("click",()=>{
    const name=$("#nameInput").value.trim();
    const start=parseInt($("#startInput").value||"0",10);
    const color=$("#colorInput").value;
    addPlayer(name,start,color);
    $("#nameInput").value=""; $("#nameInput").focus();
    beep("click");
  });
  $("#nameInput").addEventListener("keydown",(e)=>{if(e.key==="Enter")$("#addPlayerBtn").click();});

  $("#playersWrap").addEventListener("click",(e)=>{
    const el=e.target.closest("[data-act]"); if(!el) return;
    const id=el.dataset.id, act=el.dataset.act; beep("click");
    if(act==="minus5") changeScore(id,-5,"Penalización -5");
    if(act==="minus1") changeScore(id,-1,"Penalización -1");
    if(act==="plus1") changeScore(id, +1,"Punto +1");
    if(act==="plus5") changeScore(id, +5,"Punto +5");
    if(act==="spin") award(id,"spin");
    if(act==="over") award(id,"over");
    if(act==="burst") award(id,"burst");
    if(act==="ro") award(id,"ro");
    if(act==="ko") award(id,"ko");
    if(act==="quickSpin") award(id,"quickSpin");
    if(act==="rename") renamePlayer(id);
    if(act==="remove") removePlayer(id);
  });

  $("#seedWrap").addEventListener("click",(e)=>{
    const btn=e.target.closest("button[data-act]"); if(!btn) return;
    const idx=parseInt(btn.dataset.idx,10);
    if(btn.dataset.act==="seedUp") moveSeed(idx,idx-1);
    if(btn.dataset.act==="seedDown") moveSeed(idx,idx+1);
    beep("click"); refreshBracketRealtime(); renderAll();
  });
  $("#randomSeedsBtn").addEventListener("click",()=>{beep("click"); randomizeSeeds(); refreshBracketRealtime(); renderAll();});
  $("#resetSeedsBtn").addEventListener("click",()=>{beep("click"); resetSeeds(); refreshBracketRealtime(); renderAll();});

  $("#newRoundBtn").addEventListener("click",()=>{beep("click"); newRound();});
  $("#undoBtn").addEventListener("click",()=>{beep("click"); undoLast();});
  $("#resetBtn").addEventListener("click",()=>{beep("click"); resetAll(true);});

  $("#toggleTheme").addEventListener("click",()=>{state.theme=state.theme==="dark"?"light":"dark"; beep("click"); renderAll();});
  $("#exportBtn").addEventListener("click",exportJSON);
  $("#importBtn").addEventListener("click",importJSON);

  $("#shareBtn").addEventListener("click",()=>{makeShareCode(); setTab("settings");});
  $("#makeCodeBtn").addEventListener("click",makeShareCode);
  $("#loadCodeBtn").addEventListener("click",loadShareCode);

  $("#applyRulesBtn").addEventListener("click",applyRules);
  $("#defaultRulesBtn").addEventListener("click",defaultRules);
  $("#applySkinBtn").addEventListener("click",applySkin);

  $("#timerStart").addEventListener("click",()=>{beep("click"); timerStart();});
  $("#timerPause").addEventListener("click",()=>{beep("click"); timerPause();});
  $("#timerReset").addEventListener("click",()=>{beep("click"); timerReset();});

  $("#genDoubleBtn").addEventListener("click",()=>{beep("click"); genBracket(); setTab("tourney");});
  $("#resetDoubleBtn").addEventListener("click",()=>{beep("click"); state.bracket=null; renderAll();});
  $("#exportBracketBtn").addEventListener("click",()=>{beep("click"); exportBracketPNG();});

  // Click en botones "Gana"
  // Click en "Gana" (blindado)
document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act='winMatch']");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const mid = btn.dataset.mid;
  const side = parseInt(btn.dataset.win, 10);

  if (!mid || Number.isNaN(side)) {
    console.warn("Click Gana inválido:", btn);
    return;
  }

  beep("win");
  setMatchWinner(mid, side);
});

  // Inputs de torneo
  $("#tourneyNameInput").addEventListener("input",(e)=>{state.tourneyName=e.target.value.trim()||"Torneo Beyblade"; refreshBracketRealtime(); renderAll();});
  $("#maxPlayersSelect").addEventListener("change",(e)=>{state.maxPlayers=parseInt(e.target.value,10); refreshBracketRealtime(); renderAll();});

  // Zoom
  $("#zoomSlider").addEventListener("input",(e)=>{state.zoom=parseInt(e.target.value,10); applyZoom(); save();});
  $("#zoomInBtn").addEventListener("click",()=>{state.zoom=clamp(state.zoom+10,60,140); applyZoom(); save();});
  $("#zoomOutBtn").addEventListener("click",()=>{state.zoom=clamp(state.zoom-10,60,140); applyZoom(); save();});

  // Init
  load(); ensureSeeds(); setRulesUI(); renderAll();
  if(!state.players.length){
    addPlayer("Jugador 1",0,"#7aa2ff");
    addPlayer("Jugador 2",0,"#57e389");
  }
})();
