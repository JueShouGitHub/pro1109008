export const RotateMaze = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Rotate Maze</title>
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0f1a24;touch-action:none;
-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
canvas{display:block;touch-action:none}
#fsBtn{position:fixed;top:6px;right:6px;z-index:99;width:42px;height:30px;
background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.65);border:1px solid rgba(255,255,255,0.22);
border-radius:8px;font-size:15px;line-height:1;padding:0;touch-action:none;-webkit-tap-highlight-color:transparent}
</style>
</head>
<body>
<canvas id="cv"></canvas>
<button id="fsBtn" aria-label="Fullscreen">&#9974;</button>
<script>
(function(){
  var b=document.getElementById('fsBtn'),last=0;
  function toggle(){
    var now=Date.now();
    if(now-last<500)return;
    last=now;
    try{
      if(!document.fullscreenElement&&!document.webkitFullscreenElement){
        var el=document.documentElement;
        var fn=el.requestFullscreen||el.webkitRequestFullscreen;
        if(fn){var p=fn.call(el);if(p&&p.catch)p.catch(function(){});}
      }else{
        var ex=document.exitFullscreen||document.webkitExitFullscreen;
        if(ex)ex.call(document);
      }
      setTimeout(function(){window.dispatchEvent(new Event('resize'));},120);
    }catch(e){}
  }
  b.addEventListener('pointerdown',function(e){e.stopPropagation();toggle();});
  b.addEventListener('touchstart',function(e){e.stopPropagation();},{passive:false});
  b.addEventListener('click',function(e){e.stopPropagation();});
  document.addEventListener('fullscreenchange',function(){setTimeout(function(){window.dispatchEvent(new Event('resize'));},150);});
  window.__lw=document.documentElement.clientWidth||window.innerWidth;
  window.__lh=document.documentElement.clientHeight||window.innerHeight;
  setInterval(function(){
    var cw=document.documentElement.clientWidth,ch=document.documentElement.clientHeight;
    var cv=document.querySelector('canvas');
    var stale=cv&&(cv.clientWidth!==cw||cv.clientHeight!==ch);
    if(stale||(cw&&cw!==window.__lw)||(ch&&ch!==window.__lh)){
      window.__lw=cw||window.innerWidth;window.__lh=ch||window.innerHeight;
      try{window.dispatchEvent(new Event('resize'));}catch(e){}
    }
  },250);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){window.dispatchEvent(new Event('resize'));});
})();
</script>

<script>
(function(){
'use strict';
/* ===================== Rotate Maze =====================
   The ball rolls toward the amber gravity arrow. Rotate gravity
   clockwise or counter-clockwise to steer it to the green exit.
   Every maze is verified solvable by breadth-first search over the
   full state space before it is shown, and RESET rebuilds the level. */

var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
var W=390,H=844,DPR=1;
var PHASE_START='start',PHASE_PLAY='play';
var phase=PHASE_START,winT=0,clock=0;
var level=1,score=0,best=0,turns=0;
var COLS=7,ROWS=9;
var grid=[],ball0={r:0,c:0},exitPos={r:0,c:0};
var ball={r:0,c:0},gravDir=1; /* 0 right 1 down 2 left 3 up */
var rolling=0,rollFrom=null;
var msg='',msgT=0,lastGain=0;
var lastInput=0;
var DR=[0,1,0,-1],DC=[1,0,-1,0];

/* ---- layout ---- */
var ox=0,oy=0,cell=44;
var btnCw=null,btnCcw=null,btnResetL=null;
function layout(){
  cell=Math.floor(Math.min((W-24)/COLS,(H*0.58)/ROWS));
  if(cell<32)cell=32;
  ox=Math.round((W-COLS*cell)/2);
  oy=Math.round(H*0.155);
}
function layoutBtns(){
  var bw=Math.min(110,Math.round(W*0.27));
  var by=Math.min(oy+ROWS*cell+20,Math.round(H*0.78));
  btnCcw={x:Math.round(W/2)-bw-8,y:by,w:bw,h:50};
  btnCw={x:Math.round(W/2)+8,y:by,w:bw,h:50};
  btnResetL={x:Math.round(W/2)-70,y:by+60,w:140,h:40};
}

/* ---- sound / haptics ---- */
var AC=null;
function playSound(type){
  try{
    if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
    var o=AC.createOscillator(),g=AC.createGain();
    o.connect(g);g.connect(AC.destination);
    var t=AC.currentTime;
    if(type==='rot'){o.frequency.setValueAtTime(340,t);o.frequency.exponentialRampToValueAtTime(520,t+0.09);g.gain.setValueAtTime(0.06,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.12);o.start(t);o.stop(t+0.13);}
    else if(type==='hit'){o.frequency.setValueAtTime(200,t);g.gain.setValueAtTime(0.04,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);o.start(t);o.stop(t+0.07);}
    else if(type==='none'){o.type='square';o.frequency.setValueAtTime(140,t);g.gain.setValueAtTime(0.05,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.12);o.start(t);o.stop(t+0.13);}
    else if(type==='fan'){o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(659,t+0.09);o.frequency.setValueAtTime(784,t+0.18);o.frequency.setValueAtTime(1047,t+0.27);g.gain.setValueAtTime(0.09,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.5);o.start(t);o.stop(t+0.5);}
  }catch(e){}
}
function vibrate(ms){try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}}

/* ---- core mechanics ---- */
function roll(rr2,cc,dir){
  var r=rr2,c=cc;
  for(var guard=0;guard<ROWS*COLS+4;guard++){
    var nr=r+DR[dir],nc=c+DC[dir];
    if(nr<0||nr>=ROWS||nc<0||nc>=COLS)break;
    if(grid[nr][nc])break;
    r=nr;c=nc;
  }
  return {r:r,c:c};
}
function bfsSolve(startR,startC,startD){
  var seen={},queue=[],head=0;
  var key=function(r,c,d){return (r*COLS+c)*4+d;};
  queue.push({r:startR,c:startC,d:startD,path:[]});
  seen[key(startR,startC,startD)]=1;
  while(head<queue.length){
    var s=queue[head++];
    if(s.r===exitPos.r&&s.c===exitPos.c)return s.path;
    for(var dd=-1;dd<=1;dd+=2){
      var nd=(s.d+dd+4)%4;
      var np=roll(s.r,s.c,nd);
      var k2=key(np.r,np.c,nd);
      if(seen[k2])continue;
      seen[k2]=1;
      var p2=s.path.slice();p2.push(dd);
      queue.push({r:np.r,c:np.c,d:nd,path:p2});
    }
  }
  return null;
}

/* ---- level generation (BFS-verified) ---- */
function ri(n){return Math.floor(Math.random()*n);}
function genLevel(){
  var tries=0,done=false;
  while(!done&&tries++<200){
    grid=[];
    var dens=Math.min(0.30,0.16+level*0.012);
    for(var r=0;r<ROWS;r++){
      var row=[];
      for(var c=0;c<COLS;c++)row.push(Math.random()<dens?1:0);
      grid.push(row);
    }
    var open=[];
    for(var r2=0;r2<ROWS;r2++)for(var c2=0;c2<COLS;c2++)if(!grid[r2][c2])open.push({r:r2,c:c2});
    if(open.length<ROWS*COLS*0.5)continue;
    /* ball near the top, exit near the bottom */
    var topCells=open.filter(function(p){return p.r<=2;});
    var botCells=open.filter(function(p){return p.r>=ROWS-3;});
    if(!topCells.length||!botCells.length)continue;
    ball0=topCells[ri(topCells.length)];
    exitPos=botCells[ri(botCells.length)];
    ball={r:ball0.r,c:ball0.c};
    gravDir=1;turns=0;rolling=0;rollFrom=null;
    if(bfsSolve(ball0.r,ball0.c,1))done=true;
  }
  if(!done){ /* fallback: open corridor, exit in the bottom-left corner */
    grid=[];
    for(var r3=0;r3<ROWS;r3++){var row3=[];for(var c3=0;c3<COLS;c3++)row3.push(0);grid.push(row3);}
    ball0={r:0,c:3};exitPos={r:ROWS-1,c:0};
    ball={r:0,c:3};gravDir=1;turns=0;rolling=0;rollFrom=null;
  }
}
function resetLevel(){
  ball={r:ball0.r,c:ball0.c};
  gravDir=1;turns=0;rolling=0;rollFrom=null;winT=0;
  msg='RESET';msgT=0.9;
}
function newGame(){level=1;score=0;genLevel();msg='LEVEL 1';msgT=1.2;}

function rotate(dir){ /* dir +1 clockwise, -1 counter-clockwise */
  if(phase!==PHASE_PLAY||winT>0||rolling>0)return null;
  gravDir=(gravDir+dir+4)%4;
  turns++;
  rollFrom={r:ball.r,c:ball.c};
  var np=roll(ball.r,ball.c,gravDir);
  ball=np;
  rolling=0.22;
  playSound('rot');vibrate(8);
  if(ball.r===exitPos.r&&ball.c===exitPos.c){
    var gain=60+level*10;
    lastGain=gain;
    score+=gain;
    if(score>best){best=score;try{localStorage.setItem('rotmaze_best',String(best));}catch(e){}}
    msg='ESCAPED!  +'+gain;msgT=1.5;
    winT=1.2;
    playSound('fan');vibrate(40);
    return 'win';
  }
  if(np.r===rollFrom.r&&np.c===rollFrom.c)playSound('hit');
  return 'rolled';
}

/* ---- input ---- */
function hitRect(rc,x,y){return rc&&x>=rc.x&&x<=rc.x+rc.w&&y>=rc.y&&y<=rc.y+rc.h;}
function inputDown(x,y){
  if(phase===PHASE_START){phase=PHASE_PLAY;newGame();return;}
  if(winT>0){winT=Math.min(winT,0.06);return;}
  if(hitRect(btnCw,x,y)){rotate(1);return;}
  if(hitRect(btnCcw,x,y)){rotate(-1);return;}
  if(hitRect(btnResetL,x,y)){resetLevel();playSound('none');return;}
}
function handleInput(x,y){
  var now=Date.now();
  if(now-lastInput<40)return;
  lastInput=now;
  inputDown(x,y);
}

/* ---- drawing ---- */
function rr(x,y,w,h,rad){
  ctx.beginPath();
  ctx.moveTo(x+rad,y);
  ctx.arcTo(x+w,y,x+w,y+h,rad);
  ctx.arcTo(x+w,y+h,x,y+h,rad);
  ctx.arcTo(x,y+h,x,y,rad);
  ctx.arcTo(x,y,x+w,y,rad);
  ctx.closePath();
}
function update(dt){
  if(msgT>0)msgT-=dt;
  if(phase!==PHASE_PLAY)return;
  if(winT>0){
    winT-=dt;
    if(winT<=0){winT=0;level++;genLevel();msg='LEVEL '+level;msgT=1.2;}
    return;
  }
  if(rolling>0)rolling-=dt;
}
function draw(){
  ctx.clearRect(0,0,W,H);
  var g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#13222e');g.addColorStop(1,'#0f1a24');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  if(phase===PHASE_START){drawStart();return;}
  drawHeader();
  drawBoard();
  drawButtons();
  if(winT>0)drawBanner();
}
function drawHeader(){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#e6edf3';ctx.font='bold 26px system-ui,sans-serif';
  ctx.fillText('LEVEL '+level,W/2,50);
  ctx.font='14px system-ui,sans-serif';ctx.fillStyle='#8b949e';
  ctx.textAlign='left';ctx.fillText('SCORE '+score,16,84);
  ctx.textAlign='right';ctx.fillText('BEST '+best,W-52,84);
  ctx.textAlign='center';ctx.fillStyle='#ffc078';ctx.font='bold 16px system-ui,sans-serif';
  ctx.fillText('TURNS '+turns,W/2,84);
  if(msgT>0&&msg){
    ctx.globalAlpha=Math.min(1,msgT*2);
    ctx.fillStyle='#ffd43b';ctx.font='bold 19px system-ui,sans-serif';
    ctx.fillText(msg,W/2,120);
    ctx.globalAlpha=1;
  }
}
function drawBoard(){
  ctx.fillStyle='rgba(10,18,26,0.8)';
  rr(ox-6,oy-6,COLS*cell+12,ROWS*cell+12,12);ctx.fill();
  for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++){
    var x=ox+c*cell,y=oy+r*cell;
    if(grid[r][c]){
      ctx.fillStyle='#2e4157';
      rr(x+2,y+2,cell-4,cell-4,6);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.06)';
      ctx.fillRect(x+2,y+2,cell-4,3);
    }
  }
  /* exit glow */
  var ex2=ox+exitPos.c*cell,ey2=oy+exitPos.r*cell;
  ctx.save();
  ctx.shadowColor='#69db7c';ctx.shadowBlur=12+4*Math.sin(clock*4);
  ctx.fillStyle='rgba(105,219,124,0.35)';
  rr(ex2+3,ey2+3,cell-6,cell-6,6);ctx.fill();
  ctx.restore();
  ctx.strokeStyle='#69db7c';ctx.lineWidth=2;
  rr(ex2+3,ey2+3,cell-6,cell-6,6);ctx.stroke();
  ctx.fillStyle='#69db7c';ctx.font='bold '+Math.floor(cell*0.5)+'px system-ui,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('⌂',ex2+cell/2,ey2+cell/2);
  /* gravity arrow in the board center */
  var cxc=ox+COLS*cell/2,cyc=oy+ROWS*cell/2;
  var ang=[0,Math.PI/2,Math.PI,-Math.PI/2][gravDir];
  ctx.save();
  ctx.globalAlpha=0.22;
  ctx.translate(cxc,cyc);
  ctx.rotate(ang);
  ctx.fillStyle='#ffc078';
  ctx.beginPath();
  ctx.moveTo(cell*0.9,0);ctx.lineTo(-cell*0.3,-cell*0.5);ctx.lineTo(-cell*0.3,cell*0.5);
  ctx.closePath();ctx.fill();
  ctx.restore();
  /* ball (animated from rollFrom) */
  var t=rolling>0?1-rolling/0.22:1;
  var br=rollFrom?rollFrom.r:ball.r,bc=rollFrom?rollFrom.c:ball.c;
  var px=ox+(bc+(ball.c-bc)*t)*cell+cell/2;
  var py=oy+(br+(ball.r-br)*t)*cell+cell/2;
  var sq=rolling>0?1+0.12*Math.sin(t*Math.PI):1;
  ctx.save();
  ctx.shadowColor='#ffa94d';ctx.shadowBlur=10;
  ctx.fillStyle='#ffa94d';
  ctx.beginPath();ctx.arc(px,py,cell*0.3*sq,0,6.2832);ctx.fill();
  ctx.restore();
  ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.beginPath();ctx.arc(px-cell*0.09,py-cell*0.09,cell*0.09,0,6.2832);ctx.fill();
}
function drawButtons(){
  var btns=[{r:btnCcw,t:'↺ CCW',d:-1},{r:btnCw,t:'CW ↻',d:1}];
  for(var i=0;i<2;i++){
    var b=btns[i];
    ctx.fillStyle='#1b2a38';
    rr(b.r.x,b.r.y,b.r.w,b.r.h,10);ctx.fill();
    ctx.strokeStyle='#2f4258';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='#ffc078';ctx.font='bold 18px system-ui,sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(b.t,b.r.x+b.r.w/2,b.r.y+b.r.h/2+1);
  }
  ctx.fillStyle='#16202c';
  rr(btnResetL.x,btnResetL.y,btnResetL.w,btnResetL.h,9);ctx.fill();
  ctx.fillStyle='#8b949e';ctx.font='bold 14px system-ui,sans-serif';
  ctx.fillText('RESET LEVEL',btnResetL.x+btnResetL.w/2,btnResetL.y+btnResetL.h/2+1);
}
function drawBanner(){
  ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(0,0,W,H);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#69db7c';ctx.font='bold 38px system-ui,sans-serif';
  ctx.fillText('ESCAPED!',W/2,H*0.4);
  ctx.fillStyle='#e6edf3';ctx.font='bold 20px system-ui,sans-serif';
  ctx.fillText('+'+lastGain+'   '+turns+' turns',W/2,H*0.4+48);
}
function drawStart(){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#ffc078';ctx.font='bold 44px system-ui,sans-serif';
  ctx.fillText('ROTATE MAZE',W/2,H*0.26);
  ctx.fillStyle='#8b949e';ctx.font='16px system-ui,sans-serif';
  ctx.fillText('The ball rolls toward the amber arrow',W/2,H*0.26+56);
  ctx.fillText('Rotate gravity to steer it home',W/2,H*0.26+84);
  ctx.fillText('Every maze is verified solvable',W/2,H*0.26+112);
  ctx.globalAlpha=0.5+0.5*Math.sin(clock*3);
  ctx.fillStyle='#e6edf3';ctx.font='bold 22px system-ui,sans-serif';
  ctx.fillText('TAP TO START',W/2,H*0.58);
  ctx.globalAlpha=1;
}

/* ---- main loop ---- */
var last=0;
function frame(ts){
  var dt=(ts-last)/1000;
  if(!(dt>0)||dt>0.05)dt=0.016;
  last=ts;
  clock+=dt;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

/* ---- boot ---- */
function resize(){
  W=window.innerWidth;H=window.innerHeight;
  DPR=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
  cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  layout();layoutBtns();
}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',function(){setTimeout(resize,120);});
window.addEventListener('touchstart',function(e){
  if(e.cancelable)e.preventDefault();
  var t=e.changedTouches[0];
  handleInput(t.clientX,t.clientY);
},{passive:false});
window.addEventListener('mousedown',function(e){handleInput(e.clientX,e.clientY);});

try{best=parseInt(localStorage.getItem('rotmaze_best')||'0',10)||0;}catch(e){best=0;}
resize();
genLevel();
phase=PHASE_START;
requestAnimationFrame(frame);

/* ================= test api ================= */
var api={
  state:function(){
    return {phase:phase,level:level,score:score,best:best,
      ball:ball,ball0:ball0,exit:exitPos,gravDir:gravDir,
      turns:turns,rolling:rolling,winT:winT,msg:msg};
  },
  rotate:function(d){return rotate(d);},
  solve:function(){return bfsSolve(ball.r,ball.c,gravDir);},
  resetLevel:function(){resetLevel();return 'ok';},
  roll:function(r,c,d){return roll(r,c,d);},
  geo:function(){return {ox:ox,oy:oy,cell:cell,COLS:COLS,ROWS:ROWS,btnCw:btnCw,btnCcw:btnCcw,btnResetL:btnResetL};},
  newGame:function(){newGame();},
  tick:function(dt){var s;while(dt>0){s=Math.min(0.05,dt);update(s);dt-=s;}}
};
if(typeof window!=='undefined')window.__rotm=api;
})();
</script>
</body>
</html>
`;