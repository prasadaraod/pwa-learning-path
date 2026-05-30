/**
 * app.js — Weather Lens main application
 *
 * Responsibilities:
 *  1. Register the Service Worker
 *  2. Handle the beforeinstallprompt event (custom install button)
 *  3. Show online/offline status
 *  4. Search cities via Open-Meteo Geocoding API
 *  5. Fetch weather via Open-Meteo Weather API
 *  6. Persist favourites and weather cache via IndexedDB
 *  7. Register for Background Sync when saving offline
 */

import { favouritesDB, weatherCacheDB } from './db.js';

// ─── OPEN-METEO API (no API key required) ────────────────────────────────────
const GEO_API     = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail'
};

const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️'
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;
let currentCity           = null;
let swRegistration        = null;

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const $searchInput      = document.getElementById('search-input');
const $searchResults    = document.getElementById('search-results');
const $weatherCard      = document.getElementById('weather-card');
const $weatherContent   = document.getElementById('weather-content');
const $offlineBanner    = document.getElementById('offline-banner');
const $installBtn       = document.getElementById('install-btn');
const $installBanner    = document.getElementById('install-banner');
const $favList          = document.getElementById('favourites-list');
const $updateBanner     = document.getElementById('update-banner');
const $updateBtn        = document.getElementById('update-btn');
const $swStatus         = document.getElementById('sw-status');

// ─── 1. SERVICE WORKER REGISTRATION ──────────────────────────────────────────
/**
 * Register sw.js from the root scope.
 * We listen for:
 *  - `updatefound`    → a new SW version was found
 *  - `statechange`    → the new SW finished installing (ready to activate)
 *  - `controllerchange` → the new SW took over; reload to get fresh assets
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setSwStatus('not-supported', 'Service Workers not supported in this browser');
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', {
      scope: '/'
    });

    console.log('[App] Service Worker registered. Scope:', swRegistration.scope);
    setSwStatus('registered', 'Service Worker registered ✓');

    // ── Listen for updates ──────────────────────────────────────────────
    swRegistration.addEventListener('updatefound', () => {
      const newWorker = swRegistration.installing;
      console.log('[App] New Service Worker found, state:', newWorker.state);

      newWorker.addEventListener('statechange', () => {
        console.log('[App] New SW state:', newWorker.state);

        // New SW installed and waiting — show "Update available" banner
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });

    // ── Controller changed → page reload needed ─────────────────────────
    // After the user clicks "Update", the new SW activates and
    // fires controllerchange. We reload so the page uses fresh assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[App] Controller changed — reloading for fresh assets');
      window.location.reload();
    });

    // ── Check if an update is already waiting on first load ─────────────
    if (swRegistration.waiting) {
      showUpdateBanner();
    }

  } catch (error) {
    console.error('[App] Service Worker registration failed:', error);
    setSwStatus('error', `SW registration failed: ${error.message}`);
  }
}

function setSwStatus(state, message) {
  if (!$swStatus) return;
  $swStatus.dataset.state = state;
  $swStatus.querySelector('.sw-message').textContent = message;
}

function showUpdateBanner() {
  if ($updateBanner) $updateBanner.classList.remove('hidden');
}

// ─── 2. INSTALL PROMPT (A2HS) ─────────────────────────────────────────────
/**
 * The browser fires `beforeinstallprompt` when the PWA criteria are met
 * (HTTPS, manifest, SW). We capture the event, prevent the default browser
 * banner, and show our own custom install button.
 */
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  console.log('[App] Install prompt captured — showing custom install UI');
  if ($installBtn) $installBtn.classList.remove('hidden');
  if ($installBanner) $installBanner.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  console.log('[App] PWA was installed!');
  deferredInstallPrompt = null;
  if ($installBtn) $installBtn.classList.add('hidden');
  if ($installBanner) $installBanner.classList.add('hidden');
});

async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log('[App] Install prompt outcome:', outcome);
  deferredInstallPrompt = null;
}

// ─── 3. ONLINE / OFFLINE STATUS ──────────────────────────────────────────────
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  if ($offlineBanner) {
    $offlineBanner.classList.toggle('hidden', isOnline);
  }
  document.body.dataset.online = isOnline;
  console.log('[App] Network status:', isOnline ? 'online' : 'offline');
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ─── 4. CITY SEARCH ──────────────────────────────────────────────────────────
let searchTimeout = null;

async function searchCities(query) {
  if (query.length < 2) {
    clearSearchResults();
    return;
  }

  try {
    const url = `${GEO_API}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.results?.length) {
      renderSearchResults(data.results);
    } else {
      renderSearchResults([]);
    }
  } catch (error) {
    console.warn('[App] City search failed (possibly offline):', error);
    renderSearchResults([], 'Search unavailable offline');
  }
}

function renderSearchResults(cities, message = '') {
  if (!$searchResults) return;
  $searchResults.innerHTML = '';
  $searchResults.classList.remove('hidden');

  if (message || cities.length === 0) {
    $searchResults.innerHTML = `<li class="no-results">${message || 'No cities found'}</li>`;
    return;
  }

  cities.forEach(city => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.innerHTML = `
      <span class="city-name">${city.name}</span>
      <span class="city-meta">${[city.admin1, city.country].filter(Boolean).join(', ')}</span>
    `;
    li.addEventListener('click', () => selectCity(city));
    $searchResults.appendChild(li);
  });
}

function clearSearchResults() {
  if ($searchResults) {
    $searchResults.innerHTML = '';
    $searchResults.classList.add('hidden');
  }
}

// ─── 5. WEATHER FETCHING ─────────────────────────────────────────────────────
async function selectCity(city) {
  currentCity = city;
  clearSearchResults();
  if ($searchInput) $searchInput.value = `${city.name}, ${city.country}`;
  await loadWeather(city);
}

async function loadWeather(city) {
  showWeatherLoading();

  // ── Try IndexedDB cache first if offline ──────────────────────────────
  if (!navigator.onLine) {
    const cached = await weatherCacheDB.get(city.id);
    if (cached) {
      console.log('[App] Serving weather from IndexedDB cache (offline)');
      renderWeather(cached, city, true);
      return;
    }
  }

  try {
    const params = new URLSearchParams({
      latitude:              city.latitude,
      longitude:             city.longitude,
      current:               'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
      hourly:                'temperature_2m,weather_code',
      daily:                 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone:              'auto',
      forecast_days:         '7',
      wind_speed_unit:       'kmh',
      temperature_unit:      'celsius'
    });

    const res  = await fetch(`${WEATHER_API}?${params}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();

    // Persist to IndexedDB for offline use
    await weatherCacheDB.set(city.id, data);
    renderWeather(data, city, false);

  } catch (error) {
    console.error('[App] Weather fetch failed:', error);

    // Fall back to IndexedDB cache
    const cached = await weatherCacheDB.get(city.id, Infinity); // no expiry on error
    if (cached) {
      console.log('[App] Serving stale weather from IndexedDB after fetch error');
      renderWeather(cached, city, true);
    } else {
      showWeatherError(city.name);
    }
  }
}

// ─── 6. RENDER WEATHER ───────────────────────────────────────────────────────
function renderWeather(data, city, isFromCache) {
  if (!$weatherContent) return;
  $weatherCard.classList.remove('hidden');

  const c    = data.current;
  const code = c.weather_code;
  const icon = WMO_ICONS[code]  || '🌡️';
  const desc = WMO_CODES[code]  || 'Unknown';

  // Build 7-day forecast
  const forecastHTML = data.daily.time.map((date, i) => {
    const dayCode = data.daily.weather_code[i];
    const dayName = i === 0 ? 'Today' :
                    new Date(date).toLocaleDateString('en', { weekday: 'short' });
    return `
      <div class="forecast-day">
        <span class="forecast-name">${dayName}</span>
        <span class="forecast-icon">${WMO_ICONS[dayCode] || '🌡️'}</span>
        <span class="forecast-range">
          <span class="t-max">${Math.round(data.daily.temperature_2m_max[i])}°</span>
          <span class="t-min">${Math.round(data.daily.temperature_2m_min[i])}°</span>
        </span>
      </div>`;
  }).join('');

  $weatherContent.innerHTML = `
    <div class="weather-header">
      <div class="city-label">${city.name}, ${city.country}</div>
      ${isFromCache ? '<span class="cache-badge">📦 Cached</span>' : ''}
    </div>

    <div class="current-weather">
      <div class="weather-icon-large">${icon}</div>
      <div class="temp-display">${Math.round(c.temperature_2m)}<span class="unit">°C</span></div>
      <div class="weather-desc">${desc}</div>
      <div class="feels-like">Feels like ${Math.round(c.apparent_temperature)}°C</div>
    </div>

    <div class="weather-details">
      <div class="detail-item">
        <span class="detail-label">Humidity</span>
        <span class="detail-value">${c.relative_humidity_2m}%</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Wind</span>
        <span class="detail-value">${Math.round(c.wind_speed_10m)} km/h</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Condition</span>
        <span class="detail-value">${desc}</span>
      </div>
    </div>

    <div class="forecast-strip">${forecastHTML}</div>

    <div class="weather-actions">
      <button class="btn-fav" id="fav-btn" onclick="toggleFavourite()">
        ☆ Save city
      </button>
    </div>
  `;

  updateFavBtn();
  $weatherCard.classList.remove('loading');
}

function showWeatherLoading() {
  if ($weatherCard) {
    $weatherCard.classList.remove('hidden');
    $weatherCard.classList.add('loading');
  }
  if ($weatherContent) {
    $weatherContent.innerHTML = '<div class="loading-spinner">Fetching weather…</div>';
  }
}

function showWeatherError(cityName) {
  if ($weatherContent) {
    $weatherContent.innerHTML = `
      <div class="error-state">
        <span class="error-icon">📡</span>
        <p>Could not load weather for <strong>${cityName}</strong>.</p>
        <p class="error-sub">No cached data available. Connect to the internet and try again.</p>
      </div>`;
  }
}

// ─── 7. FAVOURITES ───────────────────────────────────────────────────────────
async function toggleFavourite() {
  if (!currentCity) return;

  const isSaved = await favouritesDB.has(currentCity.id);
  if (isSaved) {
    await favouritesDB.remove(currentCity.id);
  } else {
    await favouritesDB.add(currentCity);

    // If offline, register a background sync so the fav is persisted to server later
    if (!navigator.onLine && swRegistration && 'sync' in swRegistration) {
      await swRegistration.sync.register('sync-favourites');
      console.log('[App] Background sync registered for favourites');
    }
  }

  updateFavBtn();
  renderFavourites();
}

async function updateFavBtn() {
  const btn = document.getElementById('fav-btn');
  if (!btn || !currentCity) return;
  const saved = await favouritesDB.has(currentCity.id);
  btn.textContent = saved ? '★ Saved' : '☆ Save city';
  btn.classList.toggle('saved', saved);
}

async function renderFavourites() {
  if (!$favList) return;
  const cities = await favouritesDB.getAll();
  $favList.innerHTML = '';

  if (!cities.length) {
    $favList.innerHTML = '<li class="no-favs">No saved cities yet</li>';
    return;
  }

  cities.forEach(city => {
    const li = document.createElement('li');
    li.className = 'fav-item';
    li.innerHTML = `
      <button class="fav-load" onclick="window._loadFav(${city.id})">
        ${city.name}, ${city.country}
      </button>
      <button class="fav-remove" onclick="window._removeFav(${city.id})" aria-label="Remove">✕</button>
    `;
    $favList.appendChild(li);
  });
}

window._loadFav = async id => {
  const cities = await favouritesDB.getAll();
  const city   = cities.find(c => c.id === id);
  if (city) selectCity(city);
};

window._removeFav = async id => {
  await favouritesDB.remove(id);
  if (currentCity?.id === id) {
    document.getElementById('fav-btn')?.classList.remove('saved');
    document.getElementById('fav-btn') && (document.getElementById('fav-btn').textContent = '☆ Save city');
  }
  renderFavourites();
};

// ─── EVENT WIRING ─────────────────────────────────────────────────────────────
$searchInput?.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchCities(e.target.value.trim()), 350);
});

$searchInput?.addEventListener('keydown', e => {
  if (e.key === 'Escape') clearSearchResults();
});

document.addEventListener('click', e => {
  if (!e.target.closest('#search-container')) clearSearchResults();
});

$installBtn?.addEventListener('click', triggerInstall);
document.getElementById('install-banner-btn')?.addEventListener('click', triggerInstall);

$updateBtn?.addEventListener('click', () => {
  if (swRegistration?.waiting) {
    // Send the "skip waiting" message to the new SW
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
});

// Make toggleFavourite available globally (called from inline onclick)
window.toggleFavourite = toggleFavourite;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  updateOnlineStatus();
  await registerServiceWorker();
  await renderFavourites();
  await weatherCacheDB.prune(); // clean up old cache entries on load

  console.log('[App] Weather Lens ready');
}

init();
