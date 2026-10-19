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
let currentPart = null;
let activeProgressKey = null;
let isSeeking = false;
let routeRequest = 0;

const progressKey = id => 'qisas_audio_progress_' + String(id);
const partProgressKey = (storyId, partId) => 'qisas_audio_progress_' + String(storyId) + '_part_' + String(partId);

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
    listen: '/listen/',
    parts: '/parts/'
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
  $('partsSection').hidden = page !== 'parts';

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
