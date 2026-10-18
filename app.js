const API=window.API_BASE||localStorage.getItem('qisas_api_base')||'';
const DEFAULT_CATEGORIES=[{id:'fantasy',title:'قصص فانتازيا',emoji:'✨'},{id:'forced-marriage',title:'الزواج الإجباري',emoji:'💍'},{id:'history',title:'قصص تاريخية',emoji:'🏰'},{id:'children',title:'قصص أطفال',emoji:'🧸'},{id:'romance',title:'قصص رومانسية',emoji:'🌹'},{id:'horror',title:'قصص رعب',emoji:'🌙'},{id:'alf-layla',title:'ألف ليلة وليلة',emoji:'🪔'}];
const $=id=>document.getElementById(id);
let catalog={categories:[],stories:[]};
let selected=null,currentStory=null;

function esc(v=''){
 return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

function mediaUrl(path){
 if(!path)return '';
 if(/^https?:\/\//i.test(path))return path;
 return API.replace(/\/$/,'')+'/media/'+path.replace(/^\/+/, '')
}

async function request(path){
 if(!API)return {categories:DEFAULT_CATEGORIES.map(x=>({...x,image_path:''})),stories:[]};
 const r=await fetch(API.replace(/\/$/,'')+path);
 if(!r.ok)throw Error('تعذر تحميل البيانات');
 return r.json()
}

async function load(){
 try{
  catalog=await request('/api/catalog');
  catalog.categories=Array.isArray(catalog.categories)?catalog.categories:[];
  catalog.stories=Array.isArray(catalog.stories)?catalog.stories:[];
  renderCategories();
 }catch(e){
  $('categories').innerHTML='<div class="empty">تعذر الاتصال بالخادم. تأكدي من إعداد رابط Cloudflare Worker.</div>'
 }
}

function routePath(page,id){
 const routes={home:'/',category:'/category/',story:'/story/',listen:'/listen/'};
 return routes[page]+(page==='home'?'':encodeURIComponent(String(id)));
}

function navigateRoute(page,id){
 const target=routePath(page,id);
 if(location.pathname+location.search!==target){
  location.href=target
 }else{
  restoreRoute()
 }
}

function showPage(page){
 $('homeSections').hidden=page!=='home';
 $('storySection').hidden=page!=='category';
 $('playerSection').hidden=page!=='story';
 $('listenSection').hidden=page!=='listen';
 window.scrollTo({top:0,behavior:'instant'})
}

function renderCategories(){
 const cats=catalog.categories.length?catalog.categories:DEFAULT_CATEGORIES.map(x=>({...x,image_path:''}));
 $('categoryCount').textContent=cats.length+' تصنيفات';
 $('categories').innerHTML=cats.map(c=>{
  const image=c.image_path||c.image_url;
  return `<button class="category" data-category="${esc(c.id)}">${image?`<img src="${esc(mediaUrl(image))}" alt="${esc(c.title)}" loading="lazy">`:`<span class="placeholder">${esc(c.emoji||'📚')}</span>`}<h3>${esc(c.title)}</h3></button>`
 }).join('');
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>openCategory(b.dataset.category))
}

function storyRow(s,rank=''){
 const cover=s.wide_image_path||s.image_path;
 return `<article class="story" data-story-card="${esc(s.id)}">${rank?`<span class="story-rank" aria-label="الترتيب ${rank}">${rank}</span>`:''}<img class="story-cover" src="${esc(mediaUrl(cover))}" alt="${esc(s.title)}" loading="lazy" onerror="this.style.visibility='hidden'"><div class="story-info"><h3>${esc(s.title)}</h3><div class="story-meta"><img class="story-brand-logo" src="/logo.png" alt=""><span class="story-brand-name">قصص وروايات صوتية</span><span class="story-views">${(Number(s.views)||0).toLocaleString('ar')} مشاهدة</span></div></div></article>`
}

function bindStoryButtons(root=document){
 root.querySelectorAll('[data-story-card]').forEach(el=>{
  el.onclick=()=>openStory(el.dataset.storyCard);
  el.setAttribute('tabindex','0');
  el.setAttribute('role','button');
  el.onkeydown=e=>{
   if(e.key==='Enter'||e.key===' '){
    e.preventDefault();
    openStory(el.dataset.storyCard)
   }
  }
 })
}

function showNotice(message){
 const n=$('notice');
 if(!n)return;
 n.textContent=message;
 n.hidden=false;
 clearTimeout(n._timer);
 n._timer=setTimeout(()=>n.hidden=true,2600)
}

function renderTopStories(){}

function setCategoryTab(tab){
 const top=tab==='top';
 $('stories').hidden=top;
 $('categoryTopStories').hidden=!top;
 $('allStoriesTab').classList.toggle('active',!top);
 $('topStoriesTab').classList.toggle('active',top);
 $('allStoriesTab').setAttribute('aria-selected',String(!top));
 $('topStoriesTab').setAttribute('aria-selected',String(top))
}

function openCategory(id,fromRoute=false){
 selected=String(id);
 const c=catalog.categories.find(x=>String(x.id)===selected)||DEFAULT_CATEGORIES.find(x=>x.id===selected);
 $('selectedTitle').textContent=c?.title||'القصص';
 const stories=catalog.stories.filter(s=>String(s.category_id)===selected);
 $('storyCount').textContent=stories.length+' قصة';
 $('topStoriesTab').textContent='الأكثر استماعًا';
 const top=[...stories].sort((a,b)=>(Number(b.views)||0)-(Number(a.views)||0));
 $('categoryTopStories').innerHTML=top.length?top.map((s,i)=>storyRow(s,i+1)).join(''):'<div class="empty">لا توجد قصص في هذا التصنيف حتى الآن.</div>';
 $('stories').innerHTML=stories.length?stories.map(s=>storyRow(s)).join(''):'<div class="empty">لا توجد قصص في هذا التصنيف حتى الآن.</div>';
 bindStoryButtons($('categoryTopStories'));
 bindStoryButtons($('stories'));
 setCategoryTab('all');
 showPage('category');
 if(!fromRoute&&location.pathname!=='/category/'+encodeURIComponent(selected)){
  navigateRoute('category',selected)
 }
}

async function openStory(id,fromRoute=false){
 const s=catalog.stories.find(x=>String(x.id)===String(id));
 if(!s)return;
 currentStory=s;
 $('detailImage').src=mediaUrl(s.image_path);
 $('detailImage').alt=s.title;
 $('detailTitle').textContent=s.title;
 $('playerDescription').textContent=s.description||'لا يوجد وصف لهذه القصة حتى الآن.';
 $('descriptionContent').classList.add('collapsed');
 $('descriptionToggle').setAttribute('aria-expanded','false');
 $('descriptionArrow').textContent='⌄';

 const audio=$('audioPlayer');
 audio.pause();
 audio.removeAttribute('src');
 audio.src=mediaUrl(s.audio_path);
 audio.load();

 audio.addEventListener('loadedmetadata',function restoreProgress(){
  if(!currentStory||String(currentStory.id)!==String(s.id))return;
  const saved=Number(localStorage.getItem(progressKey(s.id))||0);
  if(saved>5&&Number.isFinite(audio.duration)&&saved<audio.duration-3){
   audio.currentTime=saved
  }
 },{once:true});

 $('listenImage').src=mediaUrl(s.image_path);
 $('listenImage').alt=s.title;
 $('listenTitle').textContent=s.title;
 $('playerMeta').textContent=(Number(s.views)||0).toLocaleString('ar')+' مشاهدة';

 renderRecommendations(s);
 showPage('story');

 const desiredPage=(fromRoute&&(location.pathname.startsWith('/listen/')||location.hash.startsWith('#listen=')))?'listen':'story';
 const desiredPath=routePath(desiredPage,s.id);

 if(fromRoute){
  if(location.pathname!==desiredPath&&!location.hash.startsWith('#')){
   history.replaceState({page:desiredPage,id:String(s.id)},'',desiredPath)
  }
 }else if(location.pathname!==desiredPath){
  navigateRoute('story',s.id);
  return
 }

 if(API){
  try{
   const r=await fetch(API.replace(/\/$/,'')+'/api/view/'+encodeURIComponent(id),{method:'POST'});
   if(r.ok){
    s.views=(Number(s.views)||0)+1;
    $('playerMeta').textContent=s.views.toLocaleString('ar')+' مشاهدة'
   }
  }catch{}
 }
}

function renderRecommendations(story){
 const same=catalog.stories.filter(s=>String(s.id)!==String(story.id)&&String(s.category_id)===String(story.category_id));
 const pool=same.length?same:catalog.stories.filter(s=>String(s.id)!==String(story.id));
 for(let i=pool.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [pool[i],pool[j]]=[pool[j],pool[i]]
 }
 const picks=pool.slice(0,6);
 $('recommendedStories').innerHTML=picks.length?picks.map(s=>storyRow(s)).join(''):'<div class="empty">أضف قصصًا أخرى ليظهر هنا المزيد من الاقتراحات.</div>';
 bindStoryButtons($('recommendedStories'))
}

function fmt(t){
 if(!Number.isFinite(t)||t<0)return '0:00';
 const n=Math.floor(t);
 return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')
}

let isSeeking=false;
const progressKey=id=>'qisas_audio_progress_'+String(id);

function buildWaveform(){
 const wave=$('audioWaveform');
 if(!wave||wave.dataset.ready)return;
 wave.innerHTML=Array.from({length:72},(_,i)=>{
  const h=8+Math.round(Math.abs(Math.sin(i*1.73)*Math.cos(i*.29))*34+Math.abs(Math.sin(i*.17))*15);
  return `<span class="wave-bar" style="--bar-height:${h}px;--bar-delay:${(i%13)*-0.075}s"></span>`
 }).join('');
 wave.dataset.ready='1'
}

buildWaveform();

function syncAudio(){
 const a=$('audioPlayer');
 $('currentTime').textContent=fmt(a.currentTime);
 $('duration').textContent=fmt(a.duration);
 if(!isSeeking&&Number.isFinite(a.duration)&&a.duration>0){
  $('seekBar').value=String(Math.round((a.currentTime/a.duration)*1000))
 }
}

function seekToSlider(){
 const a=$('audioPlayer');
 const duration=a.duration;
 if(!Number.isFinite(duration)||duration<=0)return;
 const value=Number($('seekBar').value);
 if(Number.isFinite(value))a.currentTime=Math.max(0,Math.min(duration,(value/1000)*duration));
 $('currentTime').textContent=fmt(a.currentTime)
}

const seekBar=$('seekBar');
seekBar.addEventListener('pointerdown',()=>{isSeeking=true});
seekBar.addEventListener('pointerup',()=>{seekToSlider();isSeeking=false;syncAudio()});
seekBar.addEventListener('pointercancel',()=>{seekToSlider();isSeeking=false;syncAudio()});
seekBar.addEventListener('touchstart',()=>{isSeeking=true},{passive:true});
seekBar.addEventListener('touchend',()=>{seekToSlider();isSeeking=false;syncAudio()},{passive:true});
seekBar.addEventListener('mousedown',()=>{isSeeking=true});
window.addEventListener('mouseup',()=>{if(isSeeking){seekToSlider();isSeeking=false;syncAudio()}});
seekBar.addEventListener('input',seekToSlider);
seekBar.addEventListener('change',()=>{seekToSlider();isSeeking=false;syncAudio()});

$('backCategories').onclick=()=>navigateRoute('home');
$('allStoriesTab').onclick=()=>setCategoryTab('all');
$('topStoriesTab').onclick=()=>setCategoryTab('top');

$('closePlayer').onclick=()=>{
 $('audioPlayer').pause();
 if(selected)navigateRoute('category',selected);
 else navigateRoute('home')
};

$('listenStory').onclick=()=>{
 if(!currentStory)return;
 $('audioPlayer').pause();
 navigateRoute('listen',currentStory.id)
};

$('backToDetails').onclick=()=>{
 $('audioPlayer').pause();
 if(currentStory)navigateRoute('story',currentStory.id)
};

$('descriptionToggle').onclick=()=>{
 const box=$('descriptionContent');
 const open=box.classList.toggle('collapsed')===false;
 $('descriptionToggle').setAttribute('aria-expanded',String(open));
 $('descriptionArrow').textContent=open?'⌃':'⌄'
};

$('playPause').onclick=()=>{
 const a=$('audioPlayer');
 if(a.paused){
  a.play().then(()=>{
   $('playPause').textContent='Ⅱ';
   $('playPause').setAttribute('aria-label','إيقاف مؤقت')
  }).catch(()=>{})
 }else{
  a.pause();
  $('playPause').textContent='▶';
  $('playPause').setAttribute('aria-label','تشغيل')
 }
};

$('seekBack').onclick=()=>{$('audioPlayer').currentTime=Math.max(0,$('audioPlayer').currentTime-15)};
$('seekForward').onclick=()=>{
 const a=$('audioPlayer');
 a.currentTime=Math.min(a.duration||Infinity,a.currentTime+15)
};

$('audioPlayer').addEventListener('timeupdate',()=>{
 syncAudio();
 if(currentStory&&!$('audioPlayer').ended){
  localStorage.setItem(progressKey(currentStory.id),String($('audioPlayer').currentTime))
 }
});
$('audioPlayer').addEventListener('loadedmetadata',syncAudio);
$('audioPlayer').addEventListener('durationchange',syncAudio);
$('audioPlayer').addEventListener('seeked',syncAudio);
$('audioPlayer').addEventListener('play',()=>{
 $('playPause').textContent='Ⅱ';
 $('playPause').setAttribute('aria-label','إيقاف مؤقت');
 $('audioWaveform').classList.add('playing')
});
$('audioPlayer').addEventListener('pause',()=>{
 $('playPause').textContent='▶';
 $('playPause').setAttribute('aria-label','تشغيل');
 $('audioWaveform').classList.remove('playing')
});
$('audioPlayer').addEventListener('ended',()=>{
 $('playPause').textContent='▶';
 $('seekBar').value=0;
 $('audioWaveform').classList.remove('playing');
 if(currentStory)localStorage.removeItem(progressKey(currentStory.id))
});
$('playbackSpeed').addEventListener('change',e=>{
 $('audioPlayer').playbackRate=Number(e.target.value)||1
});

const sideMenu=$('sideMenu'),menuOverlay=$('menuOverlay');

function setMenu(open){
 sideMenu.classList.toggle('open',open);
 menuOverlay.hidden=!open;
 sideMenu.setAttribute('aria-hidden',String(!open));
 $('menuBtn').setAttribute('aria-expanded',String(open));
 document.body.classList.toggle('menu-open',open)
}

$('menuBtn').onclick=()=>setMenu(true);
$('closeMenu').onclick=()=>setMenu(false);
menuOverlay.onclick=()=>setMenu(false);

document.addEventListener('keydown',e=>{
 if(e.key==='Escape')setMenu(false)
});

document.querySelectorAll('.side-links a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));

async function restoreRoute(){
 const path=location.pathname;
 const hash=location.hash;

 let m=path.match(/^\/category\/([^/]+)\/?$/);
 if(m){
  openCategory(decodeURIComponent(m[1]),true);
  return
 }

 m=path.match(/^\/(story|listen)\/([^/]+)\/?$/);
 if(m){
  const id=decodeURIComponent(m[2]);
  await openStory(id,true);
  if(m[1]==='listen'){
   showPage('listen');
   $('audioPlayer').pause()
  }
  return
 }

 if(hash){
  m=hash.match(/^#category=(.+)$/);
  if(m){
   openCategory(decodeURIComponent(m[1]),true);
   return
  }

  m=hash.match(/^#(?:story|listen)=(.+)$/);
  if(m){
   const id=decodeURIComponent(m[1]);
   await openStory(id,true);
   if(hash.startsWith('#listen=')){
    showPage('listen');
    $('audioPlayer').pause()
   }
   return
  }
 }

 showPage('home')
}

window.addEventListener('popstate',()=>{restoreRoute()});
window.addEventListener('pageshow',()=>{
 if(catalog.categories.length)restoreRoute()
});

load().then(()=>restoreRoute());

// منع بعض عمليات الحفظ السهلة فقط؛ لا يمنع تنزيل الوسائط بشكل كامل.
document.addEventListener('contextmenu',e=>{
 if(e.target.closest('img, audio, .story, .player-section, .listen-section'))e.preventDefault()
});

document.addEventListener('dragstart',e=>{
 if(e.target.closest('img'))e.preventDefault()
});

document.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&['s','u'].includes(e.key.toLowerCase())){
  e.preventDefault()
 }
});
