'use strict';
const $ = id => document.getElementById(id), audio = $('audio');
const key = 'duke-reader-v2', speeds = [.8,1,1.25,1.5,1.75,2,2.5,3];
let library, chapterIndex = 0, index = 0, voice = 'onyx', pending = 0;
let loadId = 0, lastSave = 0, switching = false, restored = false;
const time = s => { s=Math.max(0,Math.floor(Number(s)||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
const chapter = () => library.chapters[chapterIndex];
const parts = () => chapter().parts;
const recording = () => parts()[index].audio[voice];
const position = () => pending || (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
function save() {
  if (!library || switching) return;
  try { localStorage.setItem(key,JSON.stringify({chapter:chapterIndex,index,voice,edition:'onyx-b-medium-v1',time:position(),speed:Number($('speed').value)})); } catch {}
}
function status(message) { $('status').textContent=message; }
function playState(playing) { $('play').textContent=playing?'Ⅱ':'▶'; $('play').setAttribute('aria-label',playing?'一時停止':'再生'); }
function sync() {
  if (!library) return;
  const d=Number.isFinite(audio.duration)?audio.duration:recording()?.duration||0, s=position();
  $('elapsed').textContent=time(s); $('duration').textContent=time(d); $('seek').value=d?Math.min(100,s/d*100):0;
  $('seek').setAttribute('aria-valuetext',time(s)+' / '+time(d));
  if(Date.now()-lastSave>2000){save();lastSave=Date.now();}
}
function renderParts() {
  $('parts').replaceChildren();
  parts().forEach((part,i)=>{
    const b=document.createElement('button'),n=document.createElement('span'),t=document.createElement('span'),d=document.createElement('small');
    n.className='num'; n.textContent=String(i+1).padStart(2,'0'); t.textContent=part.title;
    d.textContent=part.audio[voice]?time(part.audio[voice].duration):'本文';
    b.append(n,t,d); b.onclick=()=>selectPart(i,true); $('parts').append(b);
  });
  const available=parts().filter(p=>p.audio[voice]);
  $('total').textContent=available.length===parts().length?time(available.reduce((n,p)=>n+p.audio[voice].duration,0)):available.length?`音声 ${available.length} / ${parts().length}区切り`:'音声は未生成';
}
function renderChapter() {
  $('chapter').value=String(chapterIndex); $('chapterNumber').textContent=(chapter().collection==='supplement'?'補足講座 '+chapter().supplement_chapter+' · ':'')+'CHAPTER '+String(chapter().id).padStart(2,'0');
  $('chapterTitle').textContent=chapter().title; $('source').href=chapter().source;
  const complete=library.chapters.filter(c=>c.parts.every(p=>p.audio[voice])).length;
  $('voiceDescription').textContent=library.voices.find(v=>v.id===voice).description+' · '+complete+'章を収録';
  document.querySelectorAll('input[name="voice"]').forEach(input=>{input.checked=input.value===voice;input.disabled=!parts()[index].audio[input.value];});
  renderParts();
}
function renderSources() {
  const sources=parts()[index].sources||[],list=$('sourceList');list.replaceChildren();
  $('partSources').hidden=sources.length===0;
  for(const source of sources){
    let url;try{url=new URL(source.url);}catch{continue;}
    if(url.protocol!=='https:'||url.hostname!=='investorduke.com')continue;
    const item=document.createElement('li'),link=document.createElement('a'),range=document.createElement('span');
    link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.book_id+' · '+source.title;
    range.textContent=source.start+'〜'+source.end;item.append(link,range);list.append(item);
  }
}
function renderPosition() {
  document.querySelectorAll('input[name="voice"]').forEach(input=>{input.disabled=!parts()[index].audio[input.value];});
  $('sectionTitle').textContent=parts()[index].title; $('transcript').textContent=parts()[index].text; renderSources();
  $('partCount').textContent=`${index+1} / ${parts().length}`;
  $('previousPart').disabled=index===0; $('nextPart').disabled=index===parts().length-1;
  [...$('parts').children].forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
  const file=chapter().downloads[voice]||recording()?.file;
  $('download').hidden=!file;
  if(file){$('download').href=file;$('download').textContent=chapter().downloads[voice]?'この章の音声を保存 ↓':'この区切りの音声を保存 ↓';}else $('download').removeAttribute('href');
  if('mediaSession'in navigator&&typeof MediaMetadata!=='undefined')navigator.mediaSession.metadata=new MediaMetadata({title:`第${chapter().id}章 ${chapter().title} · ${parts()[index].title}`,artist:'DUKE 聴く読書室 · '+voice+'（AI朗読）'});
}
function loadPart(seconds=0) {
  switching=true; loadId++; audio.pause(); pending=Number.isFinite(seconds)?Math.max(0,seconds):0;
  audio.removeAttribute('src'); audio.load(); playState(false);
  const item=recording(); ['play','back','forward','seek'].forEach(id=>{$(id).disabled=!item;});
  if(item){audio.src=item.file;audio.playbackRate=Number($('speed').value);audio.preservesPitch=true;status('音声を読み込んでいます…');}
  else{pending=0;status('この区切りの音声は準備中です。本文は読めます。');}
  renderPosition(); switching=false; sync(); save();
}
async function play() {
  if(!recording())return; const expected=loadId;
  try{await audio.play();}catch(error){if(expected===loadId&&error.name!=='AbortError')status('再生できませんでした。再生ボタンをもう一度押してください。');}
}
function selectPart(i,autoplay=false){if(!Number.isInteger(i)||i<0||i>=parts().length)return;index=i;restored=false;loadPart();if(autoplay)void play();}
function changeVoice(next) {
  if(!library.voices.some(v=>v.id===next)||!parts()[index].audio[next])return;
  const wasPlaying=!audio.paused,d=Number.isFinite(audio.duration)?audio.duration:recording()?.duration||0,ratio=d?Math.min(1,position()/d):0;
  voice=next;const nextTime=ratio*(recording()?.duration||0);renderChapter();loadPart(nextTime);if(wasPlaying)void play();
}
function skip(s){if(!recording()||!Number.isFinite(audio.duration))return;pending=0;audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+s));sync();save();}
audio.addEventListener('loadedmetadata',()=>{
  if(!library||!recording())return;
  if(Number.isFinite(audio.duration))audio.currentTime=Math.min(pending,Math.max(0,audio.duration-.05));pending=0;
  audio.playbackRate=Number($('speed').value);sync();if(audio.paused)status(restored?'前回の続きから聴けます':'再生ボタンで聴き始める');
});
audio.addEventListener('play',()=>{playState(true);status('再生中');});
audio.addEventListener('pause',()=>{if(switching||!library)return;playState(false);if(recording()&&!audio.ended)status('一時停止');save();});
audio.addEventListener('timeupdate',sync);
audio.addEventListener('error',()=>{if(!switching&&library&&recording()){playState(false);status('音声を読み込めません。通信状態を確認して再生し直してください。');}});
audio.addEventListener('ended',()=>{
  if(index+1<parts().length)selectPart(index+1,true);
  else if(chapterIndex+1<library.chapters.length&&library.chapters[chapterIndex+1].parts[0].audio[voice]){chapterIndex++;index=0;renderChapter();loadPart();void play();}
  else{playState(false);status(`第${chapter().id}章を聴き終えました`);save();}
});
$('play').onclick=()=>audio.paused?void play():audio.pause();$('back').onclick=()=>skip(-15);$('forward').onclick=()=>skip(15);
$('speed').onchange=()=>{audio.playbackRate=Number($('speed').value);save();};
$('seek').oninput=()=>{if(library&&recording()&&Number.isFinite(audio.duration)){pending=0;audio.currentTime=Number($('seek').value)*audio.duration/100;sync();save();}};
$('chapter').onchange=()=>{const next=Number($('chapter').value);if(!Number.isInteger(next)||!library.chapters[next])return;const playing=!audio.paused;chapterIndex=next;index=0;restored=false;renderChapter();loadPart();if(playing)void play();};
$('supplementJump').onclick=()=>{if(!library||library.chapters.length<38)return;$('chapter').value='26';$('chapter').onchange();};
$('previousPart').onclick=()=>selectPart(index-1,!audio.paused);$('nextPart').onclick=()=>selectPart(index+1,!audio.paused);
window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
(async()=>{try{
  const response=await fetch('library.json',{cache:'no-cache'});if(!response.ok)throw Error('Library unavailable');library=await response.json();if(![26,38].includes(library.chapters.length)||library.chapters.some((c,i)=>c.id!==i+1||!c.parts.length))throw Error('Incomplete library');
  $('chapter').replaceChildren();
  for(const [label, filter] of [['本編 第1〜26章',c=>c.id<=26],['補足講座 第27〜38章',c=>c.id>=27]]){
    const group=document.createElement('optgroup');group.label=label;
    library.chapters.forEach((c,i)=>{if(!filter(c))return;const option=document.createElement('option');option.value=String(i);option.textContent=`第${c.id}章 ${c.title}${c.parts.every(p=>p.audio.onyx)?'':' · 音声準備中'}`;group.append(option);});
    if(group.children.length)$('chapter').append(group);
  }
  $('chapter').disabled=false;
  $('supplementJump').hidden=library.chapters.length<38;
  $('collectionBadge').textContent=library.chapters.length===38?'本編26章＋補足12章':'本編26章';
  library.voices.forEach(v=>{const label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');input.type='radio';input.name='voice';input.value=v.id;input.onchange=()=>{if(input.checked)changeVoice(v.id);};const complete=library.chapters.filter(c=>c.parts.every(p=>p.audio[v.id]));const coverage=complete.length===library.chapters.length?`全${library.chapters.length}章`:complete.every((c,i)=>c.id===i+1)&&complete.length?(complete.length===1?'第1章':`第1〜${complete.length}章`):`${complete.length}章収録`;name.textContent=`${v.name}（${coverage}）`;label.append(input,name);$('voices').append(label);});
  let state;try{state=JSON.parse(localStorage.getItem(key));if(!state){const legacy=JSON.parse(localStorage.getItem('duke-ch1-v1'));if(legacy)state={...legacy,chapter:0,voice:'coral'};}}catch{}
  voice=library.voices[0].id;
  if(state){if(Number.isInteger(state.chapter)&&library.chapters[state.chapter])chapterIndex=state.chapter;if(Number.isInteger(state.index)&&parts()[state.index])index=state.index;if(library.voices.some(v=>v.id===state.voice))voice=state.voice;if(speeds.includes(state.speed))$('speed').value=String(state.speed);restored=true;}
  renderChapter();loadPart(restored&&state.edition==='onyx-b-medium-v1'&&Number.isFinite(state.time)?state.time:0);
  if('mediaSession'in navigator)for(const[name,fn]of Object.entries({play,pause:()=>audio.pause(),seekbackward:()=>skip(-15),seekforward:()=>skip(15),previoustrack:()=>selectPart(Math.max(0,index-1),true),nexttrack:()=>selectPart(Math.min(parts().length-1,index+1),true)})){try{navigator.mediaSession.setActionHandler(name,fn);}catch{}}
}catch{status('本文を読み込めません。ページを開き直してください。');}})();
