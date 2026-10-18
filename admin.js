let API = window.API_BASE || localStorage.getItem('qisas_api_base') || '';

let ADMIN_EMAIL = sessionStorage.getItem('qisas_admin_email') || '';
let ADMIN_PASSWORD = sessionStorage.getItem('qisas_admin_password') || '';

let DATA = { categories: [], stories: [] };

const $ = id => document.getElementById(id);

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function api(path) {
  if (!API) throw Error('أدخلي رابط Cloudflare Worker أولاً');
  return API.replace(/\/$/, '') + path;
}

function setMsg(id, message, error = false) {
  $(id).textContent = message;
  $(id).style.color = error ? '#ff9292' : '#a8d8b0';
}

async function call(path, opts = {}) {
  const r = await fetch(api(path), {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'X-Admin-Email': ADMIN_EMAIL,
      'X-Admin-Password': ADMIN_PASSWORD
    }
  });

  const j = await r.json().catch(() => ({
    error: 'استجابة غير مفهومة'
  }));

  if (!r.ok) throw Error(j.error || 'حدث خطأ');

  return j;
}

$('loginBtn').onclick = login;

$('email').value = ADMIN_EMAIL;
$('password').value = ADMIN_PASSWORD;

if (ADMIN_EMAIL && ADMIN_PASSWORD) login();

$('password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
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
  } catch (e) {
    setMsg(
      'loginMsg',
      e.message + ' تأكدي من إعداد ADMIN_EMAIL وADMIN_PASSWORD في Cloudflare ورابط Worker.',
      true
    );
  }
}

async function refresh() {
  DATA = await call('/api/admin/catalog');

  renderCategories();
  renderStories();

  $('category').innerHTML = DATA.categories.map(c =>
    `<option value="${esc(c.id)}">${esc(c.title)}</option>`
  ).join('');
}

function media(path) {
  return path ? api('/media/' + path) : '';
}

function renderCategories() {
  $('categoryAdmin').innerHTML = DATA.categories.map(c => `
    <div class="cat-edit">
      <img
        src="${esc(media(c.image_path))}"
        alt=""
        onerror="this.style.display='none'">

      <div class="cat-fields">
        <input
          id="name-${esc(c.id)}"
          value="${esc(c.title)}"
          aria-label="اسم التصنيف">

        <input
          id="img-${esc(c.id)}"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="صورة التصنيف">

        <div class="cat-actions">
          <button
            class="secondary"
            onclick="saveCategory('${esc(c.id)}')">
            حفظ التصنيف
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

async function upload(file, kind) {
  if (!file) return null;

  const q = await call(
    '/api/upload-url?kind=' + kind +
    '&filename=' + encodeURIComponent(file.name) +
    '&type=' + encodeURIComponent(
      file.type || 'application/octet-stream'
    ),
    { method: 'POST' }
  );

  const r = await fetch(api('/api/upload/' + q.key), {
    method: 'PUT',
    headers: {
      'X-Admin-Email': ADMIN_EMAIL,
      'X-Admin-Password': ADMIN_PASSWORD,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  });

  if (!r.ok) {
    throw Error(
      (await r.json().catch(() => ({}))).error ||
      'فشل رفع الملف'
    );
  }

  return q.key;
}

async function saveCategory(id) {
  try {
    const title = $('name-' + id).value.trim();

    if (!title) throw Error('اكتبي اسم التصنيف');

    const file = $('img-' + id).files[0];
    let image_path = null;

    if (file) {
      if (!file.type.startsWith('image/')) {
        throw Error('اختاري صورة صالحة');
      }

      image_path = await upload(file, 'category');
    }

    await call('/api/admin/category/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, image_path })
    });

    await refresh();
    alert('تم حفظ التصنيف');
  } catch (e) {
    alert(e.message);
  }
}

function renderStories() {
  $('storyAdmin').innerHTML = DATA.stories.length
    ? DATA.stories.map(s => `
      <div class="story-admin">
        <img src="${esc(media(s.image_path))}" alt="">

        <div>
          <h3>${esc(s.title)}</h3>

          <p class="muted">
            ${esc(
              (DATA.categories.find(c => c.id === s.category_id) || {}).title || ''
            )}
            · ${(Number(s.views) || 0).toLocaleString('ar')} مشاهدة
            · قياس الصورة: ${esc(s.thumbnail_ratio || '16:9')}
          </p>

          <div class="cat-actions">
            <button
              class="secondary"
              onclick="editStory('${esc(s.id)}')">
              تعديل
            </button>

            <button
              class="danger"
              onclick="deleteStory('${esc(s.id)}')">
              حذف
            </button>
          </div>
        </div>
      </div>
    `).join('')
    : '<p class="muted">لا توجد قصص منشورة بعد.</p>';
}

$('storyForm').onsubmit = async e => {
  e.preventDefault();

  $('publish').disabled = true;

  try {
    const id = $('storyId').value;
    const audio = $('audio').files[0];
    const image = $('image').files[0];

    if (!id && (!audio || !image)) {
      throw Error('ارفعي ملف MP3 والصورة المصغرة');
    }

    const payload = {
      title: $('title').value.trim(),
      category_id: $('category').value,
      description: $('description').value.trim(),

      // حفظ القياس المختار لكل قصة
      thumbnail_ratio: $('thumbnailRatio').value
    };

    if (!payload.title) {
      throw Error('اكتبي عنوان القصة');
    }

    if (!['16:9', '1:1'].includes(payload.thumbnail_ratio)) {
      throw Error('اختاري قياس الصورة 16:9 أو 1:1');
    }

    if (audio) {
      payload.audio_path = await upload(audio, 'audio');
    }

    if (image) {
      payload.image_path = await upload(image, 'story');
    }

    await call(
      id ? '/api/admin/story/' + id : '/api/admin/story',
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
  } catch (e) {
    setMsg('formMsg', e.message, true);
  } finally {
    $('publish').disabled = false;
  }
};

function resetForm() {
  $('storyForm').reset();
  $('storyId').value = '';

  $('thumbnailRatio').value = '16:9';

  $('audio').required = true;
  $('image').required = true;

  $('publish').textContent = 'نشر القصة';
  $('cancelEdit').hidden = true;
}

window.editStory = id => {
  const s = DATA.stories.find(x => x.id === id);

  if (!s) return;

  $('storyId').value = s.id;
  $('title').value = s.title;
  $('category').value = s.category_id;
  $('description').value = s.description || '';

  // استرجاع القياس المحفوظ عند تعديل القصة
  $('thumbnailRatio').value =
    s.thumbnail_ratio === '1:1' ? '1:1' : '16:9';

  $('audio').required = false;
  $('image').required = false;

  $('publish').textContent = 'حفظ التعديلات';
  $('cancelEdit').hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$('cancelEdit').onclick = resetForm;

window.deleteStory = async id => {
  if (!confirm('هل تريدين حذف القصة نهائيًا؟')) return;

  try {
    await call('/api/admin/story/' + id, {
      method: 'DELETE'
    });

    await refresh();
  } catch (e) {
    alert(e.message);
  }
};

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
