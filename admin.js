let API = window.API_BASE || localStorage.getItem('qisas_api_base') || '';
let ADMIN_EMAIL = sessionStorage.getItem('qisas_admin_email') || '';
let ADMIN_PASSWORD = sessionStorage.getItem('qisas_admin_password') || '';

let DATA = { categories: [], stories: [] };

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

function api(path) {
  if (!API) {
    throw Error('أدخلي رابط Cloudflare Worker أولاً');
  }
  return API.replace(/\/$/, '') + path;
}

function setMsg(id, message, error = false) {
  $(id).textContent = message;
  $(id).style.color = error ? '#ff9292' : '#a8d8b0';
}

async function call(path, options = {}) {
  const response = await fetch(api(path), {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Email': ADMIN_EMAIL,
      'X-Admin-Password': ADMIN_PASSWORD
    }
  });

  const result = await response.json().catch(() => ({
    error: 'استجابة غير مفهومة من الخادم'
  }));

  if (!response.ok) {
    throw Error(result.error || 'حدث خطأ');
  }

  return result;
}

// تسجيل الدخول
$('loginBtn').onclick = login;
$('email').value = ADMIN_EMAIL;
$('password').value = ADMIN_PASSWORD;

if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  login();
}

$('password').addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});

async function login() {
  ADMIN_EMAIL = $('email').value.trim();
  ADMIN_PASSWORD = $('password').value;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    setMsg('loginMsg', 'أدخلي البريد الإلكتروني وكلمة المرور.', true);
    return;
  }

  sessionStorage.setItem('qisas_admin_email', ADMIN_EMAIL);
  sessionStorage.setItem('qisas_admin_password', ADMIN_PASSWORD);

  $('loginBtn').disabled = true;

  try {
    await call('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      })
    });

    $('login').hidden = true;
    $('dashboard').hidden = false;
    await refresh();
  } catch (error) {
    setMsg(
      'loginMsg',
      error.message +
      ' تأكدي من إعداد ADMIN_EMAIL وADMIN_PASSWORD في Cloudflare ومن رابط Worker.',
      true
    );
  } finally {
    $('loginBtn').disabled = false;
  }
}

// تحميل القصص والتصنيفات
async function refresh() {
  DATA = await call('/api/admin/catalog');

  renderCategories();
  renderStories();

  $('category').innerHTML = DATA.categories
    .map(category =>
      `<option value="${esc(category.id)}">${esc(category.title)}</option>`
    )
    .join('');
  const previousStory=$('partsStorySelect').value;
  $('partsStorySelect').innerHTML='<option value="">اختاري قصة</option>'+DATA.stories.map(story=>`<option value="${esc(story.id)}">${esc(story.title)}</option>`).join('');
  if(previousStory && DATA.stories.some(story=>String(story.id)===previousStory)) $('partsStorySelect').value=previousStory;
  await loadParts();
}

function media(path) {
  return path ? api('/media/' + path) : '';
}

// عرض التصنيفات وإجراءات تعديلها
function renderCategories() {
  $('categoryAdmin').innerHTML = DATA.categories.map(category => `
    <div class="cat-edit">
      <img
        src="${esc(media(category.image_path))}"
        alt=""
        loading="lazy"
        decoding="async"
        onerror="this.style.display='none'"
      >

      <div class="cat-fields">
        <label for="name-${esc(category.id)}">اسم التصنيف</label>
        <input
          id="name-${esc(category.id)}"
          value="${esc(category.title)}"
          aria-label="اسم التصنيف"
        >

        <label for="img-${esc(category.id)}">تغيير صورة الغلاف</label>
        <input
          id="img-${esc(category.id)}"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="صورة التصنيف"
        >

        <div class="cat-actions">
          <button
            class="secondary"
            onclick="saveCategory('${esc(category.id)}')"
          >حفظ التصنيف</button>

          <button
            class="danger"
            onclick="deleteCategory('${esc(category.id)}')"
          >حذف التصنيف</button>
        </div>
      </div>
    </div>
  `).join('');

  if (!DATA.categories.length) {
    $('categoryAdmin').innerHTML =
      '<p class="muted">لا توجد تصنيفات بعد.</p>';
  }
}

// رفع الملفات إلى الخادم
async function upload(file, kind) {
  if (!file) return null;

  const result = await call(
    '/api/upload-url?kind=' + encodeURIComponent(kind) +
    '&filename=' + encodeURIComponent(file.name) +
    '&type=' + encodeURIComponent(file.type || 'application/octet-stream'),
    { method: 'POST' }
  );

  const response = await fetch(api('/api/upload/' + result.key), {
    method: 'PUT',
    headers: {
      'X-Admin-Email': ADMIN_EMAIL,
      'X-Admin-Password': ADMIN_PASSWORD,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(error.error || 'فشل رفع الملف');
  }

  return result.key;
}

// التحقق من أن صورة الغلاف مربعة
async function validateSquareImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw Error('اختاري ملف صورة صالحًا');
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });

      image.onerror = () => reject(
        Error('تعذر قراءة الصورة المختارة')
      );

      image.src = objectUrl;
    });

    if (Math.abs(dimensions.width - dimensions.height) > 2) {
      throw Error('يجب أن تكون صورة الغلاف مربعة بنسبة 1:1');
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// إضافة تصنيف جديد
$('categoryForm').onsubmit = async event => {
  event.preventDefault();

  const title = $('newCategoryName').value.trim();
  const file = $('newCategoryImage').files[0];
  const submitButton = $('categoryForm').querySelector(
    'button[type="submit"]'
  );

  submitButton.disabled = true;

  try {
    if (!title) throw Error('اكتبي اسم التصنيف');
    if (!file) throw Error('اختاري صورة غلاف مربعة 1:1');

    await validateSquareImage(file);

    const image_path = await upload(file, 'category');

    await call('/api/admin/category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, image_path })
    });

    $('newCategoryName').value = '';
    $('newCategoryImage').value = '';

    await refresh();

    setMsg(
      'categoryFormMsg',
      'تمت إضافة التصنيف بنجاح.'
    );
  } catch (error) {
    setMsg('categoryFormMsg', error.message, true);
  } finally {
    submitButton.disabled = false;
  }
};

// تعديل اسم التصنيف أو صورة غلافه
window.saveCategory = async function (id) {
  try {
    const title = $('name-' + id).value.trim();

    if (!title) {
      throw Error('اكتبي اسم التصنيف');
    }

    const file = $('img-' + id).files[0];
    let image_path = null;

    if (file) {
      await validateSquareImage(file);
      image_path = await upload(file, 'category');
    }

    await call('/api/admin/category/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, image_path })
    });

    await refresh();
    alert('تم حفظ التصنيف بنجاح.');
  } catch (error) {
    alert(error.message);
  }
};

// حذف تصنيف
window.deleteCategory = async function (id) {
  const category = DATA.categories.find(
    item => String(item.id) === String(id)
  );

  if (!category) return;

  const confirmed = confirm(
    `هل تريد حذف التصنيف «${category.title}»؟ لا يمكن حذف تصنيف يحتوي على قصص.`
  );

  if (!confirmed) return;

  try {
    await call('/api/admin/category/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    await refresh();
    alert('تم حذف التصنيف.');
  } catch (error) {
    alert(error.message);
  }
};

// عرض القصص المنشورة
function renderStories() {
  $('storyAdmin').innerHTML = DATA.stories.length
    ? DATA.stories.map(story => {
        const category = DATA.categories.find(
          item => String(item.id) === String(story.category_id)
        );

        return `
          <div class="story-admin">
            <img
              src="${esc(media(story.image_path))}"
              alt=""
              loading="lazy"
              decoding="async"
            >

            <div>
              <h3>${esc(story.title)}</h3>
              <p class="muted">
                ${esc(category?.title || '')}
                · ${(Number(story.views) || 0).toLocaleString('ar')}
                مشاهدة
              </p>

              <div class="cat-actions">
                <button
                  class="secondary"
                  onclick="editStory('${esc(story.id)}')"
                >تعديل</button>

                <button
                  class="danger"
                  onclick="deleteStory('${esc(story.id)}')"
                >حذف</button>
              </div>
            </div>
          </div>
        `;
      }).join('')
    : '<p class="muted">لا توجد قصص منشورة بعد.</p>';
}

// إضافة قصة أو حفظ تعديلات قصة موجودة
$('storyForm').onsubmit = async event => {
  event.preventDefault();

  $('publish').disabled = true;

  try {
    const id = $('storyId').value;
    const audio = $('audio').files[0];
    const image = $('image').files[0];
    const wideImage = $('wideImage').files[0];

    if (!id && (!audio || !image)) {
      throw Error('ارفعي ملف MP3 والصورة المربعة 1:1');
    }

    const payload = {
      title: $('title').value.trim(),
      category_id: $('category').value,
      description: $('description').value.trim()
    };

    if (!payload.title) {
      throw Error('اكتبي عنوان القصة');
    }

    if (audio) {
      payload.audio_path = await upload(audio, 'audio');
    }

    if (image) {
      await validateSquareImage(image);
      payload.image_path = await upload(image, 'story');
    }

    if (wideImage) {
      payload.wide_image_path = await upload(wideImage, 'story-wide');
    }

    await call(
      id ? '/api/admin/story/' + encodeURIComponent(id)
         : '/api/admin/story',
      {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    setMsg(
      'formMsg',
      id ? 'تم حفظ التعديلات.' : 'تم نشر القصة بنجاح.'
    );

    resetForm();
    await refresh();
  } catch (error) {
    setMsg('formMsg', error.message, true);
  } finally {
    $('publish').disabled = false;
  }
};

// إعادة ضبط نموذج القصة
function resetForm() {
  $('storyForm').reset();
  $('storyId').value = '';
  $('audio').required = true;
  $('image').required = true;
  $('wideImageCurrent').hidden = true;
  $('publish').textContent = 'نشر القصة';
  $('cancelEdit').hidden = true;
}

// فتح قصة للتعديل
window.editStory = function (id) {
  const story = DATA.stories.find(
    item => String(item.id) === String(id)
  );

  if (!story) return;

  $('storyId').value = story.id;
  $('title').value = story.title;
  $('category').value = story.category_id;
  $('description').value = story.description || '';

  $('audio').required = false;
  $('image').required = false;

  $('wideImageCurrent').hidden = !story.wide_image_path;
  $('publish').textContent = 'حفظ التعديلات';
  $('cancelEdit').hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$('cancelEdit').onclick = resetForm;

// حذف قصة
window.deleteStory = async function (id) {
  if (!confirm('هل تريد حذف القصة نهائيًا؟')) return;

  try {
    await call('/api/admin/story/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    await refresh();
  } catch (error) {
    alert(error.message);
  }
};

// إدارة أجزاء القصة في Cloudflare D1، مع ملفات الصوت في R2.
async function loadParts(){
  const sid=$('partsStorySelect').value; $('partsAdmin').innerHTML=''; $('partForm').reset(); $('partId').value=''; $('cancelPart').hidden=true; $('savePart').textContent='إضافة الجزء';
  if(!sid){$('partsAdmin').innerHTML='<p class="muted">اختاري قصة لعرض أجزائها.</p>';return;}
  try{const data=await call('/api/admin/story/'+encodeURIComponent(sid)+'/parts');const parts=data.parts||[];
    $('partsAdmin').innerHTML=parts.length?parts.map(part=>`<div class="part-admin"><div><strong>${esc(part.title)}</strong><p class="muted">الجزء ${esc(part.sort_order)}</p></div><div class="cat-actions"><button class="secondary" type="button" onclick="editPart('${esc(part.id)}')">تعديل</button><button class="danger" type="button" onclick="deletePart('${esc(part.id)}')">حذف</button></div></div>`).join(''):'<p class="muted">لا توجد أجزاء. ستعمل القصة بالملف الصوتي الأصلي إلى أن تضيفي أول جزء.</p>';
    window.CURRENT_PARTS=parts;
  }catch(e){$('partsAdmin').textContent=e.message;}
}
$('partsStorySelect').addEventListener('change',loadParts);
$('partForm').addEventListener('submit',async e=>{e.preventDefault();const sid=$('partsStorySelect').value;const id=$('partId').value;const title=$('partTitle').value.trim();const file=$('partAudio').files[0];try{if(!sid)throw Error('اختاري القصة أولاً');if(!title)throw Error('اكتبي عنوان الجزء');if(!id&&!file)throw Error('اختاري ملف MP3 للجزء');const payload={title};if(file){if(!/\.mp3$/i.test(file.name))throw Error('اختاري ملف MP3');payload.audio_path=await upload(file,'audio');}await call(id?'/api/admin/part/'+encodeURIComponent(id):'/api/admin/story/'+encodeURIComponent(sid)+'/parts',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});setMsg('partFormMsg',id?'تم تحديث الجزء.':'تمت إضافة الجزء.');await loadParts();}catch(err){setMsg('partFormMsg',err.message,true);}});
$('cancelPart').onclick=()=>{$('partForm').reset();$('partId').value='';$('cancelPart').hidden=true;$('savePart').textContent='إضافة الجزء';};
window.editPart=function(id){const part=(window.CURRENT_PARTS||[]).find(x=>String(x.id)===String(id));if(!part)return;$('partId').value=part.id;$('partTitle').value=part.title;$('partAudio').value='';$('cancelPart').hidden=false;$('savePart').textContent='حفظ التعديلات';window.scrollTo({top:$('partsPanel').offsetTop,behavior:'smooth'});};
window.deletePart=async function(id){if(!confirm('هل تريدين حذف هذا الجزء؟'))return;try{await call('/api/admin/part/'+encodeURIComponent(id),{method:'DELETE'});await loadParts();}catch(e){alert(e.message);}};

// تسجيل الخروج
$('logout').onclick = () => {
  ADMIN_EMAIL = '';
  ADMIN_PASSWORD = '';

  sessionStorage.removeItem('qisas_admin_email');
  sessionStorage.removeItem('qisas_admin_password');

  $('dashboard').hidden = true;
  $('login').hidden = false;
  $('email').value = '';
  $('password').value = '';
};
