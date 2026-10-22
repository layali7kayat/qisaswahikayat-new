'use strict';

const API = window.API_BASE || localStorage.getItem('qisas_api_base') || '';

const DEFAULT_CATEGORIES = [
  { id: 'fantasy', title: 'قصص فانتازيا', emoji: '✨' },
  { id: 'forced-marriage', title: 'الزواج الإجباري', emoji: '💍' },
  { id: 'history', title: 'قصص تاريخية', emoji: '🏰' },
  { id: 'children', title: 'قصص أطفال', emoji: '🧸' },
  { id: 'romance', title: 'قصص رومانسية', emoji: '🌹' },
  { id: 'horror', title: 'قصص رعب', emoji: '🌙' },
  { id: 'alf-layla', title: 'ألف ليلة وليلة', emoji: '🪔' }
];

const $ = id => document.getElementById(id);

let catalog = { categories: [], stories: [] };
let selected = null;
let currentStory = null;
const LIBRARY_KEYS = { favorites: 'qisas_favorites_v1', later: 'qisas_watch_later_v1', history: 'qisas_watch_history_v1' };
let libraryView = 'search';
let currentParts = [];
let currentPart = null;
let isSeeking = false;
let routeRequest = 0;
let seekPointerId = null;

const progressKey = id => 'qisas_audio_progress_' + String(id);

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatStoryDate(value) {
  if (!value) return 'تاريخ النشر غير متوفر';
  // created_at comes from the database and is never changed by ordinary story edits.
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 'تاريخ النشر غير متوفر';
  return 'نُشرت في ' + new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  if (!API) return '';

  return API.replace(/\/$/, '') +
    '/media/' + String(path).replace(/^\/+/, '');
}

async function request(path) {
  if (!API) {
    return {
      categories: DEFAULT_CATEGORIES.map(item => ({
        ...item,
        image_path: ''
      })),
      stories: []
    };
  }

  const response = await fetch(API.replace(/\/$/, '') + path);

  if (!response.ok) {
    throw Error('تعذر تحميل البيانات من الخادم');
  }

  return response.json();
}

async function load() {
  try {
    catalog = await request('/api/catalog');

    catalog.categories = Array.isArray(catalog.categories)
      ? catalog.categories
      : [];

    catalog.stories = Array.isArray(catalog.stories)
      ? catalog.stories
      : [];

    renderCategories();
  } catch (error) {
    const container = $('categories');

    if (container) {
      container.innerHTML =
        '<div class="empty">تعذر الاتصال بالخادم. تحققي من رابط Cloudflare Worker.</div>';
    }
  }
}

function routePath(page, id, partNumber = null) {
  const routes = {
    home: '/',
    category: '/category/',
    story: '/story/',
    listen: '/listen/',
    parts: '/parts/'
  };

  if (page === 'home') return '/';

  const encodedId = encodeURIComponent(String(id));

  if (page === 'listen' && partNumber !== null && partNumber !== undefined) {
    return '/listen/' + encodedId + '/part/' + encodeURIComponent(String(partNumber));
  }

  return routes[page] + encodedId;
}

function navigateToPart(storyId, partNumber) {
  const target = routePath('listen', storyId, partNumber);

  // Full navigation is intentional: every part has its own URL/page load.
  // This also gives AdSense Auto ads a normal navigation opportunity.
  if (location.pathname !== target) {
    location.href = target;
  } else {
    restoreRoute();
  }
}

function navigateRoute(page, id) {
  const target = routePath(page, id);

  if (location.pathname + location.search !== target) {
    location.href = target;
  } else {
    restoreRoute();
  }
}

function showPage(page) {
  $('librarySection').hidden = true;
  $('homeSections').hidden = page !== 'home';
  $('storySection').hidden = page !== 'category';
  $('playerSection').hidden = page !== 'story';
  $('partsSection').hidden = page !== 'parts';
  $('listenSection').hidden = page !== 'listen';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderCategories() {
  const categories = catalog.categories.length
    ? catalog.categories
    : DEFAULT_CATEGORIES.map(item => ({ ...item, image_path: '' }));

  $('categoryCount').textContent = categories.length + ' تصنيفات';

  $('categories').innerHTML = categories.map(category => {
    const image = category.image_path || category.image_url;

    return `
      <button class="category" data-category="${esc(category.id)}">
        ${
          image
            ? `<img src="${esc(mediaUrl(image))}"
                    alt="${esc(category.title)}"
                    loading="lazy" decoding="async">`
            : `<span class="placeholder">${esc(category.emoji || '📚')}</span>`
        }
        <h3>${esc(category.title)}</h3>
      </button>
    `;
  }).join('');

  document.querySelectorAll('[data-category]').forEach(button => {
    button.onclick = () => openCategory(button.dataset.category);
  });
}

function storyRow(story, rank = '') {
  const cover = story.wide_image_path || story.image_path;

  return `
    <article class="story" data-story-card="${esc(story.id)}">
      ${rank
        ? `<span class="story-rank" aria-label="الترتيب ${rank}">${rank}</span>`
        : ''}

      <img class="story-cover"
        src="${esc(mediaUrl(cover))}"
        alt="${esc(story.title)}"
        loading="lazy" decoding="async"
        onerror="this.style.visibility='hidden'">

      <div class="story-info">
        <h3>${esc(story.title)}</h3>
        <div class="story-meta">
          <img class="story-brand-logo" src="/logo.png" alt="">
          <span class="story-brand-name">قصص وروايات صوتية</span>
          <span class="story-views">
            ${(Number(story.views) || 0).toLocaleString('ar')} مشاهدة
          </span>
          <span class="story-publish-date">${esc(formatStoryDate(story.created_at))}</span>
        </div>
      </div>
      <div class="story-actions">
        <button class="story-action" type="button" data-library-action="favorites" data-id="${esc(story.id)}" aria-label="إضافة ${esc(story.title)} إلى المفضلة">♡ المفضلة</button>
        <button class="story-action" type="button" data-library-action="later" data-id="${esc(story.id)}" aria-label="حفظ ${esc(story.title)} للمشاهدة لاحقًا">＋ لاحقًا</button>
      </div>
    </article>
  `;
}

function bindStoryButtons(root = document) {
  root.querySelectorAll('[data-story-card]').forEach(element => {
    element.onclick = event => { if (event.target.closest('[data-library-action]')) return; openStory(element.dataset.storyCard); };
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.onkeydown = event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-library-action]')) { event.preventDefault(); openStory(element.dataset.storyCard); }
    };
  });
  root.querySelectorAll('[data-library-action]').forEach(button => {
    button.onclick = event => { event.stopPropagation(); toggleLibrary(button.dataset.libraryAction, button.dataset.id); renderLibraryButtons(); button.textContent = isInLibrary(button.dataset.libraryAction, button.dataset.id) ? (button.dataset.libraryAction === 'favorites' ? '♥ بالمفضلة' : '✓ محفوظ لاحقًا') : (button.dataset.libraryAction === 'favorites' ? '♡ المفضلة' : '＋ لاحقًا'); };
  });
  renderLibraryButtons();
}

function readLibrary(key) { try { const v = JSON.parse(localStorage.getItem(LIBRARY_KEYS[key]) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch (_) { return []; } }
function writeLibrary(key, values) { localStorage.setItem(LIBRARY_KEYS[key], JSON.stringify([...new Set(values.map(String))])); }
function isInLibrary(key, id) { return readLibrary(key).includes(String(id)); }
function toggleLibrary(key, id) { const values = readLibrary(key); const value = String(id); writeLibrary(key, values.includes(value) ? values.filter(x => x !== value) : [value, ...values]); if (libraryView === key) renderLibrary(); }
function renderLibraryButtons() {
  document.querySelectorAll('[data-library-action]').forEach(button => { const active = isInLibrary(button.dataset.libraryAction, button.dataset.id); button.setAttribute('aria-pressed', String(active)); button.classList.toggle('is-active', active); });
  if (currentStory) { ['favorites','later'].forEach(key => { const button = $(key === 'favorites' ? 'detailFavorite' : 'detailLater'); if (!button) return; const active = isInLibrary(key, currentStory.id); button.setAttribute('aria-pressed', String(active)); button.classList.toggle('is-active', active); button.textContent = key === 'favorites' ? (active ? '♥ تمت الإضافة إلى المفضلة' : '♡ أضف إلى المفضلة') : (active ? '✓ محفوظ للمشاهدة لاحقًا' : '＋ المشاهدة لاحقًا'); }); }
}
function showLibrary(view) {
  libraryView = view; $('homeSections').hidden = true; $('playerSection').hidden = true; $('partsSection').hidden = true; $('listenSection').hidden = true; $('librarySection').hidden = false;
  const titles = { search:'البحث عن قصة 🔍', history:'سجل المشاهدة 🕘', later:'المشاهدة لاحقًا 📌', favorites:'المفضلة ❤️', most:'الأكثر استماعًا 🔥' };
  $('libraryTitle').textContent = titles[view] || titles.search; $('storySearchWrap').hidden = view !== 'search'; renderLibrary(); setMenu(false); window.scrollTo({top:0,behavior:'instant'});
}
function renderLibrary() {
  if (!$('librarySection') || $('librarySection').hidden) return;
  let stories = catalog.stories.slice();
  if (libraryView === 'search') { const q = ($('storySearchInput').value || '').trim().toLocaleLowerCase('ar'); stories = q ? stories.filter(x => String(x.title || '').toLocaleLowerCase('ar').includes(q) || String(x.description || '').toLocaleLowerCase('ar').includes(q)) : []; }
  else if (libraryView === 'most') { stories = stories.slice().sort((a,b) => (Number(b.views)||0) - (Number(a.views)||0)); }
  else { const ids = readLibrary(libraryView); stories = ids.map(id => catalog.stories.find(x => String(x.id) === id)).filter(Boolean); }
  $('libraryStories').innerHTML = stories.map((story, i) => storyRow(story, libraryView === 'most' ? i + 1 : '')).join(''); $('libraryEmpty').hidden = stories.length > 0 || (libraryView === 'search' && !($('storySearchInput').value || '').trim()); bindStoryButtons($('libraryStories'));
}

function showNotice(message) {
  const notice = $('notice');
  if (!notice) return;

  notice.textContent = message;
  notice.hidden = false;

  clearTimeout(notice._timer);
  notice._timer = setTimeout(() => {
    notice.hidden = true;
  }, 2600);
}

function renderTopStories() {}

function setCategoryTab(tab) {
  const showTop = tab === 'top';

  $('stories').hidden = showTop;
  $('categoryTopStories').hidden = !showTop;

  $('allStoriesTab').classList.toggle('active', !showTop);
  $('topStoriesTab').classList.toggle('active', showTop);

  $('allStoriesTab').setAttribute('aria-selected', String(!showTop));
  $('topStoriesTab').setAttribute('aria-selected', String(showTop));
}

function openCategory(id, fromRoute = false) {
  selected = String(id);
  try { sessionStorage.setItem('qisas_last_category', selected); } catch (_) {}

  const category = catalog.categories.find(
    item => String(item.id) === selected
  ) || DEFAULT_CATEGORIES.find(item => item.id === selected);

  $('selectedTitle').textContent = category?.title || 'القصص';

  const stories = catalog.stories.filter(
    story => String(story.category_id) === selected
  );

  $('storyCount').textContent = stories.length + ' قصة';
  $('topStoriesTab').textContent = 'الأكثر استماعًا';

  const topStories = [...stories].sort(
    (a, b) => (Number(b.views) || 0) - (Number(a.views) || 0)
  );

  $('categoryTopStories').innerHTML = topStories.length
    ? topStories.map((story, index) => storyRow(story, index + 1)).join('')
    : '<div class="empty">لا توجد قصص في هذا التصنيف حتى الآن.</div>';

  $('stories').innerHTML = stories.length
    ? stories.map(story => storyRow(story)).join('')
    : '<div class="empty">لا توجد قصص في هذا التصنيف حتى الآن.</div>';

  bindStoryButtons($('categoryTopStories'));
  bindStoryButtons($('stories'));

  setCategoryTab('all');
  showPage('category');

  if (
    !fromRoute &&
    location.pathname !== '/category/' + encodeURIComponent(selected)
  ) {
    navigateRoute('category', selected);
  }
}

function resetPartSelection() {
  currentParts = [];
  currentPart = null;

  const root = $('storyPartsPublic');
  const pageRoot = $('partsPageList');

  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }

  if (pageRoot) pageRoot.innerHTML = '';

  if ($('openParts')) $('openParts').hidden = true;
}

async function openStory(id, fromRoute = false, skipView = false) {
  const story = catalog.stories.find(
    item => String(item.id) === String(id)
  );

  if (!story) {
    showNotice('لم يتم العثور على القصة.');
    return;
  }

  const thisRequest = ++routeRequest;
  currentStory = story;
  if (!skipView) { const historyItems = readLibrary('history').filter(x => x !== String(story.id)); writeLibrary('history', [String(story.id), ...historyItems].slice(0, 100)); }
  resetPartSelection();

  const audio = $('audioPlayer');

  audio.pause();
  audio.removeAttribute('src');
  audio.load();

  $('detailImage').src = mediaUrl(story.image_path);
  $('detailImage').alt = story.title;

  $('detailTitle').textContent = story.title;

  $('playerDescription').textContent =
    story.description || 'لا يوجد وصف لهذه القصة حتى الآن.';

  $('descriptionContent').classList.add('collapsed');
  $('descriptionToggle').setAttribute('aria-expanded', 'false');
  $('descriptionArrow').textContent = '⌄';

  $('listenImage').src = mediaUrl(story.image_path);
  $('listenImage').alt = story.title;
  $('listenTitle').textContent = story.title;

  $('playerMeta').innerHTML = `<span class="detail-brand-meta"><img class="story-brand-logo" src="/logo.png" alt=""><span class="story-brand-name">قصص وروايات صوتية</span><span>${(Number(story.views) || 0).toLocaleString('ar')} مشاهدة</span><span class="story-publish-date">${esc(formatStoryDate(story.created_at))}</span></span>`;
  renderLibraryButtons();

  audio.playbackRate = Number($('playbackSpeed')?.value) || 1;

  if (story.audio_path) {
    audio.src = mediaUrl(story.audio_path);
    audio.load();

    audio.addEventListener('loadedmetadata', function restoreProgress() {
      if (
        !currentStory ||
        String(currentStory.id) !== String(story.id) ||
        currentPart
      ) {
        return;
      }

      const saved = Number(
        localStorage.getItem(progressKey(story.id)) || 0
      );

      if (
        saved > 5 &&
        Number.isFinite(audio.duration) &&
        saved < audio.duration - 3
      ) {
        try {
          audio.currentTime = saved;
        } catch (_) {}
      }

      syncAudio();
    }, { once: true });
  }

  renderRecommendations(story);

  const pathIsListen = location.pathname.startsWith('/listen/');
  const pathIsParts = location.pathname.startsWith('/parts/');

  const desiredPage = (
    fromRoute && pathIsParts
  ) ? 'parts' : (
    fromRoute && pathIsListen
  ) ? 'listen' : 'story';

  const partRouteMatch = location.pathname.match(
    /^\/listen\/([^/]+)\/part\/([0-9]+)\/?$/
  );

  const desiredPath = (
    desiredPage === 'listen' && partRouteMatch
  )
    ? location.pathname
    : routePath(desiredPage, story.id);

  if (fromRoute) {
    if (
      location.pathname !== desiredPath &&
      !location.hash.startsWith('#')
    ) {
      history.replaceState(
        { page: desiredPage, id: String(story.id) },
        '',
        desiredPath
      );
    }
  } else if (location.pathname !== desiredPath) {
    navigateRoute('story', story.id);
    return;
  }

  showPage(desiredPage);
  await loadPublicParts(story);

  if (thisRequest !== routeRequest) return;

  if (API && !skipView && desiredPage === 'story') {
    try {
      const response = await fetch(
        API.replace(/\/$/, '') +
        '/api/view/' + encodeURIComponent(id),
        { method: 'POST' }
      );

      if (thisRequest !== routeRequest) return;

      if (response.ok) {
        story.views = (Number(story.views) || 0) + 1;

        $('playerMeta').textContent =
          story.views.toLocaleString('ar') + ' مشاهدة';
      }
    } catch (_) {}
  }
}

function renderRecommendations(story) {
  const pool = catalog.stories.filter(
    item => String(item.id) !== String(story.id)
  );

  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }

  const picks = pool.slice(0, 6);

  $('recommendedStories').innerHTML = picks.length
    ? picks.map(item => storyRow(item)).join('')
    : '<div class="empty">أضف قصصًا أخرى ليظهر هنا المزيد من الاقتراحات.</div>';

  bindStoryButtons($('recommendedStories'));
}

function arabicPartNumber(number) {
  const names = [
    'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
    'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر',
    'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'
  ];
  return names[number - 1] || String(number);
}

function partDisplayTitle(part) {
  const number = Number(part.sort_order || part.part_number || 0);

  if (part.isOriginal) {
    return String(currentStory && currentStory.title ? currentStory.title : 'القصة كاملة');
  }

  const suffix = String(part.title || '').trim();

  return suffix
    ? 'الجزء ' + arabicPartNumber(number) + ' - ' + suffix
    : 'الجزء ' + arabicPartNumber(number);
}

function combineStoryParts(story, parts) {
  const dbParts = (Array.isArray(parts) ? parts : [])
    .map((part, index) => ({
      ...part,
      // Existing database parts represent the parts after the original story.
      // Their stored number 1 therefore becomes public part 2.
      sort_order: Number(part.sort_order ?? part.part_number ?? index + 1) + 1,
      isOriginal: false
    }))
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

  return [
    {
      id: 'story-' + String(story.id),
      story_id: String(story.id),
      title: 'الجزء الأول',
      audio_path: story.audio_path || '',
      image_path: story.image_path || '',
      sort_order: 1,
      isOriginal: true
    },
    ...dbParts
  ];
}

function renderPartList(root, story, parts) {
  if (!root) return;

  root.innerHTML = parts.map((part, index) => {
    const image = part.isOriginal
      ? story.image_path
      : (part.image_path || story.image_path || '');

    const title = partDisplayTitle(part);

    return `
      <button type="button"
        class="story-part-button${index >= 4 ? ' story-part-extra' : ''}"
        data-part-number="${esc(part.sort_order)}"
        aria-label="تشغيل ${esc(title)}">
        ${
          image
            ? `<img class="part-thumb"
                src="${esc(mediaUrl(image))}"
                alt="${esc(title)}"
                loading="lazy"
                onerror="this.style.display='none'">`
            : `<span class="part-thumb-placeholder">▶</span>`
        }
        <span class="part-info">
          <span class="part-title">${esc(title)}</span>
          ${part.isOriginal ? '<span class="part-meta">الجزء الأول</span>' : ''}
        </span>
        <span class="part-play-icon">▶</span>
      </button>
    `;
  }).join('') + (parts.length > 4 ? `<button type="button" class="parts-expand-toggle" aria-expanded="false">عرض بقية الأجزاء (${(parts.length - 4).toLocaleString('ar')}) <span aria-hidden="true">⌄</span></button>` : '');

  root.querySelectorAll('.story-part-extra').forEach(button => { button.hidden = true; });
  const expandButton = root.querySelector('.parts-expand-toggle');
  if (expandButton) expandButton.addEventListener('click', () => {
    const expanded = expandButton.getAttribute('aria-expanded') === 'true';
    root.querySelectorAll('.story-part-extra').forEach(button => { button.hidden = expanded; });
    expandButton.setAttribute('aria-expanded', String(!expanded));
    expandButton.innerHTML = expanded ? `عرض بقية الأجزاء (${(parts.length - 4).toLocaleString('ar')}) <span aria-hidden="true">⌄</span>` : 'إخفاء الأجزاء <span aria-hidden="true">⌃</span>';
  });

  root.querySelectorAll('[data-part-number]').forEach(button => {
    button.addEventListener('click', () => {
      navigateToPart(story.id, Number(button.dataset.partNumber));
    });
  });
}

// تحميل أجزاء القصة وإظهار الجزء الأول الأصلي ضمن القائمة.
async function loadPublicParts(story) {
  const root = $('storyPartsPublic');
  if (!root) return;

  root.hidden = true;
  root.innerHTML = '';
  currentParts = [];

  if (!API) return;

  try {
    const response = await fetch(
      API.replace(/\/$/, '') +
      '/api/story/' + encodeURIComponent(story.id) + '/parts'
    );

    if (!response.ok) return;

    const data = await response.json();
    const savedParts = Array.isArray(data.parts) ? data.parts : [];

    // نحتفظ بالقصة الأصلية كمسار تشغيل أول حتى تبقى روابط الاستماع القديمة تعمل،
    // لكن لا نعرض واجهة الأجزاء إلا إذا أضاف المدير أجزاء فعلية لهذه القصة.
    const parts = combineStoryParts(story, savedParts);
    currentParts = parts;

    if (!story.audio_path) return;

    if (savedParts.length === 0) {
      // قصة كاملة مستقلة: لا عنوان "أجزاء القصة" ولا بطاقة "الجزء الأول".
      root.hidden = true;
      root.innerHTML = '';
      if ($('openParts')) $('openParts').hidden = true;
      return;
    }

    root.hidden = false;
    root.innerHTML = '<h3>أجزاء القصة</h3><div class="story-parts-list"></div>';
    renderPartList(root.querySelector('.story-parts-list'), story, parts);

    if ($('openParts')) {
      $('openParts').hidden = false;
    }
  } catch (_) {
    // عدم توفر الأجزاء لا يمنع تشغيل القصة الأصلية.
  }
}

function renderPartsPage(story) {
  const root = $('partsPageList');
  if (!root) return;

  $('partsStoryImage').src = mediaUrl(story.image_path);
  $('partsStoryImage').alt = story.title;
  $('partsStoryTitle').textContent = story.title;

  renderPartList(root, story, currentParts);
}

async function activatePart(story, partNumber, autoPlay = false) {
  const part = currentParts.find(
    item => Number(item.sort_order) === Number(partNumber)
  );

  if (!part || !part.audio_path) {
    showNotice('ملف الصوت لهذا الجزء غير متوفر.');
    return false;
  }

  const audio = $('audioPlayer');

  currentStory = story;
  currentPart = part;

  audio.pause();
  audio.removeAttribute('src');
  audio.src = mediaUrl(part.audio_path);
  audio.load();

  $('listenTitle').textContent = part.isOriginal
    ? story.title
    : partDisplayTitle(part);

  const partImage = part.isOriginal
    ? story.image_path
    : (part.image_path || story.image_path);

  $('listenImage').src = mediaUrl(partImage);
  $('listenImage').alt = part.isOriginal ? story.title : partDisplayTitle(part);

  document.querySelectorAll('[data-part-number]').forEach(item => {
    item.classList.toggle(
      'active',
      Number(item.dataset.partNumber) === Number(partNumber)
    );
  });

  showPage('listen');

  if (autoPlay) {
    try {
      await audio.play();
    } catch (_) {
      showNotice('اضغطي زر التشغيل لبدء الاستماع إلى الجزء.');
    }
  }

  return true;
}

function fmt(time) {
  if (!Number.isFinite(time) || time < 0) return '0:00';

  const seconds = Math.floor(time);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return hours + ':' +
      String(minutes).padStart(2, '0') + ':' +
      String(remainder).padStart(2, '0');
  }

  return minutes + ':' + String(remainder).padStart(2, '0');
}

function buildWaveform() {
  const wave = $('audioWaveform');
  if (!wave || wave.dataset.ready) return;

  wave.innerHTML = Array.from({ length: 72 }, (_, index) => {
    const height = 8 + Math.round(
      Math.abs(Math.sin(index * 1.73) * Math.cos(index * 0.29)) * 34 +
      Math.abs(Math.sin(index * 0.17)) * 15
    );

    return `
      <span class="wave-bar"
        style="--bar-height:${height}px;--bar-delay:${(index % 13) * -0.075}s">
      </span>
    `;
  }).join('');

  wave.dataset.ready = '1';
}

buildWaveform();

function syncAudio() {
  const audio = $('audioPlayer');
  if (!audio) return;

  $('currentTime').textContent = fmt(audio.currentTime);
  $('duration').textContent = fmt(audio.duration);

  const seekBar = $('seekBar');

  if (
    seekBar &&
    !isSeeking &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  ) {
    seekBar.value = String(
      Math.round((audio.currentTime / audio.duration) * 1000)
    );
  }
}

// الانتقال إلى الموضع المحدد في شريط التقدم.
function seekToSlider() {
  const audio = $('audioPlayer');
  const seekBar = $('seekBar');
  if (!audio || !seekBar) return;

  const duration = audio.duration;

  if (!Number.isFinite(duration) || duration <= 0) {
    showNotice('انتظري حتى يتم تحميل مدة الملف الصوتي.');
    return;
  }

  const value = Number(seekBar.value);

  if (!Number.isFinite(value)) return;

  const target = Math.max(
    0,
    Math.min(duration, (value / 1000) * duration)
  );

  try {
    audio.currentTime = target;
    $('currentTime').textContent = fmt(target);
  } catch (_) {
    showNotice('تعذر الانتقال إلى الموضع المطلوب في هذا الملف.');
  }
}

const seekBar = $('seekBar');

// السحب باللمس أو الماوس.
if (seekBar) {
  seekBar.addEventListener('pointerdown', event => {
    isSeeking = true;
    seekPointerId = event.pointerId;
  });

  seekBar.addEventListener('input', () => {
    isSeeking = true;

    const audio = $('audioPlayer');
    const duration = audio.duration;

    if (Number.isFinite(duration) && duration > 0) {
      const target = (Number(seekBar.value) / 1000) * duration;
      $('currentTime').textContent = fmt(target);
    }
  });

  function finishSeeking(event) {
    if (!isSeeking) return;

    if (
      event &&
      seekPointerId !== null &&
      event.pointerId !== undefined &&
      event.pointerId !== seekPointerId
    ) {
      return;
    }

    seekPointerId = null;
    seekToSlider();
    isSeeking = false;
    syncAudio();
  }

  seekBar.addEventListener('pointerup', finishSeeking);
  seekBar.addEventListener('pointercancel', finishSeeking);
  seekBar.addEventListener('change', finishSeeking);

  window.addEventListener('pointerup', finishSeeking);
  window.addEventListener('pointercancel', finishSeeking);

  // دعم لوحة المفاتيح.
  seekBar.addEventListener('keydown', event => {
    const audio = $('audioPlayer');

    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      setTimeout(() => {
        seekToSlider();
        syncAudio();
      }, 0);
    }
  });
}

// أزرار التنقل.
$('backCategories').onclick = () => navigateRoute('home');

$('allStoriesTab').onclick = () => setCategoryTab('all');
$('topStoriesTab').onclick = () => setCategoryTab('top');

$('closePlayer').onclick = () => {
  $('audioPlayer').pause();
  let categoryId = selected;
  try { categoryId = categoryId || sessionStorage.getItem('qisas_last_category'); } catch (_) {}
  if (categoryId) navigateRoute('category', categoryId);
  else navigateRoute('home');
};

$('listenStory').onclick = () => {
  if (!currentStory) return;

  $('audioPlayer').pause();
  // Full stories open their own listening page; only stories with added parts
  // use the independent /part/1 URL.
  if (currentParts.length > 1) {
    navigateToPart(currentStory.id, 1);
  } else {
    navigateRoute('listen', currentStory.id);
  }
};

$('openParts').onclick = () => {
  if (!currentStory) return;

  $('audioPlayer').pause();
  const target = routePath('parts', currentStory.id);

  if (location.pathname !== target) {
    location.href = target;
  } else {
    restoreRoute();
  }
};

$('backToStoryFromParts').onclick = () => {
  if (currentStory) {
    navigateRoute('story', currentStory.id);
  }
};

$('backToDetails').onclick = () => {
  $('audioPlayer').pause();

  if (currentStory) {
    navigateRoute('story', currentStory.id);
  }
};

$('descriptionToggle').onclick = () => {
  const box = $('descriptionContent');
  const open = box.classList.toggle('collapsed') === false;

  $('descriptionToggle').setAttribute('aria-expanded', String(open));
  $('descriptionArrow').textContent = open ? '⌃' : '⌄';
};

// التشغيل.
$('playPause').onclick = async () => {
  const audio = $('audioPlayer');

  if (audio.paused) {
    if (!audio.src) {
      showNotice('لا يوجد ملف صوتي متاح للتشغيل.');
      return;
    }

    try {
      await audio.play();
    } catch (_) {
      showNotice('تعذر تشغيل الصوت. تحققي من اتصال الإنترنت وملف الصوت.');
    }
  } else {
    audio.pause();
  }
};

$('seekBack').onclick = () => {
  const audio = $('audioPlayer');
  if (!Number.isFinite(audio.duration)) return;

  audio.currentTime = Math.max(0, audio.currentTime - 15);
};

$('seekForward').onclick = () => {
  const audio = $('audioPlayer');
  if (!Number.isFinite(audio.duration)) return;

  audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
};

// أحداث الصوت.
$('audioPlayer').addEventListener('timeupdate', () => {
  syncAudio();

  if (
    currentStory &&
    !currentPart &&
    !$('audioPlayer').ended
  ) {
    localStorage.setItem(
      progressKey(currentStory.id),
      String($('audioPlayer').currentTime)
    );
  }
});

$('audioPlayer').addEventListener('loadedmetadata', syncAudio);
$('audioPlayer').addEventListener('durationchange', syncAudio);
$('audioPlayer').addEventListener('seeked', syncAudio);

$('audioPlayer').addEventListener('play', () => {
  $('playPause').textContent = 'Ⅱ';
  $('playPause').setAttribute('aria-label', 'إيقاف مؤقت');
  $('audioWaveform').classList.add('playing');
});

$('audioPlayer').addEventListener('pause', () => {
  $('playPause').textContent = '▶';
  $('playPause').setAttribute('aria-label', 'تشغيل');
  $('audioWaveform').classList.remove('playing');
});

$('audioPlayer').addEventListener('ended', () => {
  $('playPause').textContent = '▶';

  if ($('seekBar')) $('seekBar').value = 0;

  $('audioWaveform').classList.remove('playing');

  if (currentStory && !currentPart) {
    localStorage.removeItem(progressKey(currentStory.id));
  }
});

$('audioPlayer').addEventListener('error', () => {
  showNotice('تعذر تحميل الملف الصوتي. تحققي من رابط الملف والخادم.');
});

$('playbackSpeed').addEventListener('change', event => {
  $('audioPlayer').playbackRate = Number(event.target.value) || 1;
});

// القائمة الجانبية.
const sideMenu = $('sideMenu');
const menuOverlay = $('menuOverlay');

function setMenu(open) {
  sideMenu.classList.toggle('open', open);
  menuOverlay.hidden = !open;
  sideMenu.setAttribute('aria-hidden', String(!open));
  $('menuBtn').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
}

$('menuBtn').onclick = () => setMenu(true);
document.querySelectorAll('[data-library-view]').forEach(link => {
  link.addEventListener('click', event => {
    const view = link.dataset.libraryView;
    const pages = {
      search: '/search.html',
      history: '/history.html',
      later: '/watch-later.html',
      favorites: '/favorites.html',
      most: '/most-listened.html'
    };

    if (!pages[view]) {
      setMenu(false);
      return;
    }

    event.preventDefault();
    setMenu(false);

    if (location.pathname !== pages[view]) {
      location.href = pages[view];
    } else {
      showLibrary(view);
    }
  });
});
$('backFromLibrary').onclick = () => { $('librarySection').hidden = true; navigateRoute('home'); };
$('storySearchInput').addEventListener('input', renderLibrary);
$('detailFavorite').onclick = () => { if (currentStory) { toggleLibrary('favorites', currentStory.id); renderLibraryButtons(); } };
$('detailLater').onclick = () => { if (currentStory) { toggleLibrary('later', currentStory.id); renderLibraryButtons(); } };
$('closeMenu').onclick = () => setMenu(false);
menuOverlay.onclick = () => setMenu(false);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setMenu(false);
});

document.querySelectorAll('.side-links a').forEach(link => {
  link.addEventListener('click', () => setMenu(false));
});

// أوقف القصة فور انتقال التطبيق إلى الخلفية أو مغادرة الصفحة.
function stopAudioOnExit() {
  const audio = $('audioPlayer');
  if (audio && !audio.paused) audio.pause();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopAudioOnExit(); });
window.addEventListener('pagehide', stopAudioOnExit);
window.addEventListener('blur', stopAudioOnExit);

// استعادة الصفحة الحالية.
async function restoreRoute() {
  const path = location.pathname;
  const hash = location.hash;

  const pageName = path.split('/').filter(Boolean).pop() || '';
  const libraryRoutes = {
    'search.html': 'search',
    'history.html': 'history',
    'watch-later.html': 'later',
    'favorites.html': 'favorites',
    'most-listened.html': 'most'
  };

  if (libraryRoutes[pageName]) {
    showLibrary(libraryRoutes[pageName]);
    return;
  }

  let match = path.match(/^\/category\/([^/]+)\/?$/);

  if (match) {
    openCategory(decodeURIComponent(match[1]), true);
    return;
  }

  match = path.match(/^\/parts\/([^/]+)\/?$/);

  if (match) {
    const id = decodeURIComponent(match[1]);
    await openStory(id, true, true);

    if (currentStory) {
      renderPartsPage(currentStory);
      showPage('parts');
    }

    return;
  }

  match = path.match(/^\/listen\/([^/]+)\/part\/([0-9]+)\/?$/);

  if (match) {
    const id = decodeURIComponent(match[1]);
    const partNumber = Number(match[2]);

    await openStory(id, true, true);
    if (!currentStory) return;

    await loadPublicParts(currentStory);

    // If no extra parts were added, this is a complete standalone story.
    // Normalize old /part/1 links to the full-story URL and title.
    if (currentParts.length <= 1) {
      history.replaceState({ page: 'listen', id: String(id) }, '', routePath('listen', id));
      currentPart = null;
      const audio = $('audioPlayer');
      audio.pause();
      audio.src = mediaUrl(currentStory.audio_path);
      audio.load();
      $('listenTitle').textContent = currentStory.title;
      $('listenImage').src = mediaUrl(currentStory.image_path);
      $('listenImage').alt = currentStory.title;
      showPage('listen');
      return;
    }

    const ok = await activatePart(currentStory, partNumber, false);
    if (!ok) navigateToPart(currentStory.id, 1);
    return;
  }

  match = path.match(/^\/listen\/([^/]+)\/?$/);

  if (match) {
    const id = decodeURIComponent(match[1]);
    await openStory(id, true, true);
    if (!currentStory) return;

    await loadPublicParts(currentStory);

    if (currentParts.length > 1) {
      // A story with extra parts uses part 1 as the first selectable episode.
      await activatePart(currentStory, 1, false);
    } else {
      // A standalone story keeps its original title and full audio, without
      // converting the URL to /part/1.
      currentPart = null;
      const audio = $('audioPlayer');
      audio.pause();
      audio.src = mediaUrl(currentStory.audio_path);
      audio.load();
      $('listenTitle').textContent = currentStory.title;
      $('listenImage').src = mediaUrl(currentStory.image_path);
      $('listenImage').alt = currentStory.title;
      showPage('listen');
    }
    return;
  }

  match = path.match(/^\/story\/([^/]+)\/?$/);

  if (match) {
    openStory(decodeURIComponent(match[1]), true);
    return;
  }

  if (hash) {
    match = hash.match(/^#category=(.+)$/);

    if (match) {
      openCategory(decodeURIComponent(match[1]), true);
      return;
    }

    match = hash.match(/^#(?:story|listen)=(.+)$/);

    if (match) {
      const id = decodeURIComponent(match[1]);

      await openStory(id, true);

      if (hash.startsWith('#listen=')) {
        await loadPublicParts(currentStory);
        await activatePart(currentStory, 1, false);
      }

      return;
    }
  }

  showPage('home');
}

window.addEventListener('popstate', restoreRoute);

window.addEventListener('pageshow', () => {
  if (catalog.categories.length) restoreRoute();
});

load().then(restoreRoute);

// منع بعض إجراءات المتصفح، وليس حماية الملفات من التنزيل.
document.addEventListener('contextmenu', event => {
  if (!event.target.closest('input, textarea, select, [contenteditable="true"]')) event.preventDefault();
});
document.addEventListener('copy', event => event.preventDefault());
document.addEventListener('cut', event => event.preventDefault());
document.addEventListener('selectstart', event => {
  if (!event.target.closest('input, textarea, select, [contenteditable="true"]')) event.preventDefault();
});

document.addEventListener('dragstart', event => {
  if (event.target.closest('img')) event.preventDefault();
});

document.addEventListener('keydown', event => {
  if (
    (event.ctrlKey || event.metaKey) &&
    ['s', 'u'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
  }
});
