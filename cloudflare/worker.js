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
 await env.DB.batch(
  CATEGORIES.map(c=>stmt.bind(c.title,c.slug,c.sort_order))
 );
}

async function catalog(env){
 await ensureCategories(env);

 const [cats,stories,links]=await Promise.all([
  env.DB.prepare(
   'SELECT id,name AS title,slug,NULL AS emoji,sort_order,image_url AS image_path FROM categories WHERE is_active=1 ORDER BY sort_order,id'
  ).all(),

  env.DB.prepare(
   'SELECT id,title,description,category_id,audio_url AS audio_path,image_url AS image_path,wide_image_url AS wide_image_path,update_image_url AS update_image_path,update_title,planned_parts_count,story_status,views,created_at FROM stories WHERE is_published=1 ORDER BY created_at DESC'
  ).all(),
  env.DB.prepare('SELECT story_id,category_id FROM story_categories').all()
 ]);

 return {
  categories:(cats.results||[]).map(c=>({
   ...c,
   id:String(c.id),
   emoji:CATEGORIES.find(x=>x.slug===c.slug)?.emoji||'📚'
  })),

  stories:(stories.results||[]).map(s=>({
   ...s,
   id:String(s.id),
   category_id:String(s.category_id),
   category_ids:[...new Set([String(s.category_id),...(links.results||[]).filter(x=>String(x.story_id)===String(s.id)).map(x=>String(x.category_id))])]
  }))
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

   if(p==='/api/latest-updates'&&req.method==='GET'){
    const [stories,parts]=await Promise.all([
     env.DB.prepare(`SELECT s.id AS story_id,s.title AS story_title,s.update_title AS update_title,s.title AS item_title,'story' AS item_type,s.update_image_url AS update_image_path,s.image_url AS story_image_path,s.created_at AS published_at,s.planned_parts_count,s.story_status,0 AS part_number,(SELECT COUNT(*)+1 FROM story_parts px WHERE px.story_id=s.id AND px.is_published=1) AS published_parts_count FROM stories s WHERE s.is_published=1 ORDER BY s.created_at DESC LIMIT 30`).all(),
     env.DB.prepare(`SELECT s.id AS story_id,s.title AS story_title,s.update_title AS update_title,p.title AS item_title,'part' AS item_type,p.update_image_url AS update_image_path,p.image_url AS part_image_path,s.image_url AS story_image_path,p.created_at AS published_at,s.planned_parts_count,s.story_status,p.part_number,(SELECT COUNT(*)+1 FROM story_parts px WHERE px.story_id=s.id AND px.is_published=1) AS published_parts_count FROM story_parts p JOIN stories s ON s.id=p.story_id WHERE s.is_published=1 AND p.is_published=1 ORDER BY p.created_at DESC,p.id DESC LIMIT 50`).all()
    ]);
    const rows=[...(stories.results||[]),...(parts.results||[])].sort((a,b)=>String(b.published_at||'').localeCompare(String(a.published_at||''))).slice(0,30);
    return respond(req,{updates:rows.map(x=>({...x,story_id:String(x.story_id),part_number:Number(x.part_number||0)+(x.item_type==='part'?1:0),update_image_path:x.update_image_path||x.part_image_path||x.story_image_path||null}))});
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
     'SELECT id,story_id,title,audio_url AS audio_path,image_url AS image_path,update_image_url AS update_image_path,created_at,part_number AS sort_order FROM story_parts WHERE story_id=? AND is_published=1 ORDER BY part_number,id'
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
     'SELECT id,story_id,title,audio_url AS audio_path,image_url AS image_path,update_image_url AS update_image_path,created_at,part_number AS sort_order FROM story_parts WHERE story_id=? ORDER BY part_number,id'
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
     'INSERT INTO story_parts(story_id,part_number,title,audio_url,image_url,update_image_url) VALUES(?,?,?,?,?,?)'
    ).bind(
     sid,
     Number(max?.n||0)+1,
     String(b.title).trim().slice(0,180),
     b.audio_path,
     b.image_path||null,
     b.update_image_path||null
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

     for(const key of [old.audio_url,old.image_url,old.update_image_url]){
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
     'UPDATE story_parts SET title=?,audio_url=?,image_url=?,update_image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(
     String(b.title).trim().slice(0,180),
     b.audio_path||old.audio_url,
     b.image_path||old.image_url||null,
     b.update_image_path||old.update_image_url||null,
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
     ['story','story-wide','category','part-image','update-image'].includes(kind)&&
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

    const [cats,stories,links]=await Promise.all([
     env.DB.prepare(
      'SELECT id,name AS title,slug,NULL AS emoji,sort_order,image_url AS image_path FROM categories WHERE is_active=1 ORDER BY sort_order,id'
     ).all(),

     env.DB.prepare(
      'SELECT id,title,update_title,description,category_id,audio_url AS audio_path,image_url AS image_path,wide_image_url AS wide_image_path,update_image_url AS update_image_path,planned_parts_count,story_status,views,created_at FROM stories ORDER BY created_at DESC,id DESC'
     ).all(),
     env.DB.prepare('SELECT story_id,category_id FROM story_categories').all()
    ]);

    return respond(req,{
     categories:(cats.results||[]).map(c=>({
      ...c,
      id:String(c.id),
      emoji:CATEGORIES.find(x=>x.slug===c.slug)?.emoji||'📚'
     })),

     stories:(stories.results||[]).map(s=>({
      ...s,
      id:String(s.id),
      category_id:String(s.category_id),
      category_ids:[...new Set([String(s.category_id),...(links.results||[]).filter(x=>String(x.story_id)===String(s.id)).map(x=>String(x.category_id))])]
     }))
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

    const newStoryId=result.meta?.last_row_id;
    const selectedIds=[...new Set((Array.isArray(b.category_ids)?b.category_ids:[b.category_id]).map(Number).filter(Number.isInteger))];
    for(const categoryId of selectedIds){
     const valid=await env.DB.prepare('SELECT id FROM categories WHERE id=? AND is_active=1').bind(categoryId).first();
     if(valid) await env.DB.prepare('INSERT OR IGNORE INTO story_categories (story_id,category_id) VALUES (?,?)').bind(newStoryId,categoryId).run();
    }
    return respond(req,{success:true,id:newStoryId});
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
    if(!adminOk(req,env)){
     return respond(req,{error:'Unauthorized'},401);
    }

    const b=await req.json();

    if(
     !String(b.title||'').trim()||
     !b.audio_path||
     !b.image_path||
     !b.category_id
    ){
     return respond(req,{
      error:'العنوان والتصنيف وملف MP3 والصورة مطلوبة'
     },400);
    }

    if(!/^\d+$/.test(String(b.category_id))){
     return respond(req,{error:'التصنيف غير موجود'},400);
    }

    const c=await env.DB.prepare(
     'SELECT id FROM categories WHERE id=? AND is_active=1'
    ).bind(Number(b.category_id)).first();

    if(!c){
     return respond(req,{error:'التصنيف غير موجود'},400);
    }

    const result=await env.DB.prepare(
     'INSERT INTO stories (title,description,category_id,audio_url,image_url,wide_image_url,update_image_url,update_title,planned_parts_count,story_status,views,is_published) VALUES (?,?,?,?,?,?,?,?,?,?,0,1)'
    ).bind(
     String(b.title).trim().slice(0,180),
     String(b.description||'').slice(0,5000),
     Number(b.category_id),
     b.audio_path,
     b.image_path,
     b.wide_image_path||null,
     b.update_image_path||null,
     String(b.update_title||'').trim().slice(0,120)||null,
     b.planned_parts_count&&Number(b.planned_parts_count)>0?Math.min(500,Math.floor(Number(b.planned_parts_count))):null,
     ['ongoing','completed','paused'].includes(b.story_status)?b.story_status:'ongoing'
    ).run();

    return respond(req,{
     success:true,
     id:result.meta?.last_row_id
    });
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
      'SELECT audio_url,image_url,update_image_url FROM story_parts WHERE story_id=?'
     ).bind(Number(sid)).all();

     for(const part of (parts.results||[])){
      for(const key of [part.audio_url,part.image_url,part.update_image_url]){
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
      old.wide_image_url,
      old.update_image_url
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

    const b=await req.json();
    const title=String(b.title||old.title).trim();
    const category=b.category_id||old.category_id;

    if(!/^\d+$/.test(String(category))){
     return respond(req,{error:'التصنيف غير موجود'},400);
    }

    if(!title){
     return respond(req,{error:'العنوان مطلوب'},400);
    }

    await env.DB.prepare(
     'UPDATE stories SET title=?,description=?,category_id=?,audio_url=?,image_url=?,wide_image_url=?,update_image_url=?,update_title=?,planned_parts_count=?,story_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(
     title.slice(0,180),
     String(b.description??old.description??'').slice(0,5000),
     Number(category),
     b.audio_path||old.audio_url,
     b.image_path||old.image_url,
     b.wide_image_path||old.wide_image_url||null,
     b.update_image_path||old.update_image_url||null,
     b.update_title!==undefined?(String(b.update_title||'').trim().slice(0,120)||null):old.update_title,
     b.planned_parts_count!==undefined?(Number(b.planned_parts_count)>0?Math.min(500,Math.floor(Number(b.planned_parts_count))):null):old.planned_parts_count,
     ['ongoing','completed','paused'].includes(b.story_status)?b.story_status:(old.story_status||'ongoing'),
     Number(sid)
    ).run();

    if(Array.isArray(b.category_ids)){
     await env.DB.prepare('DELETE FROM story_categories WHERE story_id=?').bind(Number(sid)).run();
     const selectedIds=[...new Set(b.category_ids.map(Number).filter(Number.isInteger))];
     for(const categoryId of selectedIds){
      const valid=await env.DB.prepare('SELECT id FROM categories WHERE id=? AND is_active=1').bind(categoryId).first();
      if(valid) await env.DB.prepare('INSERT OR IGNORE INTO story_categories (story_id,category_id) VALUES (?,?)').bind(Number(sid),categoryId).run();
     }
    }

    for(const key of [
     b.audio_path&&b.audio_path!==old.audio_url?old.audio_url:null,
     b.image_path&&b.image_path!==old.image_url?old.image_url:null,
     b.wide_image_path&&b.wide_image_path!==old.wide_image_url?old.wide_image_url:null,
     b.update_image_path&&b.update_image_path!==old.update_image_url?old.update_image_url:null
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
