let API = window.API_BASE || localStorage.getItem('qisas_api_base') || '';
let ADMIN_EMAIL = sessionStorage.getItem('qisas_admin_email') || '';
let ADMIN_PASSWORD = sessionStorage.getItem('qisas_admin_password') || '';

let DATA = { categories: [], stories: [] };
window.CURRENT_PARTS = [];

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
  if (!API) throw Error('أدخلي رابط Cloudflare Worker أولاً');
  return API.replace(/\/$/, '') + path;
}

function setMsg(id, message, error = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.style.color = error ? '#ff9292' : '#a8d8b0';
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

  if (!response.ok) throw Error(result.error || 'حدث خطأ');
  return result;
}

// تسجيل الدخول
$('loginBtn').onclick = login;
$('email').value = ADMIN_EMAIL;
$('password').value = ADMIN_PASSWORD;

if (ADMIN_EMAIL && ADMIN_PASSWORD) login();


async function loadAdminComments() {
  const root=$('commentsAdminList'); if(!root)return;
  root.innerHTML='<p class="muted">جارٍ تحميل التعليقات…</p>';
  try {
    const data=await call('/api/admin/comments');
    const items=Array.isArray(data.comments)?data.comments:[];
    $('commentsAdminMsg').textContent=`عدد التعليقات والردود: ${items.length.toLocaleString('ar')}`;
    if(!items.length){root.innerHTML='<p class="muted">لا توجد تعليقات حتى الآن.</p>';return;}
    root.innerHTML=items.map(c=>`<article class="comments-admin-item"><div><strong>${esc(c.display_name||'زائر')}</strong><span class="muted">${esc(c.story_title||'قصة محذوفة')} · ${esc(c.created_at||'')}</span><p>${esc(c.parent_id?'↳ رد: ':'')}${esc(c.content)}</p><small class="muted">الإعجابات: ${Number(c.likes_count)||0}</small></div><button class="danger" type="button" data-admin-comment-delete="${esc(c.id)}">حذف التعليق</button></article>`).join('');
  } catch(e) { root.innerHTML=`<p class="error">${esc(e.message||'تعذر تحميل التعليقات')}</p>`; }
}
$('refreshCommentsAdmin')?.addEventListener('click',loadAdminComments);
$('commentsAdminList')?.addEventListener('click',async event=>{
 const button=event.target.closest('[data-admin-comment-delete]'); if(!button)return;
 if(!confirm('هل تريد حذف هذا التعليق؟ إذا كان تعليقًا رئيسيًا فستُحذف ردوده أيضًا.'))return;
 try { await call('/api/admin/comment/'+encodeURIComponent(button.dataset.adminCommentDelete),{method:'DELETE'}); await loadAdminComments(); }
 catch(e){$('commentsAdminMsg').textContent=e.message||'تعذر حذف التعليق';}
});

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

    sessionStorage.setItem('qisas_admin_email', ADMIN_EMAIL);
    sessionStorage.setItem('qisas_admin_password', ADMIN_PASSWORD);

    $('login').hidden = true;
    $('dashboard').hidden = false;
    await refresh();
    await loadAdminComments();
  } catch (error) {
    setMsg(
      'loginMsg',
      error.message + ' تأكدي من بيانات الإدارة ورابط Worker.',
      true
    );
  } finally {
    $('loginBtn').disabled = false;
  }
}

// تحميل البيانات
async function refresh() {
  DATA = await call('/api/admin/catalog');

  renderCategories();
  renderStories();

  $('category').innerHTML = DATA.categories.map(category =>
    `<option value="${esc(category.id)}">${esc(category.title)}</option>`
  ).join('');

  const previousStory = $('partsStorySelect').value;

  $('partsStorySelect').innerHTML =
    '<option value="">اختاري قصة</option>' +
    DATA.stories.map(story =>
      `<option value="${esc(story.id)}">${esc(story.title)}</option>`
    ).join('');

  if (previousStory &&
      DATA.stories.some(story => String(story.id) === previousStory)) {
    $('partsStorySelect').value = previousStory;
  }

  await loadParts();
}

function media(path) {
  return path ? api('/media/' + path) : '';
}

// التصنيفات
function renderCategories() {
  $('categoryAdmin').innerHTML = DATA.categories.map(category => `
    <div class="cat-edit">
      <img src="${esc(media(category.image_path))}"
           alt="" loading="lazy"
           onerror="this.style.display='none'">

      <div class="cat-fields">
        <label for="name-${esc(category.id)}">اسم التصنيف</label>
        <input id="name-${esc(category.id)}"
               value="${esc(category.title)}">

        <label for="img-${esc(category.id)}">تغيير صورة الغلاف</label>
        <input id="img-${esc(category.id)}" type="file"
               accept="image/jpeg,image/png,image/webp">

        <div class="cat-actions">
          <button class="secondary"
            onclick="saveCategory('${esc(category.id)}')">
            حفظ التصنيف
          </button>
          <button class="danger"
            onclick="deleteCategory('${esc(category.id)}')">
            حذف التصنيف
          </button>
        </div>
      </div>
    </div>
  `).join('');

  if (!DATA.categories.length) {
    $('categoryAdmin').innerHTML =
      '<p class="muted">لا توجد تصنيفات بعد.</p>';
  }
}

// رفع ملف إلى Worker ثم R2
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

// التحقق من نوع الملف وحجمه
function validateAudio(file) {
  if (!file) return;

  if (!/\.mp3$/i.test(file.name)) {
    throw Error('اختاري ملفًا بامتداد MP3.');
  }

  if (file.size > 100 * 1024 * 1024) {
    throw Error('حجم الملف أكبر من 100 ميغابايت.');
  }
}

async function validateSquareImage(file) {
  if (!file) return;

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw Error('اختاري صورة JPG أو PNG أو WebP.');
  }

  const url = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      image.onerror = () => reject(Error('تعذرت قراءة الصورة.'));
      image.src = url;
    });

    if (Math.abs(dimensions.width - dimensions.height) > 2) {
      throw Error('يجب أن تكون الصورة مربعة بنسبة 1:1.');
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function validatePortraitImage(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw Error('اختاري صورة JPG أو PNG أو WebP.');
  }
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(Error('تعذرت قراءة الصورة.'));
      image.src = url;
    });
    const ratio = dimensions.width / dimensions.height;
    if (Math.abs(ratio - 9 / 16) > 0.04) {
      throw Error('صورة بطاقة التحديث يجب أن تكون عمودية بنسبة 9:16.');
    }
  } finally { URL.revokeObjectURL(url); }
}

// إضافة تصنيف
$('categoryForm').onsubmit = async event => {
  event.preventDefault();

  const button = $('categoryForm').querySelector('[type="submit"]');
  button.disabled = true;

  try {
    const title = $('newCategoryName').value.trim();
    const file = $('newCategoryImage').files[0];

    if (!title || !file) {
      throw Error('أدخلي اسم التصنيف واختاري صورة.');
    }

    await validateSquareImage(file);
    const image_path = await upload(file, 'category');

    await call('/api/admin/category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, image_path })
    });

    $('categoryForm').reset();
    await refresh();
    setMsg('categoryFormMsg', 'تمت إضافة التصنيف بنجاح.');
  } catch (error) {
    setMsg('categoryFormMsg', error.message, true);
  } finally {
    button.disabled = false;
  }
};

window.saveCategory = async function(id) {
  try {
    const title = $('name-' + id).value.trim();
    if (!title) throw Error('اكتبي اسم التصنيف.');

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
    alert('تم حفظ التصنيف.');
  } catch (error) {
    alert(error.message);
  }
};

window.deleteCategory = async function(id) {
  const category = DATA.categories.find(
    item => String(item.id) === String(id)
  );
  if (!category) return;

  if (!confirm(`هل تريد حذف التصنيف «${category.title}»؟`)) return;

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

// عرض القصص
function renderStories() {
  $('storyAdmin').innerHTML = DATA.stories.length
    ? DATA.stories.map(story => {
        const category = DATA.categories.find(
          item => String(item.id) === String(story.category_id)
        );

        return `
          <div class="story-admin">
            <img src="${esc(media(story.image_path))}"
                 alt="" loading="lazy">
            <div>
              <h3>${esc(story.title)}</h3>
              <p class="muted">
                ${esc(category?.title || '')}
                · ${(Number(story.views) || 0).toLocaleString('ar')} مشاهدة
              </p>
              <div class="cat-actions">
                <button class="secondary"
                  onclick="editStory('${esc(story.id)}')">تعديل</button>
                <button class="danger"
                  onclick="deleteStory('${esc(story.id)}')">حذف</button>
              </div>
            </div>
          </div>
        `;
      }).join('')
    : '<p class="muted">لا توجد قصص منشورة بعد.</p>';
}

// إضافة قصة أو تعديلها
$('storyForm').onsubmit = async event => {
  event.preventDefault();
  $('publish').disabled = true;

  try {
    const id = $('storyId').value;
    const audio = $('audio').files[0];
    const image = $('image').files[0];
    const wideImage = $('wideImage').files[0];
    const updateImage = $('updateImage').files[0];

    if (!id && (!audio || !image)) {
      throw Error('ارفعي ملف MP3 والصورة المربعة.');
    }

    const payload = {
      title: $('title').value.trim(),
      update_title: $('updateTitle').value.trim(),
      category_id: $('category').value,
      description: $('description').value.trim(),
      planned_parts_count: $('plannedPartsCount').value ? Number($('plannedPartsCount').value) : null,
      story_status: $('storyStatus').value || 'ongoing'
    };

    if (!payload.title) throw Error('اكتبي عنوان القصة.');

    if (audio) {
      validateAudio(audio);
      payload.audio_path = await upload(audio, 'audio');
    }

    if (image) {
      await validateSquareImage(image);
      payload.image_path = await upload(image, 'story');
    }

    if (wideImage) {
      payload.wide_image_path = await upload(wideImage, 'story-wide');
    }

    if (updateImage) {
      await validatePortraitImage(updateImage);
      payload.update_image_path = await upload(updateImage, 'update-image');
    }

    await call(
      id ? '/api/admin/story/' + encodeURIComponent(id) : '/api/admin/story',
      {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    setMsg('formMsg', id ? 'تم حفظ التعديلات.' : 'تم نشر القصة.');
    resetForm();
    await refresh();
  } catch (error) {
    setMsg('formMsg', error.message, true);
  } finally {
    $('publish').disabled = false;
  }
};

function resetForm() {
  $('storyForm').reset();
  $('storyId').value = '';
  $('audio').required = true;
  $('image').required = true;
  $('wideImageCurrent').hidden = true;
  $('updateImageCurrent').hidden = true;
  $('plannedPartsCount').value = '';
  $('storyStatus').value = 'ongoing';
  $('publish').textContent = 'نشر القصة';
  $('cancelEdit').hidden = true;
}

window.editStory = function(id) {
  const story = DATA.stories.find(item => String(item.id) === String(id));
  if (!story) return;

  $('storyId').value = story.id;
  $('title').value = story.title;
  $('updateTitle').value = story.update_title || '';
  $('category').value = story.category_id;
  $('description').value = story.description || '';
  $('plannedPartsCount').value = story.planned_parts_count || '';
  $('storyStatus').value = story.story_status || 'ongoing';

  $('audio').required = false;
  $('image').required = false;
  $('wideImageCurrent').hidden = !story.wide_image_path;
  $('updateImageCurrent').hidden = !story.update_image_path;
  if (story.update_image_path) $('updateImageCurrent').textContent = 'توجد صورة عمودية محفوظة؛ ارفعي صورة جديدة لاستبدالها.';
  $('publish').textContent = 'حفظ التعديلات';
  $('cancelEdit').hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$('cancelEdit').onclick = resetForm;

window.deleteStory = async function(id) {
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

// إدارة أجزاء القصص
async function loadParts() {
  const sid = $('partsStorySelect').value;

  $('partsAdmin').innerHTML = '';
  $('partForm').reset();
  $('partId').value = '';
  $('cancelPart').hidden = true;
  $('savePart').textContent = 'حفظ الجزء';
  $('partImageCurrent').hidden = true;
  $('partImageCurrent').innerHTML = '';
  $('partUpdateImageCurrent').hidden = true;
  $('partUpdateImageCurrent').innerHTML = '';

  if (!sid) {
    window.CURRENT_PARTS = [];
    $('partsAdmin').innerHTML =
      '<p class="muted">اختاري قصة لعرض أجزائها.</p>';
    return;
  }

  try {
    const data = await call(
      '/api/admin/story/' + encodeURIComponent(sid) + '/parts'
    );

    window.CURRENT_PARTS = data.parts || [];

    $('partsAdmin').innerHTML = window.CURRENT_PARTS.length
      ? window.CURRENT_PARTS.map(part => `
          <div class="part-admin">
            ${part.image_path ? `
              <img src="${esc(media(part.image_path))}"
                   alt="${esc(part.title)}"
                   loading="lazy"
                   style="width:90px;aspect-ratio:1/1;object-fit:cover;border-radius:10px">
            ` : ''}
            <div>
              <strong>${esc(part.title)}</strong>
              <p class="muted">الجزء ${esc(Number(part.part_number ?? part.sort_order ?? 0) + 1)}</p>
            </div>
            <div class="cat-actions">
              <button class="secondary" type="button"
                onclick="editPart('${esc(part.id)}')">تعديل</button>
              <button class="danger" type="button"
                onclick="deletePart('${esc(part.id)}')">حذف</button>
            </div>
          </div>
        `).join('')
      : '<p class="muted">لا توجد أجزاء لهذه القصة.</p>';
  } catch (error) {
    $('partsAdmin').textContent = error.message;
  }
}

$('partsStorySelect').addEventListener('change', loadParts);

// معاينة صورة الجزء قبل الحفظ
$('partImage').addEventListener('change', async () => {
  const file = $('partImage').files[0];
  if (!file) return;

  try {
    await validateSquareImage(file);

    const url = URL.createObjectURL(file);
    $('partImageCurrent').innerHTML =
      `<img src="${url}" alt="معاينة صورة الجزء"
        style="width:120px;aspect-ratio:1/1;object-fit:cover;border-radius:12px">`;
    $('partImageCurrent').hidden = false;
  } catch (error) {
    $('partImage').value = '';
    $('partImageCurrent').hidden = true;
    setMsg('partFormMsg', error.message, true);
  }
});

// التحقق من نسبة صورة التحديث للقصة قبل الإرسال
$('updateImage').addEventListener('change', async () => {
  const file = $('updateImage').files[0];
  if (!file) return;
  try { await validatePortraitImage(file); $('updateImageCurrent').hidden = true; setMsg('formMsg', 'صورة التحديث العمودية جاهزة.'); }
  catch (error) { $('updateImage').value = ''; setMsg('formMsg', error.message, true); }
});

$('partUpdateImage').addEventListener('change', async () => {
  const file = $('partUpdateImage').files[0];
  if (!file) return;
  try {
    await validatePortraitImage(file);
    const url = URL.createObjectURL(file);
    $('partUpdateImageCurrent').innerHTML = `<img src="${url}" alt="معاينة صورة التحديث" style="width:90px;aspect-ratio:9/16;object-fit:cover;border-radius:10px">`;
    $('partUpdateImageCurrent').hidden = false;
  } catch (error) { $('partUpdateImage').value = ''; $('partUpdateImageCurrent').hidden = true; setMsg('partFormMsg', error.message, true); }
});

// حفظ الجزء: عنوان + MP3 + صورة مربعة اختيارية
$('partForm').addEventListener('submit', async event => {
  event.preventDefault();

  const button = $('savePart');
  button.disabled = true;

  try {
    const sid = $('partsStorySelect').value;
    const id = $('partId').value;
    const title = $('partTitle').value.trim();
    const audio = $('partAudio').files[0];
    const image = $('partImage').files[0];
    const updateImage = $('partUpdateImage').files[0];

    if (!sid) throw Error('اختاري القصة أولاً.');
    if (!title) throw Error('اكتبي عنوان الجزء.');
    if (!id && !audio) throw Error('اختاري ملف MP3 للجزء.');

    const payload = { title };

    if (audio) {
      validateAudio(audio);
      payload.audio_path = await upload(audio, 'audio');
    }

    if (image) {
      await validateSquareImage(image);
      payload.image_path = await upload(image, 'part-image');
    }

    if (updateImage) {
      await validatePortraitImage(updateImage);
      payload.update_image_path = await upload(updateImage, 'update-image');
    }

    await call(
      id
        ? '/api/admin/part/' + encodeURIComponent(id)
        : '/api/admin/story/' + encodeURIComponent(sid) + '/parts',
      {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    setMsg('partFormMsg', id ? 'تم تحديث الجزء.' : 'تمت إضافة الجزء.');
    $('partForm').reset();
    $('partId').value = '';
    $('cancelPart').hidden = true;
    $('savePart').textContent = 'حفظ الجزء';
    $('partImageCurrent').hidden = true;
    $('partImageCurrent').innerHTML = '';
    $('partUpdateImageCurrent').hidden = true;
    $('partUpdateImageCurrent').innerHTML = '';

    await loadParts();
  } catch (error) {
    setMsg('partFormMsg', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('cancelPart').onclick = () => {
  $('partForm').reset();
  $('partId').value = '';
  $('cancelPart').hidden = true;
  $('savePart').textContent = 'حفظ الجزء';
  $('partImageCurrent').hidden = true;
  $('partImageCurrent').innerHTML = '';
  $('partUpdateImageCurrent').hidden = true;
  $('partUpdateImageCurrent').innerHTML = '';
};

window.editPart = function(id) {
  const part = window.CURRENT_PARTS.find(
    item => String(item.id) === String(id)
  );
  if (!part) return;

  $('partId').value = part.id;
  $('partTitle').value = part.title || '';
  $('partAudio').value = '';
  $('partImage').value = '';
  $('partUpdateImage').value = '';

  if (part.update_image_path) {
    $('partUpdateImageCurrent').innerHTML = `<p class="muted">صورة بطاقة التحديث الحالية.</p><img src="${esc(media(part.update_image_path))}" alt="${esc(part.title)}" style="width:90px;aspect-ratio:9/16;object-fit:cover;border-radius:10px">`;
    $('partUpdateImageCurrent').hidden = false;
  } else { $('partUpdateImageCurrent').hidden = true; $('partUpdateImageCurrent').innerHTML = ''; }

  if (part.image_path) {
    $('partImageCurrent').innerHTML = `
      <p class="muted">الصورة الحالية — ارفعي صورة جديدة لاستبدالها.</p>
      <img src="${esc(media(part.image_path))}"
           alt="${esc(part.title)}"
           style="width:120px;aspect-ratio:1/1;object-fit:cover;border-radius:12px">
    `;
    $('partImageCurrent').hidden = false;
  } else {
    $('partImageCurrent').hidden = true;
    $('partImageCurrent').innerHTML = '';
  }

  $('cancelPart').hidden = false;
  $('savePart').textContent = 'حفظ التعديلات';

  window.scrollTo({
    top: $('partsPanel').offsetTop,
    behavior: 'smooth'
  });
};

window.deletePart = async function(id) {
  if (!confirm('هل تريد حذف هذا الجزء؟')) return;

  try {
    await call('/api/admin/part/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
    await loadParts();
  } catch (error) {
    alert(error.message);
  }
};

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
