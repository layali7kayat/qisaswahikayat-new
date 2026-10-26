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

// Mark an episode as new for exactly seven days after its publication time.
// SQLite timestamps are UTC when they do not include an explicit timezone.
function isEpisodeNew(value) {
  if (!value) return false;
  const raw = String(value).trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? raw
    : (raw.includes('T') ? raw : raw.replace(' ', 'T')) + 'Z';
  const published = new Date(normalized).getTime();
  if (!Number.isFinite(published)) return false;
  const age = Date.now() - published;
  return age >= 0 && age < 7 * 24 * 60 * 60 * 1000;
}

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  if (!API) return path.startsWith('/') ? path : '';

  return API.replace(/\/$/, '') +
    '/media/' + String(path).replace(/^\/+/, '');
}

async function request(path) {
  if (!API) {
    if (path === '/api/latest-updates') return { updates: [] };
    return {
      categories: DEFAULT_CATEGORIES.map(item => ({ ...item, image_path: '' })),
      stories: []
    };
  }

  const response = await fetch(API.replace(/\/$/, '') + path);
  if (!response.ok) throw Error('تعذر تحميل البيانات من الخادم');
  return response.json();
}

let latestUpdates = [];

async function load() {
  try {
    const [catalogData, updatesData] = await Promise.all([
      request('/api/catalog'),
      request('/api/latest-updates')
    ]);

    catalog = {
      categories: Array.isArray(catalogData.categories) ? catalogData.categories : [],
      stories: Array.isArray(catalogData.stories) ? catalogData.stories : []
    };
    latestUpdates = Array.isArray(updatesData.updates) ? updatesData.updates : [];

    if (!catalog.categories.length) {
      catalog.categories = DEFAULT_CATEGORIES.map(item => ({ ...item, image_path: '' }));
    }
    renderLatestStories();
    renderCategories();
  } catch (error) {
    catalog = {
      categories: DEFAULT_CATEGORIES.map(item => ({ ...item, image_path: '' })),
      stories: []
    };
    latestUpdates = [];
    renderLatestStories();
    renderCategories();
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
  if (page === 'categories') return '/categories/';

  const encodedId = encodeURIComponent(String(id));

  if (page === 'listen' && partNumber !== null && partNumber !== undefined) {
    return '/listen/' + encodedId + '/part/' + encodeURIComponent(String(partNumber));
  }

  return routes[page] + encodedId;
}

function saveStoryOrigin(path = location.pathname) {
  const safePath = /^\/(?:category\/[A-Za-z0-9_-]+|categories\/?)$/.test(path) ? path : '/';
  try { sessionStorage.setItem('qisas_story_origin', safePath); } catch (_) {}
}

function getStoryOrigin() {
  try {
    const path = sessionStorage.getItem('qisas_story_origin') || '/';
    if (/^\/category\/[A-Za-z0-9_-]+$/.test(path)) return path;
    if (path === '/categories/' || path === '/categories') return '/categories/';
  } catch (_) {}
  return '/';
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
  document.body.classList.toggle('story-page-active', page === 'story');
  $('librarySection').hidden = true;
  $('homeSections').hidden = page !== 'home';
  $('storySection').hidden = page !== 'category';
  $('playerSection').hidden = page !== 'story';
  $('partsSection').hidden = page !== 'parts';
  $('listenSection').hidden = page !== 'listen';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderLatestStories() {
  const root = $('latestStories');
  if (!root) return;

  const updates = [...latestUpdates].sort((a, b) =>
    String(b.published_at || '').localeCompare(String(a.published_at || ''))
  );
  root.innerHTML = updates.length ? updates.map(update => {
    const number = Number(update.episode_number || 1);
    const total = Number(update.total_episodes || 0);
    const episodeLabel = total > 0 && number === total
      ? `الحلقة الأخيرة : ${number.toLocaleString('ar')}`
      : `الحلقة : ${number.toLocaleString('ar')}`;
    const story = catalog.stories.find(item => String(item.id) === String(update.story_id));
    const imagePath = String(update.image_path || '').trim() || String(story?.image_path || '').trim();
    const fallbackImage = String(story?.image_path || '').trim();
    const newBadge = isEpisodeNew(update.published_at)
      ? '<span class="latest-new-badge" aria-label="حلقة جديدة منشورة خلال آخر أسبوع"><span class="latest-new-dot" aria-hidden="true"></span>جديد</span>'
      : '';
    return `
      <article class="latest-card latest-episode-card" data-latest-story="${esc(update.story_id)}" tabindex="0" role="link" aria-label="تفاصيل قصة ${esc(update.story_title)}">
        <div class="latest-cover-wrap">
          <img class="latest-cover" src="${esc(mediaUrl(imagePath))}" data-fallback-src="${esc(mediaUrl(fallbackImage))}" alt="${esc(update.story_title)}" loading="lazy" decoding="async">
          ${newBadge}
          <span class="latest-episode">${esc(episodeLabel)}</span>
        </div>
        <h3>${esc(update.story_title)}</h3>
        <p class="latest-genre">${esc(update.category_title || 'غير مصنفة')}</p>
      </article>`;
  }).join('') : '<p class="muted">لا توجد حلقات منشورة حديثًا حتى الآن.</p>';

  root.querySelectorAll('.latest-cover').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = img.dataset.fallbackSrc || '';
      if (fallback && img.src !== fallback && !img.dataset.fallbackTried) {
        img.dataset.fallbackTried = '1';
        img.src = fallback;
      }
    }, { once: true });
  });

  root.querySelectorAll('[data-latest-story]').forEach(card => {
    const openStory = () => {
      saveStoryOrigin(location.pathname);
      navigateRoute('story', card.dataset.latestStory);
    };
    card.addEventListener('click', openStory);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openStory();
      }
    });
  });
}

function renderCategories() {
  if (!$('categories')) return;
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
    element.onclick = event => {
      if (event.target.closest('[data-library-action]')) return;
      saveStoryOrigin(location.pathname);
      openStory(element.dataset.storyCard);
    };
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.onkeydown = event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-library-action]')) { event.preventDefault(); saveStoryOrigin(location.pathname); openStory(element.dataset.storyCard); }
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

}
function showLibrary(view) {
  libraryView = view; $('homeSections').hidden = true; $('playerSection').hidden = true; $('partsSection').hidden = true; $('listenSection').hidden = true; $('librarySection').hidden = false;
  const listOption = STORY_LIST_OPTIONS.find(item => view === 'storylist-' + item.key);
  const titles = { search:'البحث عن قصة 🔍', history:'سجل المشاهدة 🕘', later:'المشاهدة لاحقًا 📌', favorites:'المفضلة ❤️', most:'الأكثر استماعًا 🔥' };
  $('libraryTitle').textContent = listOption ? listOption.label : (titles[view] || titles.search);
  $('storySearchWrap').hidden = view !== 'search'; renderLibrary(); setMenu(false); window.scrollTo({top:0,behavior:'instant'});
}
function renderLibrary() {
  if (!$('librarySection') || $('librarySection').hidden) return;
  let stories = catalog.stories.slice();
  if (libraryView === 'search') { const q = ($('storySearchInput').value || '').trim().toLocaleLowerCase('ar'); stories = q ? stories.filter(x => String(x.title || '').toLocaleLowerCase('ar').includes(q) || String(x.description || '').toLocaleLowerCase('ar').includes(q)) : []; }
  else if (libraryView === 'most') { stories = stories.slice().sort((a,b) => (Number(b.views)||0) - (Number(a.views)||0)); }
  else if (libraryView.startsWith('storylist-')) {
    const listKey = libraryView.slice('storylist-'.length); const lists = readStoryLists();
    stories = Object.keys(lists).filter(id => lists[id] === listKey).map(id => catalog.stories.find(x => String(x.id) === id)).filter(Boolean);
  }
  else { const ids = readLibrary(libraryView); stories = ids.map(id => catalog.stories.find(x => String(x.id) === id)).filter(Boolean); }
  $('libraryStories').innerHTML = stories.map((story, i) => storyRow(story, libraryView === 'most' ? i + 1 : '')).join('');
  $('libraryEmpty').hidden = stories.length > 0 || (libraryView === 'search' && !($('storySearchInput').value || '').trim()); bindStoryButtons($('libraryStories'));
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
  setHomeTab('categories');
  selected = String(id);
  try { sessionStorage.setItem('qisas_last_category', selected); } catch (_) {}

  const category = catalog.categories.find(
    item => String(item.id) === selected
  ) || DEFAULT_CATEGORIES.find(item => item.id === selected);

  $('selectedTitle').textContent = category?.title || 'القصص';

  const stories = catalog.stories.filter(story =>
    (Array.isArray(story.category_ids) && story.category_ids.map(String).includes(selected)) ||
    String(story.category_id) === selected
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

function renderStoryGenres(story) {
  const root = $('storyGenreTags');
  if (!root) return;
  const ids = Array.isArray(story.category_ids) ? story.category_ids.map(String) : [];
  if (story.category_id !== undefined && story.category_id !== null && String(story.category_id)) ids.push(String(story.category_id));
  const uniqueIds = [...new Set(ids)];
  const matches = uniqueIds.map(id => catalog.categories.find(category => String(category.id) === id)).filter(Boolean);
  const names = matches.length ? matches.map(category => category.title) : (Array.isArray(story.categories) ? story.categories.map(item => typeof item === 'string' ? item : item.title).filter(Boolean) : []);
  root.innerHTML = [...new Set(names)].map(name => `<span>${esc(name)}</span>`).join('');
  root.hidden = names.length === 0;
}

const STORY_LIST_OPTIONS = [
  { key: 'want', label: 'أرغب بمشاهدتها', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="25" height="19" rx="2"/><path d="M10 28h11M16 24v4M16 10v9M11.5 14.5h9"/></svg>' },
  { key: 'watching', label: 'أشاهدها حاليا', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12"/><path d="m13 10 9 6-9 6z"/></svg>' },
  { key: 'watched', label: 'تم مشاهدتها', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="currentColor"/><path d="m13 10 9 6-9 6z" class="icon-cutout"/></svg>' },
  { key: 'later', label: 'اكملها لاحقا', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="25" height="21" rx="2"/><path d="M12 11v9M20 11v9"/></svg>' },
  { key: 'avoid', label: 'لا أرغب بمشاهدتها', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="25" height="19" rx="2"/><path d="M10 28h11M16 24v4M11 14h9"/></svg>' }
];
const STORY_LIST_STORAGE = 'qisas_story_lists_v1';
function readStoryLists() { try { const value = JSON.parse(localStorage.getItem(STORY_LIST_STORAGE) || '{}'); return value && typeof value === 'object' ? value : {}; } catch (_) { return {}; } }
function storyListFor(storyId) { return String(readStoryLists()[String(storyId)] || ''); }
function renderStoryListOptions() {
  const root = $('storyListOptions');
  if (!root || !currentStory) return;
  const active = storyListFor(currentStory.id);
  root.innerHTML = STORY_LIST_OPTIONS.map(item => `<button type="button" class="story-list-option${active === item.key ? ' is-selected' : ''}" data-story-list-key="${item.key}" aria-pressed="${active === item.key}"><span class="story-list-label">${item.label}</span><span class="story-list-icon">${item.icon}</span><span class="story-list-check" aria-hidden="true">${active === item.key ? '✓' : ''}</span></button>`).join('');
  root.querySelectorAll('[data-story-list-key]').forEach(button => button.addEventListener('click', () => {
    const lists = readStoryLists();
    const key = button.dataset.storyListKey;
    if (lists[String(currentStory.id)] === key) delete lists[String(currentStory.id)];
    else lists[String(currentStory.id)] = key;
    localStorage.setItem(STORY_LIST_STORAGE, JSON.stringify(lists));
    // Keep the familiar Favorites / Watch later pages in sync with the equivalent list choices.
    const favorites = readLibrary('favorites').filter(id => id !== String(currentStory.id));
    const later = readLibrary('later').filter(id => id !== String(currentStory.id));
    if (lists[String(currentStory.id)] === 'watched') writeLibrary('history', [String(currentStory.id), ...readLibrary('history').filter(id => id !== String(currentStory.id))].slice(0, 100));
    if (lists[String(currentStory.id)] === 'later' || lists[String(currentStory.id)] === 'want') later.unshift(String(currentStory.id));
    if (lists[String(currentStory.id)] === 'want') favorites.unshift(String(currentStory.id));
    writeLibrary('favorites', favorites); writeLibrary('later', later);
    renderStoryListOptions(); renderLibraryButtons();
    if (libraryView.startsWith('storylist-')) renderLibrary();
  }));
}
function openStoryList() { if (!currentStory) return; renderStoryListOptions(); $('storyListOverlay').hidden = false; document.body.classList.add('story-list-open'); }
function closeStoryList() { $('storyListOverlay').hidden = true; document.body.classList.remove('story-list-open'); }

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
  // اربط شارة حالة القصة بالحالة المحفوظة في قاعدة البيانات بدل النص الثابت في HTML.
  const statusBadge = document.querySelector('.story-status-pill');
  if (statusBadge) {
    const isCompleted = String(story.status || '').toLowerCase() === 'completed';
    statusBadge.textContent = isCompleted ? 'مكتملة' : 'مستمرة';
    statusBadge.classList.toggle('is-completed', isCompleted);
    statusBadge.setAttribute('aria-label', `حالة القصة: ${statusBadge.textContent}`);
  }
  renderStoryGenres(story);
  if ($('detailTopTitle')) $('detailTopTitle').textContent = story.title;
  const characterCards = [
    { imageId: 'characterImageOne', nameId: null, key: 'character_one_image_path', name: story.character_one_name || 'البطلة' },
    { imageId: 'characterImageTwo', nameId: null, key: 'character_two_image_path', name: story.character_two_name || 'البطل' },
    { imageId: 'characterImageThree', nameId: null, key: 'character_three_image_path', name: story.character_three_name || 'شخصية محورية' }
  ];
  characterCards.forEach(item => {
    const img = $(item.imageId);
    if (!img) return;
    const card = img.closest('.story-character');
    const imagePath = story[item.key];
    if (imagePath) {
      img.src = mediaUrl(imagePath);
      img.alt = item.name;
      img.hidden = false;
      if (card) card.hidden = false;
    } else {
      img.removeAttribute('src');
      img.alt = item.name;
      if (card) card.hidden = true;
    }
    const label = card?.querySelector('strong');
    if (label) label.textContent = item.name;
  });
  const charactersSection = document.querySelector('.story-characters-section');
  if (charactersSection) charactersSection.hidden = !characterCards.some(item => !!story[item.key]);
  const detailDate = $('detailPublishDate');
  if (detailDate) detailDate.textContent = formatStoryDate(story.created_at);

  const fullDescription = String(story.description || 'لا يوجد وصف لهذه القصة حتى الآن.').trim();
  const descriptionParts = fullDescription.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const descriptionContent = $('descriptionContent');
  const descriptionFirst = $('playerDescription');
  descriptionFirst.textContent = descriptionParts[0] || fullDescription;
  descriptionContent.querySelectorAll('.description-extra').forEach(node => node.remove());
  if (descriptionParts.length > 1) {
    const extra = document.createElement('div');
    extra.className = 'description-extra';
    descriptionParts.slice(1).forEach(part => {
      const paragraph = document.createElement('p');
      paragraph.textContent = part;
      extra.appendChild(paragraph);
    });
    descriptionContent.appendChild(extra);
  }
  descriptionContent.classList.add('collapsed');
  const descriptionToggle = $('descriptionToggle');
  const hasMoreDescription = descriptionParts.length > 1 || fullDescription.length > 240;
  descriptionToggle.hidden = !hasMoreDescription;
  descriptionToggle.querySelector('span:first-child').textContent = '';
  descriptionToggle.setAttribute('aria-expanded', 'false');
  $('descriptionArrow').textContent = '⌄';

  $('listenImage').src = mediaUrl(story.image_path);
  $('listenImage').alt = story.title;
  $('listenTitle').textContent = story.title;
  const listenDate = $('listenPublishDate');
  if (listenDate) listenDate.textContent = formatStoryDate(story.created_at);
  const partsDate = $('partsPublishDate');
  if (partsDate) partsDate.textContent = formatStoryDate(story.created_at);

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
  renderStoryEpisodes(story);
  const publishedEpisodeCount = getPublishedEpisodeParts(story).length;
  if ($('detailEpisodeCount')) {
    const plannedEpisodeCount = Number(story.total_episodes) || 0;
    $('detailEpisodeCount').textContent = plannedEpisodeCount > 0
      ? `${plannedEpisodeCount.toLocaleString('ar')} حلقة`
      : 'عدد الحلقات غير محدد';
  }
  await loadComments();

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
      published_at: story.created_at || null,
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
function getPublishedEpisodeParts(story) {
  // currentParts is built from the story's original published audio plus only
  // parts returned by the public API (which filters is_published = 1).
  const source = Array.isArray(currentParts) ? currentParts : [];
  return source
    .filter(part => String(part.audio_path || '').trim() !== '')
    .sort((a, b) => Number(b.sort_order || 0) - Number(a.sort_order || 0));
}

function renderStoryEpisodes(story) {
  const panel = $('storyEpisodesPanel');
  const list = $('storyEpisodesList');
  const empty = $('storyEpisodesEmpty');
  if (!panel || !list || !empty) return;

  const episodes = getPublishedEpisodeParts(story);
  list.innerHTML = '';
  empty.hidden = episodes.length > 0;

  if (!episodes.length) {
    empty.hidden = false;
    return;
  }

  episodes.forEach((part, index) => {
    const number = Number(part.sort_order || 1);
    const plannedTotal = Number(story.total_episodes) || 0;
    const isFinalEpisode = plannedTotal > 0 && number === plannedTotal;
    const label = isFinalEpisode
      ? `الحلقة الأخيرة : ${number}`
      : `الحلقة : ${number}`;

    const row = document.createElement('div');
    row.className = 'story-episode-row';
    const newBadge = isEpisodeNew(part.published_at)
      ? '<span class="episode-new-badge" aria-label="حلقة جديدة"><span class="episode-new-dot" aria-hidden="true"></span>جديد</span>'
      : '';
    row.tabIndex = 0;
    row.setAttribute('role', 'link');
    row.setAttribute('aria-label', `فتح ${label} في المشغل`);
    row.innerHTML = `
      <span class="story-episode-label">${esc(label)}</span>
      ${newBadge}
      <div class="story-episode-actions">
        <button type="button" class="story-episode-icon story-episode-watch"
          aria-label="مشاهدة ${esc(label)}" title="مشاهدة الحلقة">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path>
            <circle cx="12" cy="12" r="3.2"></circle>
          </svg>
        </button>
        <button type="button" class="story-episode-icon story-episode-comments"
          aria-label="تعليقات ${esc(label)}" title="التعليقات">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="bubble" d="M3 3.5h18v14H9l-5.5 4v-4H3z"></path>
            <path class="bubble-lines" d="M7 8h10M7 11.5h10M7 15h6"></path>
          </svg>
        </button>
      </div>
    `;

    const openEpisode = () => navigateToPart(story.id, Number(part.sort_order));
    row.addEventListener('click', event => {
      if (event.target.closest('.story-episode-comments')) return;
      openEpisode();
    });
    row.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
        event.preventDefault();
        openEpisode();
      }
    });
    row.querySelector('.story-episode-watch').addEventListener('click', event => {
      event.stopPropagation();
      openEpisode();
    });
    row.querySelector('.story-episode-comments').addEventListener('click', event => {
      event.stopPropagation();
      setStoryDetailTab('comments');
      $('storyCommentsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.appendChild(row);
  });
}

async function loadPublicParts(story) {
  const root = $('storyPartsPublic');
  if (!root) return;

  root.hidden = true;
  root.innerHTML = '';
  currentParts = [];

  if (!API) {
    currentParts = combineStoryParts(story, []);
    renderStoryEpisodes(story);
    return;
  }

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
  const listenDate = $('listenPublishDate');
  if (listenDate) listenDate.textContent = formatStoryDate(story.created_at);

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
$('backCategories').onclick = () => navigateRoute('categories');

$('allStoriesTab').onclick = () => setCategoryTab('all');
$('topStoriesTab').onclick = () => setCategoryTab('top');

$('closePlayer').onclick = () => {
  $('audioPlayer').pause();
  const origin = getStoryOrigin();
  const match = origin.match(/^\/category\/([^/]+)$/);
  if (match) navigateRoute('category', decodeURIComponent(match[1]));
  else if (origin === '/categories/') navigateRoute('categories');
  else navigateRoute('home');
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
  $('descriptionToggle').querySelector('span:first-child').textContent = '';
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
document.querySelectorAll('[data-story-list-view]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const key = link.dataset.storyListView;
    setMenu(false);
    showLibrary('storylist-' + key);
    const url = new URL(location.href); url.searchParams.set('list', key); history.replaceState({}, '', url.pathname + url.search + url.hash);
  });
});
$('backFromLibrary').onclick = () => { $('librarySection').hidden = true; const url = new URL(location.href); url.searchParams.delete('list'); history.replaceState({}, '', url.pathname + url.search + url.hash); navigateRoute('home'); };
$('storySearchInput').addEventListener('input', renderLibrary);

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

  document.body.classList.toggle('categories-route', /^\/categories\/?$/.test(path));
  const pageName = path.split('/').filter(Boolean).pop() || '';
  const requestedList = new URLSearchParams(location.search).get('list');
  if (requestedList && STORY_LIST_OPTIONS.some(item => item.key === requestedList)) { showLibrary('storylist-' + requestedList); return; }
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

  if (/^\/categories\/?$/.test(path)) {
    showPage('home');
    setHomeTab('categories');
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
    const storyOrigin = getStoryOrigin();
    setHomeTab(/^\/category\//.test(storyOrigin) || storyOrigin.startsWith('/categories') ? 'categories' : 'latest');
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

  setHomeTab('latest');
  showPage('home');
}


// Anonymous comments module. The local visitor token is an ownership key, not an account.
const COMMENT_VISITOR_KEY = 'qisas_comment_visitor_v1';
const COMMENT_NAME_KEY = 'qisas_comment_name_v1';
const COMMENT_AVATAR_KEY = 'qisas_comment_avatar_v1';
let commentVisitorId = localStorage.getItem(COMMENT_VISITOR_KEY) || '';
if (!/^[a-zA-Z0-9-]{20,80}$/.test(commentVisitorId)) {
  commentVisitorId = (crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  localStorage.setItem(COMMENT_VISITOR_KEY, commentVisitorId);
}
let commentsData = [];
let commentsVisible = 5;
let selectedCommentAvatar = localStorage.getItem(COMMENT_AVATAR_KEY) || 'avatar-girl-1';
let replyingToComment = null;
let editingCommentId = null;
const commentAvatarIds = ['avatar-girl-1','avatar-boy-1','avatar-girl-2','avatar-boy-2','avatar-girl-3','avatar-boy-3'];
function commentAvatarUrl(value) { const id=commentAvatarIds.includes(value)?value:'avatar-girl-1'; return `/assets/avatars/${id}.webp`; }
function commentApi(path) { return API.replace(/\/$/, '') + path; }
function commentHeaders() { return {'Content-Type':'application/json'}; }
function commentTime(value) {
  if (!value) return 'الآن';
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ','T') + 'Z');
  if (Number.isNaN(date.getTime())) return 'الآن';
  const mins = Math.max(0, Math.floor((Date.now()-date.getTime())/60000));
  if (mins < 1) return 'الآن'; if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins/60); if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours/24)} يوم`;
}
function avatarMarkup(value, small=false) { return `<span class="comment-avatar${small?' comment-avatar-small':''}"><img src="${commentAvatarUrl(value)}" alt="الصورة الرمزية" loading="lazy"></span>`; }
function setCommentMessage(message, error=false) { const el=$('commentFormMsg'); if(el){el.textContent=message;el.classList.toggle('is-error',error);} }
async function loadComments() {
  const root=$('commentsList'); if(!root || !currentStory || !API) { if(root)root.innerHTML='<p class="comments-empty">التعليقات غير متاحة حاليًا.</p>'; return; }
  root.innerHTML='<p class="comments-empty">جارٍ تحميل التعليقات…</p>';
  try {
    const res=await fetch(commentApi('/api/story/'+encodeURIComponent(currentStory.id)+'/comments'),{headers:{'X-Visitor-ID':commentVisitorId}});
    const data=await res.json(); if(!res.ok)throw Error(data.error||'تعذر تحميل التعليقات');
    commentsData=Array.isArray(data.comments)?data.comments:[];
    commentsVisible=5; renderComments();
  } catch(e) { root.innerHTML='<p class="comments-empty">تعذر تحميل التعليقات. تحقق من اتصال الخادم.</p>'; }
}
function renderComments() {
  const root=$('commentsList'); if(!root)return;
  const sort=$('commentsSort')?.value||'latest';
  const all=commentsData.slice();
  const top=all.filter(c=>!c.parent_id);
  if(sort==='popular')top.sort((a,b)=>(Number(b.likes_count)||0)-(Number(a.likes_count)||0));
  else top.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const total=all.filter(c=>!c.parent_id).length;
  $('commentsCount').textContent=total.toLocaleString('ar');
  const visible=top.slice(0,commentsVisible);
  if(!visible.length) { root.innerHTML='<p class="comments-empty">كن أول من يشارك رأيه في هذه القصة ✨</p>'; }
  else root.innerHTML=visible.map(c=>{
    const replies=all.filter(r=>String(r.parent_id)===String(c.id)).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    const mine=!!c.is_mine;
    return `<article class="comment-item" data-comment-id="${esc(c.id)}">${avatarMarkup(c.avatar)}<div class="comment-body"><div class="comment-author-line"><strong>${esc(c.display_name||'زائر')}</strong><time>${esc(commentTime(c.created_at))}</time>${mine?`<button class="comment-menu" data-comment-action="menu" data-id="${esc(c.id)}" type="button" aria-label="خيارات التعليق">⋮</button>`:''}</div><p class="comment-content">${esc(c.content)}</p>${mine?`<div class="comment-owner-actions" id="comment-owner-${esc(c.id)}" hidden><button data-comment-action="edit" data-id="${esc(c.id)}" type="button">تعديل</button><button data-comment-action="delete" data-id="${esc(c.id)}" type="button">حذف</button></div>`:''}<div class="comment-actions"><button type="button" class="comment-like${c.liked_by_me?' liked':''}" data-comment-action="like" data-id="${esc(c.id)}" aria-label="إعجاب">♥ <span>${Number(c.likes_count)||0}</span></button><button type="button" data-comment-action="reply" data-id="${esc(c.id)}">رد</button></div>${replies.map(r=>`<div class="comment-reply">${avatarMarkup(r.avatar,true)}<div><div class="comment-author-line"><strong>${esc(r.display_name||'زائر')}</strong><time>${esc(commentTime(r.created_at))}</time>${!!r.is_mine?`<button class="comment-menu" data-comment-action="menu" data-id="${esc(r.id)}" type="button">⋮</button>`:''}</div><p>${esc(r.content)}</p>${!!r.is_mine?`<div class="comment-owner-actions" id="comment-owner-${esc(r.id)}" hidden><button data-comment-action="edit" data-id="${esc(r.id)}" type="button">تعديل</button><button data-comment-action="delete" data-id="${esc(r.id)}" type="button">حذف</button></div>`:''}<div class="comment-actions"><button type="button" class="comment-like${r.liked_by_me?' liked':''}" data-comment-action="like" data-id="${esc(r.id)}">♥ <span>${Number(r.likes_count)||0}</span></button></div></div></div>`).join('')}</div></article>`;
  }).join('');
  $('commentsMore').hidden=top.length<=commentsVisible;
  $('commentsMore').textContent=`عرض المزيد من التعليقات (${Math.max(0,top.length-commentsVisible).toLocaleString('ar')}) ⌄`;
}
function selectCommentAvatar(value) {
  selectedCommentAvatar=commentAvatarIds.includes(value)?value:'avatar-girl-1'; localStorage.setItem(COMMENT_AVATAR_KEY,selectedCommentAvatar);
  document.querySelectorAll('.avatar-choice').forEach(b=>b.classList.toggle('selected',b.dataset.avatar===selectedCommentAvatar));
  const preview=$('commentAvatarPreview'); if(preview) preview.src=commentAvatarUrl(selectedCommentAvatar);
  const toggle=$('commentAvatarToggle'); if(toggle) toggle.setAttribute('aria-label','تغيير الصورة الرمزية');
}
function toggleCommentAvatarPicker(force) {
  const popover=$('commentAvatarPopover'), toggle=$('commentAvatarToggle'); if(!popover||!toggle)return;
  const open=typeof force==='boolean'?force:popover.hidden; popover.hidden=!open; toggle.setAttribute('aria-expanded',String(open));
}
function setReplyMode(comment) { replyingToComment=comment; editingCommentId=null; $('commentText').value=''; $('commentText').focus(); $('commentSubmit').textContent='➤'; setCommentMessage('تكتب ردًا على تعليق. اكتب ردك ثم اضغط إرسال.'); }
async function submitComment(event) {
  event.preventDefault(); if(!currentStory)return;
  const content=$('commentText').value.trim(); if(!content)return setCommentMessage('اكتب تعليقك أولًا.',true);
  const displayName=$('commentName').value.trim()||'زائر';
  localStorage.setItem(COMMENT_NAME_KEY,displayName); localStorage.setItem(COMMENT_AVATAR_KEY,selectedCommentAvatar);
  const editId=editingCommentId;
  try {
    $('commentSubmit').disabled=true;
    const path=editId?'/api/comment/'+encodeURIComponent(editId):'/api/story/'+encodeURIComponent(currentStory.id)+'/comments';
    const body=editId?{visitor_id:commentVisitorId,content}:{visitor_id:commentVisitorId,content,display_name:displayName,avatar:selectedCommentAvatar,parent_id:replyingToComment};
    const res=await fetch(commentApi(path),{method:editId?'PUT':'POST',headers:commentHeaders(),body:JSON.stringify(body)});
    const data=await res.json(); if(!res.ok)throw Error(data.error||'تعذر نشر التعليق');
    $('commentText').value=''; replyingToComment=null; editingCommentId=null; $('commentSubmit').textContent='➤';
    setCommentMessage(editId?'تم تعديل تعليقك.':'تم نشر تعليقك.'); await loadComments();
  } catch(e) { setCommentMessage(e.message||'تعذر نشر التعليق.',true); }
  finally { $('commentSubmit').disabled=false; }
}
async function handleCommentAction(event) {
  const button=event.target.closest('[data-comment-action]'); if(!button)return;
  const id=button.dataset.id, action=button.dataset.commentAction;
  const comment=commentsData.find(c=>String(c.id)===String(id)); if(!comment)return;
  if(action==='menu') { const menu=$('comment-owner-'+id); if(menu)menu.hidden=!menu.hidden; return; }
  if(action==='reply') { setReplyMode(id); return; }
  if(action==='edit') { editingCommentId=id; replyingToComment=null; $('commentText').value=comment.content; $('commentText').focus(); $('commentSubmit').textContent='حفظ'; setCommentMessage('عدّل تعليقك ثم اضغط حفظ.'); return; }
  if(action==='delete') { if(!confirm('هل تريد حذف تعليقك؟'))return; try { const res=await fetch(commentApi('/api/comment/'+encodeURIComponent(id)),{method:'DELETE',headers:commentHeaders(),body:JSON.stringify({visitor_id:commentVisitorId})}); const d=await res.json();if(!res.ok)throw Error(d.error||'تعذر الحذف');setCommentMessage('تم حذف تعليقك.');await loadComments(); }catch(e){setCommentMessage(e.message,true);}return; }
  if(action==='like') { try { const res=await fetch(commentApi('/api/comment/'+encodeURIComponent(id)+'/like'),{method:'POST',headers:commentHeaders(),body:JSON.stringify({visitor_id:commentVisitorId})}); const d=await res.json();if(!res.ok)throw Error(d.error||'تعذر تسجيل الإعجاب');comment.likes_count=d.likes_count;comment.liked_by_me=d.liked;renderComments(); }catch(e){setCommentMessage(e.message,true);} }
}
function setHomeTab(tab) {
  const showLatest = tab === 'latest';
  const latestTab = $('latestTab');
  const categoriesTab = $('categoriesTab');
  const latestPanel = $('latestPanel');
  const categoriesPanel = $('categoriesPanel');
  if (!latestTab || !categoriesTab || !latestPanel || !categoriesPanel) return;

  latestTab.classList.toggle('active', showLatest);
  categoriesTab.classList.toggle('active', !showLatest);
  latestTab.setAttribute('aria-selected', String(showLatest));
  categoriesTab.setAttribute('aria-selected', String(!showLatest));
  latestPanel.hidden = !showLatest;
  categoriesPanel.hidden = showLatest;
}

$('latestTab')?.addEventListener('click', () => navigateRoute('home'));
$('categoriesTab')?.addEventListener('click', () => navigateRoute('categories'));

$('viewToggle')?.addEventListener('click', () => { const grid = $('latestStories'); if (!grid) return; const list = grid.classList.toggle('list-mode'); $('viewToggle').textContent = list ? '▦' : '☷'; $('viewToggle').setAttribute('aria-label', list ? 'عرض شبكي' : 'عرض قائمة'); });
$('commentForm')?.addEventListener('submit',submitComment);
$('commentAvatarToggle')?.addEventListener('click',()=>toggleCommentAvatarPicker());
$('commentAvatarPicker')?.addEventListener('click',e=>{const b=e.target.closest('[data-avatar]');if(b){selectCommentAvatar(b.dataset.avatar);toggleCommentAvatarPicker(false);}});
$('commentsList')?.addEventListener('click',handleCommentAction);
$('commentsSort')?.addEventListener('change',renderComments);
$('commentsMore')?.addEventListener('click',()=>{commentsVisible+=5;renderComments();});
if($('commentName'))$('commentName').value=localStorage.getItem(COMMENT_NAME_KEY)||'';
selectCommentAvatar(selectedCommentAvatar);



// تبويبات صفحة القصة المستوحاة من التصميم المرجعي
function setStoryDetailTab(tab) {
  document.querySelectorAll('[data-detail-tab]').forEach(button => {
    const active = button.dataset.detailTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const commentsPanel = $('storyCommentsPanel');
  const episodesPanel = $('storyEpisodesPanel');
  const card = document.querySelector('#playerSection .detail-card');
  if (commentsPanel) commentsPanel.hidden = tab !== 'comments';
  if (episodesPanel) episodesPanel.hidden = tab !== 'episodes';
  if (card) card.hidden = tab !== 'details';
  if (tab === 'episodes' && currentStory) renderStoryEpisodes(currentStory);
  if (tab === 'comments') $('storyCommentsPanel')?.scrollIntoView({behavior:'smooth', block:'start'});
}
document.querySelectorAll('[data-detail-tab]').forEach(button => button.addEventListener('click', () => setStoryDetailTab(button.dataset.detailTab)));
$('commentsTabQuick')?.addEventListener('click', () => setStoryDetailTab('comments'));
$('detailHeartQuick')?.addEventListener('click', () => { if (currentStory) { toggleLibrary('favorites', currentStory.id); renderLibraryButtons(); } });
$('detailListButton')?.addEventListener('click', openStoryList);
document.querySelectorAll('[data-close-story-list]').forEach(button => button.addEventListener('click', closeStoryList));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeStoryList(); });

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
