const CATEGORIES=[
{slug:'fantasy',title:'قصص فانتازيا',emoji:'✨',sort_order:1},
{slug:'forced-marriage',title:'الزواج الإجباري',emoji:'💍',sort_order:2},
{slug:'history',title:'قصص تاريخية',emoji:'🏰',sort_order:3},
{slug:'children',title:'قصص أطفال',emoji:'🧸',sort_order:4},
{slug:'romance',title:'قصص رومانسية',emoji:'🌹',sort_order:5},
{slug:'horror',title:'قصص رعب',emoji:'🌙',sort_order:6},
{slug:'alf-layla',title:'ألف ليلة وليلة',emoji:'🪔',sort_order:7}
];

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{
 status,
 headers:{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  ...headers
 }
});

const corsHeaders=(origin)=>({
 'Access-Control-Allow-Origin':origin||'*',
 'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type,X-Admin-Email,X-Admin-Password,X-Visitor-ID',
 'Vary':'Origin'
});

function validOrigin(origin){
 return !origin||
 /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin)||
 /^http:\/\/localhost(:\d+)?$/i.test(origin);
}

function respond(req,data,status=200){
 return json(data,status,corsHeaders(req.headers.get('Origin')));
}

function adminOk(req,env){
 const email=req.headers.get('X-Admin-Email')||'';
 const password=req.headers.get('X-Admin-Password')||'';
 return !!env.ADMIN_EMAIL&&!!env.ADMIN_PASSWORD&&
 email===env.ADMIN_EMAIL&&password===env.ADMIN_PASSWORD;
}

function id(){
 return crypto.randomUUID();
}

function safeFile(name){
 return String(name||'file')
  .replace(/[^a-zA-Z0-9._-]/g,'_')
  .slice(-100)||'file';
}

async function ensureCategories(env){
 const stmt=env.DB.prepare(
  'INSERT OR IGNORE INTO categories (name,slug,sort_order,is_active) VALUES (?,?,?,1)'
 );
 await env.DB.batch(CATEGORIES.map(c=>stmt.bind(c.title,c.slug,c.sort_order)));
 // Keep a normalized many-to-many relation while preserving category_id for older clients.
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS story_categories (
   story_id INTEGER NOT NULL, category_id INTEGER NOT NULL,
   PRIMARY KEY(story_id,category_id),
   FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
   FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
 )`).run();
 await env.DB.prepare(`INSERT OR IGNORE INTO story_categories(story_id,category_id)
   SELECT id,category_id FROM stories WHERE category_id IS NOT NULL`).run();
}

async function attachStoryCategories(env, stories){
 const rows=(stories||[]);
 if(!rows.length)return rows.map(s=>({...s,category_ids:[String(s.category_id)],category_titles:[]}));
 const links=await env.DB.prepare(`SELECT sc.story_id,sc.category_id,c.name AS category_title
   FROM story_categories sc JOIN categories c ON c.id=sc.category_id
   ORDER BY c.sort_order,c.id`).all();
 const map=new Map();
 for(const row of links.results||[]){
  const key=String(row.story_id); if(!map.has(key))map.set(key,{ids:[],titles:[]});
  map.get(key).ids.push(String(row.category_id)); map.get(key).titles.push(row.category_title);
 }
 return rows.map(s=>{
  const related=map.get(String(s.id));
  const fallback=String(s.category_id||'');
  return {...s,category_ids:related?.ids?.length?related.ids:(fallback?[fallback]:[]),category_titles:related?.titles||[]};
 });
}

async function saveStoryCategories(env, storyId, categoryIds){
 const ids=[...new Set((categoryIds||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))];
 if(!ids.length)throw new Error('اختاري تصنيفًا واحدًا على الأقل');
 const placeholders=ids.map(()=>'?').join(',');
 const found=await env.DB.prepare(`SELECT id FROM categories WHERE is_active=1 AND id IN (${placeholders})`).bind(...ids).all();
 if((found.results||[]).length!==ids.length)throw new Error('أحد التصنيفات المختارة غير موجود');
 await env.DB.prepare('DELETE FROM story_categories WHERE story_id=?').bind(Number(storyId)).run();
 await env.DB.batch(ids.map(cid=>env.DB.prepare('INSERT OR IGNORE INTO story_categories(story_id,category_id) VALUES(?,?)').bind(Number(storyId),cid)));
}

async function categoryIdsFromBody(env,b){
 const supplied=Array.isArray(b.category_ids)?b.category_ids:(b.category_id?[b.category_id]:[]);
 const ids=[...new Set(supplied.map(Number).filter(n=>Number.isInteger(n)&&n>0))];
 if(!ids.length)throw new Error('اختاري تصنيفًا واحدًا على الأقل');
 const marks=ids.map(()=>'?').join(',');
 const r=await env.DB.prepare(`SELECT id FROM categories WHERE id IN (${marks}) AND is_active=1`).bind(...ids).all();
 if((r.results||[]).length!==ids.length)throw new Error('أحد التصنيفات المختارة غير موجود');
 return ids;
}

async function catalog(env){
 await ensureCategories(env);
 const [cats,stories]=await Promise.all([
  env.DB.prepare('SELECT id,name AS title,slug,NULL AS emoji,sort_order,image_url AS image_path FROM categories WHERE is_active=1 ORDER BY sort_order,id').all(),
  env.DB.prepare('SELECT id,title,description,category_id,audio_url AS audio_path,image_url AS image_path,wide_image_url AS wide_image_path,total_episodes,status,character_one_name,character_two_name,character_three_name,character_one_image_url AS character_one_image_path,character_two_image_url AS character_two_image_path,character_three_image_url AS character_three_image_path,views,created_at FROM stories WHERE is_published=1 ORDER BY created_at DESC').all()
 ]);
 const enriched=await attachStoryCategories(env,stories.results||[]);
 return {
  categories:(cats.results||[]).map(c=>({...c,id:String(c.id),emoji:CATEGORIES.find(x=>x.slug===c.slug)?.emoji||'📚'})),
  stories:enriched.map(s=>({...s,id:String(s.id),category_id:String(s.category_id),category_ids:s.category_ids.map(String)}))
 };
}

export default {
 async fetch(req,env){
  const origin=req.headers.get('Origin');

  if(!validOrigin(origin)){
   return json({error:'Origin not allowed'},403);
  }

  if(req.method==='OPTIONS'){
   return new Response(null,{
    status:204,
    headers:corsHeaders(origin)
   });
  }

  const u=new URL(req.url);
  const p=u.pathname;

  try{

   if(p==='/'&&req.method==='GET'){
    return respond(req,{
     name:'قصص وروايات صوتية',
     status:'online',
     health:'/api/health'
    });
   }

   if(p==='/api/health'&&req.method==='GET'){
    const r=await env.DB.prepare(
     "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    return respond(req,{
     success:true,
     message:'API is connected',
     database:'connected',
     tables:(r.results||[]).map(x=>x.name),
     storage:'binding configured'
    });
   }

   if(p==='/api/catalog'&&req.method==='GET'){
    return respond(req,await catalog(env));
   }

   // Latest updates are published episodes, not demo stories. The original
   // story audio is episode 1; story_parts part_number 1 is episode 2.
   if(p==='/api/latest-updates'&&req.method==='GET'){
    await ensureCategories(env);
    const r=await env.DB.prepare(`
      SELECT story_id,story_title,category_title,image_path,episode_number,total_episodes,published_at
      FROM (
        SELECT s.id AS story_id,s.title AS story_title,
          COALESCE((SELECT GROUP_CONCAT(c.name,' · ') FROM story_categories sc JOIN categories c ON c.id=sc.category_id WHERE sc.story_id=s.id),c.name,'') AS category_title,
          NULLIF(TRIM(s.image_url),'') AS image_path,1 AS episode_number,
          s.total_episodes AS total_episodes,s.created_at AS published_at
        FROM stories s LEFT JOIN categories c ON c.id=s.category_id
        WHERE s.is_published=1 AND COALESCE(s.audio_url,'')<>''
        UNION ALL
        SELECT s.id AS story_id,s.title AS story_title,
          COALESCE((SELECT GROUP_CONCAT(c.name,' · ') FROM story_categories sc JOIN categories c ON c.id=sc.category_id WHERE sc.story_id=s.id),c.name,'') AS category_title,
          COALESCE(NULLIF(TRIM(sp.image_url),''),NULLIF(TRIM(s.image_url),'')) AS image_path,
          (sp.part_number+1) AS episode_number,s.total_episodes AS total_episodes,sp.created_at AS published_at
        FROM story_parts sp JOIN stories s ON s.id=sp.story_id
        LEFT JOIN categories c ON c.id=s.category_id
        WHERE s.is_published=1 AND sp.is_published=1 AND COALESCE(sp.audio_url,'')<>''
      )
      GROUP BY story_id,episode_number
      ORDER BY published_at DESC,story_id DESC,episode_number DESC LIMIT 30
    `).all();
    return respond(req,{updates:(r.results||[]).map(x=>({...x,story_id:String(x.story_id),episode_number:Number(x.episode_number||1),total_episodes:Number(x.total_episodes||0)}))});
   }

   // Public comments for anonymous visitors. A persistent visitor token grants
   // ownership of that visitor's own comments without requiring an account.
   if(/^\/api\/story\/\d+\/comments$/.test(p)&&req.method==='GET'){
    const sid=Number(p.split('/')[3]);
    const story=await env.DB.prepare('SELECT id FROM stories WHERE id=? AND is_published=1').bind(sid).first();
    if(!story)return respond(req,{error:'القصة غير موجودة'},404);
    const visitor=String(req.headers.get('X-Visitor-ID')||'');
    const r=await env.DB.prepare(`SELECT c.id,c.story_id,c.parent_id,c.display_name,c.avatar,c.content,c.likes_count,c.created_at,c.updated_at,CASE WHEN c.visitor_token=? THEN 1 ELSE 0 END AS is_mine,EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.visitor_token=?) AS liked_by_me
      FROM comments c WHERE c.story_id=? ORDER BY c.created_at ASC,c.id ASC LIMIT 1000`).bind(visitor,visitor,sid).all();
    return respond(req,{comments:(r.results||[]).map(c=>({...c,id:String(c.id),story_id:String(c.story_id),parent_id:c.parent_id==null?null:String(c.parent_id),likes_count:Number(c.likes_count||0),is_mine:Number(c.is_mine)===1,liked_by_me:Number(c.liked_by_me)===1}))});
   }

   if(/^\/api\/story\/\d+\/comments$/.test(p)&&req.method==='POST'){
    const sid=Number(p.split('/')[3]);
    const b=await req.json().catch(()=>({}));
    const token=String(b.visitor_id||'');
    const content=String(b.content||'').trim();
    const displayName=String(b.display_name||'زائر').trim().slice(0,40)||'زائر';
    const avatar=String(b.avatar||'avatar-girl-1').slice(0,40);
    const parentId=b.parent_id==null||b.parent_id===''?null:Number(b.parent_id);
    if(!/^[a-zA-Z0-9-]{20,80}$/.test(token))return respond(req,{error:'تعذر التحقق من هوية الزائر. حدّث الصفحة وحاول مجددًا.'},400);
    if(content.length<1||content.length>1000)return respond(req,{error:'اكتب تعليقًا من 1 إلى 1000 حرف.'},400);
    const story=await env.DB.prepare('SELECT id FROM stories WHERE id=? AND is_published=1').bind(sid).first();
    if(!story)return respond(req,{error:'القصة غير موجودة'},404);
    if(parentId!==null){
     const parent=await env.DB.prepare('SELECT id FROM comments WHERE id=? AND story_id=?').bind(parentId,sid).first();
     if(!parent)return respond(req,{error:'التعليق المراد الرد عليه غير موجود'},404);
    }
    const r=await env.DB.prepare('INSERT INTO comments(story_id,parent_id,visitor_token,display_name,avatar,content) VALUES(?,?,?,?,?,?)')
     .bind(sid,parentId,token,displayName,avatar,content).run();
    return respond(req,{success:true,id:String(r.meta?.last_row_id||''),parent_id:parentId===null?null:String(parentId),display_name:displayName,avatar,content,likes_count:0,created_at:new Date().toISOString() },201);
   }

   if(/^\/api\/comment\/\d+$/.test(p)&&['PUT','DELETE'].includes(req.method)){
    const cid=Number(p.split('/')[3]);
    const b=await req.json().catch(()=>({}));
    const token=String(b.visitor_id||'');
    if(!/^[a-zA-Z0-9-]{20,80}$/.test(token))return respond(req,{error:'تعذر التحقق من ملكية التعليق'},400);
    const existing=await env.DB.prepare('SELECT id FROM comments WHERE id=? AND visitor_token=?').bind(cid,token).first();
    if(!existing)return respond(req,{error:'يمكنك تعديل أو حذف تعليقاتك فقط'},403);
    if(req.method==='DELETE'){
     await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(cid).run();
     return respond(req,{success:true});
    }
    const content=String(b.content||'').trim();
    if(content.length<1||content.length>1000)return respond(req,{error:'اكتب تعليقًا من 1 إلى 1000 حرف.'},400);
    await env.DB.prepare('UPDATE comments SET content=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND visitor_token=?').bind(content,cid,token).run();
    return respond(req,{success:true,content});
   }

   if(/^\/api\/comment\/\d+\/like$/.test(p)&&req.method==='POST'){
    const cid=Number(p.split('/')[3]);
    const b=await req.json().catch(()=>({}));
    const token=String(b.visitor_id||'');
    if(!/^[a-zA-Z0-9-]{20,80}$/.test(token))return respond(req,{error:'تعذر التحقق من هوية الزائر'},400);
    const comment=await env.DB.prepare('SELECT id FROM comments WHERE id=?').bind(cid).first();
    if(!comment)return respond(req,{error:'التعليق غير موجود'},404);
    const liked=await env.DB.prepare('SELECT comment_id FROM comment_likes WHERE comment_id=? AND visitor_token=?').bind(cid,token).first();
    if(liked)await env.DB.prepare('DELETE FROM comment_likes WHERE comment_id=? AND visitor_token=?').bind(cid,token).run();
    else await env.DB.prepare('INSERT OR IGNORE INTO comment_likes(comment_id,visitor_token) VALUES(?,?)').bind(cid,token).run();
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id=?').bind(cid).first();
    await env.DB.prepare('UPDATE comments SET likes_count=? WHERE id=?').bind(Number(count?.n||0),cid).run();
    return respond(req,{success:true,liked:!liked,likes_count:Number(count?.n||0)});
   }

   if(p==='/api/admin/comments'&&req.method==='GET'){
    if(!adminOk(req,env))return respond(req,{error:'Unauthorized'},401);
    const r=await env.DB.prepare(`SELECT c.id,c.story_id,c.parent_id,c.display_name,c.avatar,c.content,c.likes_count,c.created_at,s.title AS story_title
      FROM comments c LEFT JOIN stories s ON s.id=c.story_id ORDER BY c.created_at DESC LIMIT 1000`).all();
    return respond(req,{comments:(r.results||[]).map(c=>({...c,id:String(c.id),story_id:String(c.story_id),parent_id:c.parent_id==null?null:String(c.parent_id),likes_count:Number(c.likes_count||0)}))});
   }

   if(/^\/api\/admin\/comment\/\d+$/.test(p)&&req.method==='DELETE'){
    if(!adminOk(req,env))return respond(req,{error:'Unauthorized'},401);
    const cid=Number(p.split('/')[4]);
    await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(cid).run();
    return respond(req,{success:true});
   }

   if(/^\/api\/story\/\d+\/parts$/.test(p)&&req.method==='GET'){
    const sid=Number(p.split('/')[3]);

    const story=await env.DB.prepare(
     'SELECT id FROM stories WHERE id=? AND is_published=1'
    ).bind(sid).first();

    if(!story){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    const r=await env.DB.prepare(
     'SELECT id,story_id,title,audio_url AS audio_path,image_url AS image_path,part_number AS sort_order FROM story_parts WHERE story_id=? AND is_published=1 ORDER BY part_number,id'
    ).bind(sid).all();

    return respond(req,{
     parts:(r.results||[]).map(x=>({
      ...x,
      id:String(x.id),
      story_id:String(x.story_id)
     }))
    });
   }

   if(/^\/api\/admin\/story\/\d+\/parts$/.test(p)&&req.method==='GET'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const sid=Number(p.split('/')[4]);

    const r=await env.DB.prepare(
     'SELECT id,story_id,title,audio_url AS audio_path,image_url AS image_path,part_number AS sort_order FROM story_parts WHERE story_id=? ORDER BY part_number,id'
    ).bind(sid).all();

    return respond(req,{
     parts:(r.results||[]).map(x=>({
      ...x,
      id:String(x.id),
      story_id:String(x.story_id)
     }))
    });
   }

   if(/^\/api\/admin\/story\/\d+\/parts$/.test(p)&&req.method==='POST'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const sid=Number(p.split('/')[4]);
    const b=await req.json();

    if(
     !Number.isInteger(sid)||
     !String(b.title||'').trim()||
     !String(b.audio_path||'').startsWith('audio/')
    ){
     return respond(req,{
      error:'عنوان الجزء وملف MP3 مطلوبان'
     },400);
    }

    const story=await env.DB.prepare(
     'SELECT id FROM stories WHERE id=?'
    ).bind(sid).first();

    if(!story){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    const max=await env.DB.prepare(
     'SELECT COALESCE(MAX(part_number),0) AS n FROM story_parts WHERE story_id=?'
    ).bind(sid).first();

    const r=await env.DB.prepare(
     'INSERT INTO story_parts(story_id,part_number,title,audio_url,image_url) VALUES(?,?,?,?,?)'
    ).bind(
     sid,
     Number(max?.n||0)+1,
     String(b.title).trim().slice(0,180),
     b.audio_path,
     b.image_path||null
    ).run();

    return respond(req,{
     success:true,
     id:String(r.meta?.last_row_id||'')
    });
   }

   if(/^\/api\/admin\/part\/\d+$/.test(p)&&['PUT','DELETE'].includes(req.method)){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const pid=Number(p.split('/')[4]);

    const old=await env.DB.prepare(
     'SELECT * FROM story_parts WHERE id=?'
    ).bind(pid).first();

    if(!old){
     return respond(req,{error:'الجزء غير موجود'},404);
    }

    if(req.method==='DELETE'){
     await env.DB.prepare(
      'DELETE FROM story_parts WHERE id=?'
     ).bind(pid).run();

     for(const key of [old.audio_url,old.image_url]){
      if(
       key&&
       /^(audio\/[0-9a-f-]+\.mp3|images\/[0-9a-f-]+\.(jpg|png|webp))$/i.test(key)
      ){
       await env.MEDIA.delete(key);
      }
     }

     return respond(req,{success:true});
    }

    const b=await req.json();

    if(!String(b.title||'').trim()){
     return respond(req,{error:'عنوان الجزء مطلوب'},400);
    }

    await env.DB.prepare(
     'UPDATE story_parts SET title=?,audio_url=?,image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(
     String(b.title).trim().slice(0,180),
     b.audio_path||old.audio_url,
     b.image_path||old.image_url||null,
     pid
    ).run();

    if(
     b.audio_path&&
     b.audio_path!==old.audio_url&&
     /^audio\/[0-9a-f-]+\.mp3$/i.test(old.audio_url)
    ){
     await env.MEDIA.delete(old.audio_url);
    }

    return respond(req,{success:true});
   }

   if(p.startsWith('/media/')&&['GET','HEAD'].includes(req.method)){
    const key=decodeURIComponent(p.slice(7));

    if(
     !/^(audio|images)\/[a-zA-Z0-9._/-]+$/.test(key)||
     key.split('/').includes('..')
    ){
     return respond(req,{error:'Invalid media path'},400);
    }

    const rangeHeader=req.headers.get('Range');
    let obj,status=200,start=0,end=-1;

    if(rangeHeader){
     const base=await env.MEDIA.head(key);

     if(!base){
      return respond(req,{error:'Not found'},404);
     }

     const size=base.size;
     const match=/^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

     if(!match||(!match[1]&&!match[2])){
      return new Response(null,{
       status:416,
       headers:{
        'Content-Range':`bytes */${size}`,
        'Accept-Ranges':'bytes',
        ...corsHeaders(origin)
       }
      });
     }

     if(!match[1]){
      const suffix=Number(match[2]);
      start=Math.max(0,size-suffix);
      end=size-1;
     }else{
      start=Number(match[1]);
      end=match[2]?Math.min(Number(match[2]),size-1):size-1;
     }

     if(
      !Number.isSafeInteger(start)||
      !Number.isSafeInteger(end)||
      start<0||
      start>=size||
      end<start
     ){
      return new Response(null,{
       status:416,
       headers:{
        'Content-Range':`bytes */${size}`,
        'Accept-Ranges':'bytes',
        ...corsHeaders(origin)
       }
      });
     }

     obj=await env.MEDIA.get(key,{
      range:{offset:start,length:end-start+1}
     });

     status=206;
    }else{
     obj=await env.MEDIA.get(key);

     if(!obj){
      return respond(req,{error:'Not found'},404);
     }

     end=obj.size-1;
    }

    if(!obj){
     return respond(req,{error:'Not found'},404);
    }

    const h=new Headers(corsHeaders(origin));

    h.set(
     'Content-Type',
     obj.httpMetadata?.contentType||'application/octet-stream'
    );

    h.set('Cache-Control','public, max-age=3600');
    h.set('Accept-Ranges','bytes');

    if(status===206){
     h.set(
      'Content-Range',
      `bytes ${start}-${end}/${(await env.MEDIA.head(key)).size}`
     );

     h.set('Content-Length',String(end-start+1));
    }else if(obj.size){
     h.set('Content-Length',String(obj.size));
    }

    return new Response(req.method==='HEAD'?null:obj.body,{
     status,
     headers:h
    });
   }

   if(p==='/api/admin/login'&&req.method==='POST'){
    const b=await req.json().catch(()=>({}));

    if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD){
     return respond(req,{
      error:'إعدادات دخول الأدمن غير مكتملة في Cloudflare Worker.'
     },503);
    }

    if(
     String(b.email||'')!==env.ADMIN_EMAIL||
     String(b.password||'')!==env.ADMIN_PASSWORD
    ){
     return respond(req,{
      error:'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
     },401);
    }

    return respond(req,{success:true});
   }

   if(p==='/api/upload-url'&&req.method==='POST'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const kind=u.searchParams.get('kind');
    const type=u.searchParams.get('type')||'';
    const filename=safeFile(u.searchParams.get('filename'));

    let folder,ext;

    if(
     kind==='audio'&&
     /\.mp3$/i.test(filename)&&
     (
      type==='audio/mpeg'||
      type==='audio/mp3'||
      type==='application/octet-stream'
     )
    ){
     folder='audio';
     ext='.mp3';
    }else if(
     ['story','story-wide','category','part-image','story-character'].includes(kind)&&
     ['image/jpeg','image/png','image/webp'].includes(type)
    ){
     folder='images';
     ext=type==='image/jpeg'?'.jpg':
         type==='image/png'?'.png':'.webp';
    }else{
     return respond(req,{
      error:'نوع الملف غير مدعوم. استخدمي MP3 وصور JPG أو PNG أو WebP.'
     },415);
    }

    return respond(req,{key:folder+'/'+id()+ext});
   }

   if(p.startsWith('/api/upload/')&&req.method==='PUT'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const key=decodeURIComponent(
     p.slice('/api/upload/'.length)
    );

    if(
     !/^(audio|images)\/[0-9a-f-]{36}\.(mp3|jpg|png|webp)$/i.test(key)
    ){
     return respond(req,{error:'Invalid upload key'},400);
    }

    const type=req.headers.get('Content-Type')||'application/octet-stream';
    const isAudio=key.startsWith('audio/');

    if(
     isAudio&&
     type!=='audio/mpeg'&&
     type!=='audio/mp3'&&
     type!=='application/octet-stream'
    ){
     return respond(req,{error:'ملف الصوت يجب أن يكون MP3'},415);
    }

    const max=isAudio?100*1024*1024:8*1024*1024;
    const buf=await req.arrayBuffer();

    if(buf.byteLength>max){
     return respond(req,{
      error:isAudio
       ?'حجم MP3 يتجاوز 100 ميغابايت'
       :'حجم الصورة يتجاوز 8 ميغابايت'
     },413);
    }

    await env.MEDIA.put(key,buf,{
     httpMetadata:{
      contentType:isAudio?'audio/mpeg':type
     }
    });

    return respond(req,{success:true,key});
   }

   if(p==='/api/admin/catalog'&&req.method==='GET'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }
    await ensureCategories(env);

    const [cats,stories]=await Promise.all([
     env.DB.prepare(
      'SELECT id,name AS title,slug,NULL AS emoji,sort_order,image_url AS image_path FROM categories WHERE is_active=1 ORDER BY sort_order,id'
     ).all(),

     env.DB.prepare(
      'SELECT id,title,description,category_id,audio_url AS audio_path,image_url AS image_path,wide_image_url AS wide_image_path,total_episodes,status,character_one_name,character_two_name,character_three_name,character_one_image_url AS character_one_image_path,character_two_image_url AS character_two_image_path,character_three_image_url AS character_three_image_path,views,created_at FROM stories ORDER BY created_at DESC,id DESC'
     ).all()
    ]);

    const enriched=await attachStoryCategories(env,stories.results||[]);
    return respond(req,{
     categories:(cats.results||[]).map(c=>({...c,id:String(c.id),emoji:CATEGORIES.find(x=>x.slug===c.slug)?.emoji||'📚'})),
     stories:enriched.map(s=>({...s,id:String(s.id),category_id:String(s.category_id),category_ids:s.category_ids.map(String)}))
    });
   }

   if(p==='/api/admin/category'&&req.method==='POST'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const b=await req.json();
    const title=String(b.title||'').trim();

    if(!title||!b.image_path){
     return respond(req,{
      error:'اسم التصنيف وصورة الغلاف مطلوبان'
     },400);
    }

    const max=await env.DB.prepare(
     'SELECT COALESCE(MAX(sort_order),0) AS n FROM categories'
    ).first();

    const slug='custom-'+crypto.randomUUID();

    const result=await env.DB.prepare(
     'INSERT INTO categories (name,slug,image_url,sort_order,is_active) VALUES (?,?,?,?,1)'
    ).bind(
     title.slice(0,100),
     slug,
     b.image_path,
     Number(max?.n||0)+1
    ).run();

    return respond(req,{
     success:true,
     id:result.meta?.last_row_id
    });
   }

   if(p.startsWith('/api/admin/category/')&&req.method==='PUT'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const cid=decodeURIComponent(p.split('/').pop());
    const b=await req.json();

    if(!/^\d+$/.test(cid)){
     return respond(req,{error:'التصنيف غير موجود'},404);
    }

    if(!String(b.title||'').trim()){
     return respond(req,{error:'اسم التصنيف مطلوب'},400);
    }

    const old=await env.DB.prepare(
     'SELECT image_url FROM categories WHERE id=?'
    ).bind(Number(cid)).first();

    if(!old){
     return respond(req,{error:'التصنيف غير موجود'},404);
    }

    await env.DB.prepare(
     'UPDATE categories SET name=?,image_url=COALESCE(?,image_url) WHERE id=?'
    ).bind(
     String(b.title).trim().slice(0,100),
     b.image_path||null,
     Number(cid)
    ).run();

    if(
     b.image_path&&
     old.image_url&&
     old.image_url!==b.image_path&&
     /^images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(old.image_url)
    ){
     await env.MEDIA.delete(old.image_url);
    }

    return respond(req,{success:true});
   }

   if(p.startsWith('/api/admin/category/')&&req.method==='DELETE'){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const cid=decodeURIComponent(p.split('/').pop());

    if(!/^\d+$/.test(cid)){
     return respond(req,{error:'التصنيف غير موجود'},404);
    }

    const old=await env.DB.prepare(
     'SELECT id,image_url FROM categories WHERE id=?'
    ).bind(Number(cid)).first();

    if(!old){
     return respond(req,{error:'التصنيف غير موجود'},404);
    }

    const used=await env.DB.prepare(
     'SELECT COUNT(*) AS n FROM stories WHERE category_id=?'
    ).bind(Number(cid)).first();

    if(Number(used?.n||0)>0){
     return respond(req,{
      error:'لا يمكن حذف تصنيف يحتوي على قصص. انقلي القصص إلى تصنيف آخر أو احذفيها أولاً.'
     },409);
    }

    await env.DB.prepare(
     'UPDATE categories SET is_active=0 WHERE id=?'
    ).bind(Number(cid)).run();

    if(
     old.image_url&&
     /^images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(old.image_url)
    ){
     await env.MEDIA.delete(old.image_url);
    }

    return respond(req,{success:true});
   }

   if(p==='/api/admin/story'&&req.method==='POST'){
    if(!adminOk(req,env))return respond(req,{error:'Unauthorized'},401);
    await ensureCategories(env);
    const b=await req.json();
    if(!String(b.title||'').trim()||!b.audio_path||!b.image_path)return respond(req,{error:'العنوان وملف MP3 والصورة مطلوبة'},400);
    let categoryIds;
    try{categoryIds=await categoryIdsFromBody(env,b);}catch(e){return respond(req,{error:e.message},400);}
    const result=await env.DB.prepare('INSERT INTO stories (title,description,category_id,audio_url,image_url,wide_image_url,total_episodes,status,character_one_name,character_two_name,character_three_name,character_one_image_url,character_two_image_url,character_three_image_url,views,is_published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1)').bind(
     String(b.title).trim().slice(0,180),String(b.description||'').slice(0,5000),categoryIds[0],b.audio_path,b.image_path,b.wide_image_path||null,Math.max(1,Math.min(999,Math.floor(Number(b.total_episodes)||1))),b.status==='completed'?'completed':'ongoing',String(b.character_one_name||'البطلة').slice(0,100),String(b.character_two_name||'البطل').slice(0,100),String(b.character_three_name||'شخصية محورية').slice(0,100),b.character_one_image_path||null,b.character_two_image_path||null,b.character_three_image_path||null
    ).run();
    const storyId=Number(result.meta?.last_row_id);
    await saveStoryCategories(env,storyId,categoryIds);
    return respond(req,{success:true,id:storyId});
   }

   if(
    p.startsWith('/api/admin/story/')&&
    ['PUT','DELETE'].includes(req.method)
   ){
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const sid=decodeURIComponent(p.split('/').pop());

    if(!/^\d+$/.test(sid)){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    const old=await env.DB.prepare(
     'SELECT * FROM stories WHERE id=?'
    ).bind(Number(sid)).first();

    if(!old){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    if(req.method==='DELETE'){
     const parts=await env.DB.prepare(
      'SELECT audio_url,image_url FROM story_parts WHERE story_id=?'
     ).bind(Number(sid)).all();

     for(const part of (parts.results||[])){
      for(const key of [part.audio_url,part.image_url]){
       if(
        key&&
        /^(audio\/[0-9a-f-]+\.mp3|images\/[0-9a-f-]+\.(jpg|png|webp))$/i.test(key)
       ){
        await env.MEDIA.delete(key);
       }
      }
     }

     await env.DB.prepare(
      'DELETE FROM story_parts WHERE story_id=?'
     ).bind(Number(sid)).run();

     await env.DB.prepare(
      'DELETE FROM stories WHERE id=?'
     ).bind(Number(sid)).run();

     for(const key of [
      old.audio_url,
      old.image_url,
      old.wide_image_url
     ]){
      if(
       key&&
       /^(audio|images)\/[0-9a-f-]+\.(mp3|jpg|png|webp)$/i.test(key)
      ){
       await env.MEDIA.delete(key);
      }
     }

     return respond(req,{success:true});
    }

    await ensureCategories(env);
    const b=await req.json();
    const title=String(b.title||old.title).trim();
    let categoryIds;
    try{categoryIds=await categoryIdsFromBody(env,(b.category_ids||b.category_id)?b:{...b,category_id:old.category_id});}
    catch(e){return respond(req,{error:e.message},400);}
    const category=categoryIds[0];
    if(!title)return respond(req,{error:'العنوان مطلوب'},400);

    const requestedTotal = Number(b.total_episodes);
    if (!Number.isInteger(requestedTotal) || requestedTotal < 1 || requestedTotal > 999) {
     return respond(req,{error:'عدد الحلقات يجب أن يكون عددًا صحيحًا من 1 إلى 999'},400);
    }

    await env.DB.prepare(
     'UPDATE stories SET title=?,description=?,category_id=?,audio_url=?,image_url=?,wide_image_url=?,total_episodes=?,status=?,character_one_name=?,character_two_name=?,character_three_name=?,character_one_image_url=?,character_two_image_url=?,character_three_image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(
     title.slice(0,180),
     String(b.description??old.description??'').slice(0,5000),
     Number(category),
     b.audio_path||old.audio_url,
     b.image_path||old.image_url,
     b.wide_image_path||old.wide_image_url||null,
     requestedTotal,
     b.status==='completed'?'completed':(b.status==='ongoing'?'ongoing':(old.status||'ongoing')),
     String(b.character_one_name??old.character_one_name??'البطلة').slice(0,100),
     String(b.character_two_name??old.character_two_name??'البطل').slice(0,100),
     String(b.character_three_name??old.character_three_name??'شخصية محورية').slice(0,100),
     b.character_one_image_path||old.character_one_image_url||null,
     b.character_two_image_path||old.character_two_image_url||null,
     b.character_three_image_path||old.character_three_image_url||null,
     Number(sid)
    ).run();
    await saveStoryCategories(env,Number(sid),categoryIds);

    for(const key of [
     b.audio_path&&b.audio_path!==old.audio_url?old.audio_url:null,
     b.image_path&&b.image_path!==old.image_url?old.image_url:null,
     b.wide_image_path&&b.wide_image_path!==old.wide_image_url?old.wide_image_url:null,
      b.character_one_image_path&&b.character_one_image_path!==old.character_one_image_url?old.character_one_image_url:null,
      b.character_two_image_path&&b.character_two_image_path!==old.character_two_image_url?old.character_two_image_url:null,
      b.character_three_image_path&&b.character_three_image_path!==old.character_three_image_url?old.character_three_image_url:null
    ]){
     if(key)await env.MEDIA.delete(key);
    }

    return respond(req,{success:true});
   }

   if(p.startsWith('/api/view/')&&req.method==='POST'){
    const sid=decodeURIComponent(p.split('/').pop());

    if(!/^\d+$/.test(sid)){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    const r=await env.DB.prepare(
     'UPDATE stories SET views=views+1 WHERE id=? AND is_published=1 RETURNING views'
    ).bind(Number(sid)).first();

    if(!r){
     return respond(req,{error:'القصة غير موجودة'},404);
    }

    return respond(req,{success:true,views:r.views});
   }

   return respond(req,{error:'Not found'},404);

  }catch(e){
   return respond(req,{error:e?.message||'Server error'},500);
  }
 }
};
