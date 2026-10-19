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
let isSeeking = false;
let routeRequest = 0;

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

function routePath(page, id) {
  const routes = {
    home: '/',
    category: '/category/',
    story: '/story/',
    listen: '/listen/'
  };

  return routes[page] +
    (page === 'home' ? '' : encodeURIComponent(String(id)));
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
  $('homeSections').hidden = page !== 'home';
  $('storySection').hidden = page !== 'category';
  $('playerSection').hidden = page !== 'story';
  $('listenSection').hidden = page !== 'listen';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderCategories() {
  const categories = catalog.categories.length
    ? catalog.categories
    : DEFAULT_CATEGORIES.map(item => ({ ...item, image_path: '' }));

  $('categoryCount').textContent =
    categories.length + ' تصنيفات';

  $('categories').innerHTML = categories.map(category => {
    const image = category.image_path || category.image_url;

    return `
      <button class="category" data-category="${esc(category.id)}">
        ${
          image
            ? `<img src="${esc(mediaUrl(image))}"
                    alt="${esc(category.title)}"
                    loading="lazy"
                    decoding="async">`
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
      ${
        rank
          ? `<span class="story-rank" aria-label="الترتيب ${rank}">${rank}</span>`
          : ''
      }

      <img
        class="story-cover"
        src="${esc(mediaUrl(cover))}"
        alt="${esc(story.title)}"
        loading="lazy"
        decoding="async"
        onerror="this.style.visibility='hidden'"
      >

      <div class="story-info">
        <h3>${esc(story.title)}</h3>

        <div class="story-meta">
          <img class="story-brand-logo" src="/logo.png" alt="">
          <span class="story-brand-name">قصص وروايات صوتية</span>
          <span class="story-views">
            ${(Number(story.views) || 0).toLocaleString('ar')} مشاهدة
          </span>
        </div>
      </div>
    </article>
  `;
}

function bindStoryButtons(root = document) {
  root.querySelectorAll('[data-story-card]').forEach(element => {
    element.onclick = () => openStory(element.dataset.storyCard);

    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');

    element.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openStory(element.dataset.storyCard);
      }
    };
  });
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

async function openStory(id, fromRoute = false) {
  const story = catalog.stories.find(
    item => String(item.id) === String(id)
  );

  if (!story) {
    showNotice('لم يتم العثور على القصة.');
    return;
  }

  const thisRequest = ++routeRequest;
  currentStory = story;

  const audio = $('audioPlayer');

  // لا يبدأ الصوت تلقائيًا عند فتح القصة.
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

  $('playerMeta').textContent =
    (Number(story.views) || 0).toLocaleString('ar') + ' مشاهدة';

  audio.src = mediaUrl(story.audio_path);
  audio.load();

  audio.addEventListener('loadedmetadata', function restoreProgress() {
    if (
      !currentStory ||
      String(currentStory.id) !== String(story.id)
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
      audio.currentTime = saved;
    }

    syncAudio();
  }, { once: true });

  renderRecommendations(story);
  showPage('story');

  const desiredPage = (
    fromRoute &&
    (
      location.pathname.startsWith('/listen/') ||
      location.hash.startsWith('#listen=')
    )
  ) ? 'listen' : 'story';

  const desiredPath = routePath(desiredPage, story.id);

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

  if (API) {
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
    } catch {
      // فشل تسجيل المشاهدة لا يمنع فتح القصة.
    }
  }
}

// التوصيات: عشوائية من جميع التصنيفات ما عدا القصة الحالية.
function renderRecommendations(story) {
  const pool = catalog.stories.filter(
    item => String(item.id) !== String(story.id)
  );

  // خلط عشوائي للقائمة.
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

function fmt(time) {
  if (!Number.isFinite(time) || time < 0) return '0:00';

  const seconds = Math.floor(time);

  return Math.floor(seconds / 60) + ':' +
    String(seconds % 60).padStart(2, '0');
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

  $('currentTime').textContent = fmt(audio.currentTime);
  $('duration').textContent = fmt(audio.duration);

  if (
    !isSeeking &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  ) {
    $('seekBar').value = String(
      Math.round((audio.currentTime / audio.duration) * 1000)
    );
  }
}

function seekToSlider() {
  const audio = $('audioPlayer');
  const duration = audio.duration;

  if (!Number.isFinite(duration) || duration <= 0) return;

  const value = Number($('seekBar').value);

  if (Number.isFinite(value)) {
    audio.currentTime = Math.max(
      0,
      Math.min(duration, (value / 1000) * duration)
    );
  }

  $('currentTime').textContent = fmt(audio.currentTime);
}

const seekBar = $('seekBar');

// تحسين السحب باللمس والماوس.
seekBar.addEventListener('pointerdown', () => {
  isSeeking = true;
});

seekBar.addEventListener('input', () => {
  isSeeking = true;
  seekToSlider();
});

function finishSeeking() {
  if (!isSeeking) return;

  seekToSlider();
  isSeeking = false;
  syncAudio();
}

seekBar.addEventListener('pointerup', finishSeeking);
seekBar.addEventListener('pointercancel', finishSeeking);
seekBar.addEventListener('change', finishSeeking);

window.addEventListener('pointerup', finishSeeking);
window.addEventListener('pointercancel', finishSeeking);

$('backCategories').onclick = () => navigateRoute('home');

$('allStoriesTab').onclick = () => setCategoryTab('all');
$('topStoriesTab').onclick = () => setCategoryTab('top');

$('closePlayer').onclick = () => {
  $('audioPlayer').pause();

  if (selected) {
    navigateRoute('category', selected);
  } else {
    navigateRoute('home');
  }
};

$('listenStory').onclick = () => {
  if (!currentStory) return;

  $('audioPlayer').pause();
  navigateRoute('listen', currentStory.id);
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

// التشغيل يبدأ فقط عند ضغط المستخدم على الزر.
$('playPause').onclick = async () => {
  const audio = $('audioPlayer');

  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      showNotice('تعذر تشغيل الصوت. تحققي من اتصال الإنترنت وملف القصة.');
    }
  } else {
    audio.pause();
  }
};

$('seekBack').onclick = () => {
  const audio = $('audioPlayer');

  audio.currentTime = Math.max(0, audio.currentTime - 15);
};

$('seekForward').onclick = () => {
  const audio = $('audioPlayer');

  if (Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(
      audio.duration,
      audio.currentTime + 15
    );
  }
};

$('audioPlayer').addEventListener('timeupdate', () => {
  syncAudio();

  if (currentStory && !$('audioPlayer').ended) {
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
  $('seekBar').value = 0;
  $('audioWaveform').classList.remove('playing');

  if (currentStory) {
    localStorage.removeItem(progressKey(currentStory.id));
  }
});

$('playbackSpeed').addEventListener('change', event => {
  $('audioPlayer').playbackRate = Number(event.target.value) || 1;
});

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
$('closeMenu').onclick = () => setMenu(false);
menuOverlay.onclick = () => setMenu(false);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setMenu(false);
});

document.querySelectorAll('.side-links a').forEach(link => {
  link.addEventListener('click', () => setMenu(false));
});

async function restoreRoute() {
  const path = location.pathname;
  const hash = location.hash;

  let match = path.match(/^\/category\/([^/]+)\/?$/);

  if (match) {
    openCategory(decodeURIComponent(match[1]), true);
    return;
  }

  match = path.match(/^\/(story|listen)\/([^/]+)\/?$/);

  if (match) {
    const page = match[1];
    const id = decodeURIComponent(match[2]);

    await openStory(id, true);

    if (page === 'listen') {
      showPage('listen');
      $('audioPlayer').pause();
    }

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
        showPage('listen');
        $('audioPlayer').pause();
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

// هذه الإجراءات لا تمنع تنزيل الصور أو الصوت منعًا كاملًا.
document.addEventListener('contextmenu', event => {
  if (
    event.target.closest(
      'img, audio, .story, .player-section, .listen-section'
    )
  ) {
    event.preventDefault();
  }
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
