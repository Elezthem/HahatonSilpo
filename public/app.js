'use strict';

// ═══ State ═══════════════════════════════════════════════
let inventoryData = null;
let networkData = null;
let charityRequests = [];
let searchDebounceTimer = null;
let trendsData = null;
let decisionsData = {};
let charityItemsData = [];
let currentMcpPlan = null;
let agentPlanRunning = false;
let dashboardPromise = null;
let dashboardLoadedAt = 0;
let inventoryQuickFilter = 'all';
let activeBasketPresetId = null;

const basketPresets = [
  { id: 'men', icon: '🧔', title: 'Кошик для чоловіків', subtitle: 'Ситно й практично', categories: ['М\'ясо', 'Ковбаси', 'Хлібобулочні', 'Напої'], keywords: ['ковбас', 'сир', 'хліб', 'бургер', 'сосиск', 'стік', 'паста'], budget: 900, limit: 6 },
  { id: 'women', icon: '👩', title: 'Кошик для жінок', subtitle: 'Легкий щоденний набір', categories: ['Молочні продукти', 'Фрукти', 'Овочі', 'Кондитерські'], keywords: ['йогурт', 'кефір', 'сир', 'яблук', 'банан', 'салат', 'печиво'], budget: 850, limit: 6 },
  { id: 'budget', icon: '💸', title: 'Кошик для бідних', subtitle: 'Максимум користі за мінімум грошей', categories: ['Бакалія', 'Хлібобулочні', 'Овочі', 'Молочні продукти'], keywords: ['греч', 'рис', 'макарон', 'хліб', 'молоко', 'картоп', 'капуст'], budget: 550, limit: 7, sort: 'priceAsc' },
  { id: 'payday', icon: '💰', title: 'Кошик після зарплати', subtitle: 'Трохи комфорту й смаколиків', categories: ['М\'ясо', 'Молочні продукти', 'Кондитерські', 'Напої'], keywords: ['стейк', 'сир', 'йогурт', 'торт', 'шоколад', 'сік'], budget: 1400, limit: 7 },
  { id: 'streamers', icon: '🎮', title: 'Кошик для стрімерів', subtitle: 'Швидкі снеки та напої', categories: ['Напої', 'Кондитерські', 'Заморожені'], keywords: ['енерг', 'кола', 'чіпс', 'печиво', 'піца', 'морозиво'], budget: 1200, limit: 8 },
  { id: 'holiday-birthday', icon: '🎂', title: 'Свято: День народження', subtitle: 'Солодке, напої, святковий стіл', categories: ['Кондитерські', 'Напої', 'Фрукти', 'Заморожені'], keywords: ['торт', 'печиво', 'сік', 'фрукт', 'морозиво', 'піца'], budget: 1600, limit: 8 },
  { id: 'holiday-newyear', icon: '🎄', title: 'Свято: Новий рік', subtitle: 'Для великого столу', categories: ['М\'ясо', 'Ковбаси', 'Кондитерські', 'Напої'], keywords: ['ковбас', 'сир', 'торт', 'сік', 'мандар', 'шинка'], budget: 2200, limit: 9 },
  { id: 'holiday-picnic', icon: '🧺', title: 'Свято: Пікнік', subtitle: 'На компанію на природі', categories: ['М\'ясо', 'Напої', 'Хлібобулочні', 'Овочі'], keywords: ['ковбас', 'сосиск', 'вода', 'сік', 'хліб', 'томат', 'огір'], budget: 1700, limit: 8 },
  { id: 'holiday-romantic', icon: '🌹', title: 'Свято: Романтичний вечір', subtitle: 'Маленький, але приємний набір', categories: ['Кондитерські', 'Фрукти', 'Молочні продукти', 'Напої'], keywords: ['шоколад', 'полуниц', 'виноград', 'сир', 'сік'], budget: 1100, limit: 6 },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

// ═══ Background Particles ═════════════════════════════════
function createBackgroundParticles() {
  const container = document.getElementById('bgParticles');
  if (!container) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const particleCount = window.innerWidth < 768 ? 3 : 5;
  const colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0'];
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.className = 'bg-particle';
    const size = 20 + Math.random() * 60;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = (15 + Math.random() * 20) + 's';
    p.style.animationDelay = -(Math.random() * 35) + 's';
    p.style.setProperty('--drift', (Math.random() * 200 - 100) + 'px');
    container.appendChild(p);
  }
}

function createSnow() {
  const layer = document.getElementById('snowLayer');
  if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const count = window.innerWidth < 640 ? 12 : window.innerWidth < 1000 ? 20 : 30;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const flake = document.createElement('span');
    flake.className = 'snowflake';
    const size = 3 + Math.random() * 6;
    flake.style.setProperty('--snow-x', Math.random() * 100 + 'vw');
    flake.style.setProperty('--snow-drift', (Math.random() * 100 - 50) + 'px');
    flake.style.setProperty('--snow-size', size + 'px');
    flake.style.setProperty('--snow-duration', (10 + Math.random() * 14) + 's');
    flake.style.setProperty('--snow-delay', (-Math.random() * 20) + 's');
    flake.style.opacity = (0.28 + Math.random() * 0.5).toFixed(2);
    fragment.appendChild(flake);
  }
  layer.appendChild(fragment);
}

// ═══ Animated Number Counter ═════════════════════════════
function animateNumber(el, target, duration = 1000, suffix = '') {
  const startVal = 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (target - startVal) * eased);
    el.textContent = current.toLocaleString('uk-UA') + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ═══ API Helpers ════════════════════════════════════════
async function api(method, path, body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const apiError = new Error(err.error || `HTTP ${res.status}`);
      apiError.code = err.code;
      apiError.details = err;
      throw apiError;
    }
    return res.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер відповідає надто довго');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══ Loading & Toast ════════════════════════════════════
function showLoading(text = 'Аналіз даних') {
  const overlay = document.getElementById('loadingOverlay');
  overlay.querySelector('.loading-text').innerHTML = text + '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
  overlay.style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function showToast(message, type = 'error') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.position = 'relative';
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('toast-show'); }, 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ═══ Init ═══════════════════════════════════════════════
async function init() {
  createBackgroundParticles();
  createSnow();
  initTheme();
  initScrollPerf();
  initKeyboardShortcuts();
  initBackToTop();
  initHashNavigation();
  initKonamiCode();
  initLogoEasterEgg();
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('page-hidden', document.hidden);
  });

  // Restore tab from URL hash
  const hash = location.hash.slice(1);
  if (hash && document.getElementById(`tab-${hash}`)) {
    switchTab(hash);
  }

  await Promise.allSettled([
    checkStatus(),
    loadDashboard(),
    loadCharityRequests(),
    loadCharityItems(),
    loadMcpProof(),
  ]);
}

// ═══ Tab Switching ══════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.remove('active');
    t.style.animation = 'none';
  });
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const target = document.getElementById(`tab-${tab}`);
  target.classList.add('active');
  // Force reflow to restart animation
  void target.offsetWidth;
  target.style.animation = '';

  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  // Update URL hash for bookmarkable tabs
  if (location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }

  if (tab === 'inventory' && !inventoryData) loadInventory();
  if (tab === 'dashboard' && (!inventoryData || Date.now() - dashboardLoadedAt > 60_000)) loadDashboard();
  if (tab === 'trends') loadTrends();
  if (tab === 'decisions') loadDecisions();
  if (tab === 'charity-items') loadCharityItems();
  if (tab === 'network') loadNetwork();
}

function handleDashboardCardKey(event, mode) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openInventoryFromDashboard(mode);
  }
}

function openInventoryFromDashboard(mode) {
  if (!inventoryData || !inventoryData.products) {
    showToast('Дані ще завантажуються, спробуйте ще раз за мить');
    loadDashboard();
    return;
  }

  var riskFilterEl = document.getElementById('riskFilter');
  var searchFilterEl = document.getElementById('searchFilter');
  if (riskFilterEl) riskFilterEl.value = '';
  if (searchFilterEl) searchFilterEl.value = '';

  inventoryQuickFilter = mode || 'all';

  if (mode === 'loss' || mode === 'avgRns') {
    inventorySort.col = 'rns';
    inventorySort.dir = -1;
  } else if (mode === 'all') {
    inventorySort.col = null;
    inventorySort.dir = 1;
  }

  switchTab('inventory');
  filterInventory();

  var messages = {
    all: 'Відкрито всі товари',
    atRisk: 'Відкрито товари під ризиком списання',
    anomalies: 'Відкрито товари з аномаліями попиту',
    loss: 'Відкрито товари з найбільшим ризиком збитків',
    avgRns: 'Відкрито товари, відсортовані за RNS',
  };
  showToast(messages[mode] || 'Відкрито список товарів', 'info');
}

// ═══ MCP Status ═════════════════════════════════════════
async function checkStatus() {
  try {
    const status = await api('GET', '/api/status');
    const badge = document.getElementById('mcpStatus');
    const btn = document.getElementById('authBtn');

    if (status.mcpConnected) {
      badge.className = 'status-badge status-connected';
      badge.querySelector('.status-text').textContent = `LIVE MCP · ${status.mcpToolCount || 0} tools`;
      btn.style.display = 'none';
    } else if (status.mcpAuthenticated) {
      badge.className = 'status-badge status-disconnected';
      badge.querySelector('.status-text').textContent = 'OAuth є · MCP недоступний';
      btn.style.display = '';
    } else {
      badge.className = 'status-badge status-disconnected';
      badge.querySelector('.status-text').textContent = 'DEMO · MCP не підключено';
      btn.style.display = '';
    }
  } catch {
    const badge = document.getElementById('mcpStatus');
    badge.className = 'status-badge status-disconnected';
    badge.querySelector('.status-text').textContent = 'Сервер недоступний';
  }
}

async function authenticateMCP() {
  try {
    showLoading('Авторизація MCP...');
    const result = await api('POST', '/api/mcp-authenticate');
    if (result.success) {
      await checkStatus();
      await loadDashboard();
      showToast('Авторизація успішна', 'success');
    } else {
      showToast('Помилка авторизації: ' + (result.error || 'невідома'));
    }
  } catch (e) {
    showToast('Помилка: ' + e.message);
  } finally {
    hideLoading();
  }
}

async function loadMcpProof(showFeedback = false) {
  const container = document.getElementById('mcpProofChecks');
  if (!container) return;
  container.innerHTML = '<span class="proof-pending">Перевірка MCP…</span>';
  try {
    const result = await api('GET', '/api/mcp-proof');
    container.innerHTML = result.checks.map(check => `<span class="proof-check ${check.success ? 'success' : 'error'}"><b>${check.success ? '✓' : '!'}</b><span><code>${escapeHtml(check.tool)}</code><small>${escapeHtml(check.summary)}</small></span></span>`).join('');
    if (showFeedback) showToast('Офіційний MCP підтверджено', 'success');
  } catch (error) {
    container.innerHTML = `<span class="proof-check error"><b>!</b><span><code>MCP</code><small>${escapeHtml(error.message)}</small></span></span>`;
  }
}

// ═══ Dashboard ═════════════════════════════════════════
async function loadDashboard() {
  if (dashboardPromise) return dashboardPromise;
  dashboardPromise = loadDashboardData();
  try { return await dashboardPromise; }
  finally { dashboardPromise = null; }
}

async function loadDashboardData() {
  try {
    const analysis = await api('GET', '/api/dashboard');
    inventoryData = analysis;
    dashboardLoadedAt = Date.now();
    const sourceBanner = document.getElementById('dataSourceBanner');
    if (sourceBanner) {
      sourceBanner.className = `source-banner ${analysis.source === 'mcp' ? 'source-live' : 'source-model'}`;
      sourceBanner.innerHTML = analysis.source === 'mcp'
        ? '<strong>LIVE MCP:</strong> каталог і доступність отримано через офіційний MCP «Сільпо»; прогнозні показники розраховує модель AI Charity Connect.'
        : '<strong>DEMO DATA:</strong> MCP доступний, але каталог потребує активного кошика з доставкою. Аналітика нижче працює на демонстраційному наборі.';
    }

    // Animated stats
    animateNumber(document.getElementById('statTotal'), analysis.summary.totalProducts);
    animateNumber(document.getElementById('statAtRisk'), analysis.summary.atRisk);
    animateNumber(document.getElementById('statAnomalies'), analysis.summary.anomalyDetected);
    animateNumber(document.getElementById('statLoss'), Math.round(analysis.summary.projectedLossValue), 1200, ' ₴');
    animateNumber(document.getElementById('statAvgRNS'), analysis.summary.avgRNS || 0, 1000, '%');

    // Risk chart
    renderRiskChart(analysis.summary);

    // Top risk table
    renderTopRiskTable(analysis.products.slice(0, 10));

    // Update tab badges
    updateTabBadges(analysis);

    // Last updated timestamp
    updateLastUpdated();
  } catch (e) {
    console.error('Dashboard error:', e);
    showToast('Помилка завантаження дашборду: ' + e.message);
  }
}

function renderRiskChart(summary) {
  const data = [
    { label: '🔴 Критичний', value: summary.criticalRisk, cls: 'critical', max: summary.totalProducts },
    { label: '🟠 Високий', value: summary.highRisk, cls: 'high', max: summary.totalProducts },
    { label: '🟡 Середній', value: summary.mediumRisk, cls: 'medium', max: summary.totalProducts },
    { label: '🟢 Низький', value: summary.lowRisk, cls: 'low', max: summary.totalProducts },
  ];

  const html = data.map((d, i) => {
    const pct = d.max > 0 ? (d.value / d.max * 100) : 0;
    return `
      <div class="bar-row" style="animation-delay: ${0.1 + i * 0.1}s">
        <div class="bar-label">${d.label}</div>
        <div class="bar-track">
          <div class="bar-fill ${d.cls}" style="width: 0%; transition: width 1s var(--ease-smooth) ${0.3 + i * 0.15}s;">${d.value}</div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('riskChart').innerHTML = html;

  // Animate bars after render
  requestAnimationFrame(() => {
    data.forEach((d, i) => {
      const fill = document.querySelectorAll('#riskChart .bar-fill')[i];
      if (fill) {
        const pct = d.max > 0 ? (d.value / d.max * 100) : 0;
        setTimeout(() => { fill.style.width = pct + '%'; }, 50);
      }
    });
  });
}

function renderTopRiskTable(products) {
  if (!products || products.length === 0) {
    document.getElementById('topRiskTable').innerHTML = '<p class="empty-state">Немає даних<br><span class="empty-meme">' + getMemeForEmptyState() + '</span></p>';
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>Товар</th>
          <th>Категорія</th>
          <th>Магазин</th>
          <th>Залишок</th>
          <th>Прогноз</th>
          <th>Надлишок</th>
          <th title="RNS — Risk of Non-Sale">Ризик непродажу</th>
          <th>Рівень</th>
          <th>Причина</th>
          <th>Дії</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(p => {
          const canCharity = p.riskAnalysis.riskLevel === 'critical' || p.riskAnalysis.riskLevel === 'high' || p.riskAnalysis.riskLevel === 'medium';
          return `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td>${p.category}</td>
            <td>${p.storeName}</td>
            <td>${p.stock} ${p.unit || 'шт'}</td>
            <td>${p.riskAnalysis.projectedSales ?? '—'}</td>
            <td>${p.riskAnalysis.projectedRemaining ?? 0}</td>
            <td>
              ${p.riskAnalysis.rns ?? Math.round(p.riskAnalysis.probability * 100)}%
              <div class="probability-bar">
                <div class="probability-fill" style="width: ${(p.riskAnalysis.rns ?? p.riskAnalysis.probability * 100)}%; background: ${getRiskColor(p.riskAnalysis.riskLevel)};"></div>
              </div>
            </td>
            <td><span class="risk-badge ${p.riskAnalysis.riskLevel}">${getRiskLabel(p.riskAnalysis.riskLevel)}</span></td>
            <td style="font-size:12px; color:#78909c; max-width:250px;">${p.riskAnalysis.reason}</td>
            <td>${canCharity ? '<button class="btn btn-primary btn-sm" onclick="markAsCharity(\'' + p.id + '\')">🎁</button>' : '—'}</td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('topRiskTable').innerHTML = html;
}

// ═══ Inventory ══════════════════════════════════════════
let inventorySort = { col: null, dir: 1 };

async function loadInventory() {
  try {
    if (!inventoryData) {
      const products = await api('GET', '/api/products');
      inventoryData = await api('POST', '/api/analyze', { products: products.products });
    }
    filterInventory();
  } catch (e) {
    console.error('Inventory error:', e);
    showToast('Помилка завантаження інвентаризації: ' + e.message);
  }
}

function filterInventory() {
  if (!inventoryData) return;

  const riskFilter = document.getElementById('riskFilter').value;
  const searchText = document.getElementById('searchFilter').value.toLowerCase();

  let products = inventoryData.products;

  if (riskFilter) {
    products = products.filter(p => p.riskAnalysis.riskLevel === riskFilter);
  }

  if (inventoryQuickFilter === 'atRisk') {
    products = products.filter(p => ['critical', 'high', 'medium'].includes(p.riskAnalysis.riskLevel));
  } else if (inventoryQuickFilter === 'anomalies') {
    products = products.filter(p => Array.isArray(p.anomalies) && p.anomalies.length > 0);
  } else if (inventoryQuickFilter === 'loss') {
    products = products.filter(p => (p.riskAnalysis.projectedRemaining ?? 0) > 0);
  }

  if (searchText) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchText) ||
      p.category.toLowerCase().includes(searchText) ||
      p.storeName.toLowerCase().includes(searchText)
    );
  }

  // Apply sorting
  if (inventorySort.col) {
    products = [...products].sort((a, b) => {
      let va = a, vb = b;
      if (inventorySort.col === 'rns') {
        va = a.riskAnalysis.rns ?? Math.round(a.riskAnalysis.probability * 100);
        vb = b.riskAnalysis.rns ?? Math.round(b.riskAnalysis.probability * 100);
      } else if (inventorySort.col === 'riskLevel') {
        const order = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
        va = order[a.riskAnalysis.riskLevel] || 0;
        vb = order[b.riskAnalysis.riskLevel] || 0;
      } else if (inventorySort.col === 'projectedSales') {
        va = a.riskAnalysis.projectedSales ?? 0;
        vb = b.riskAnalysis.projectedSales ?? 0;
      } else if (inventorySort.col === 'projectedRemaining') {
        va = a.riskAnalysis.projectedRemaining ?? 0;
        vb = b.riskAnalysis.projectedRemaining ?? 0;
      } else {
        va = a[inventorySort.col] ?? 0;
        vb = b[inventorySort.col] ?? 0;
      }
      if (typeof va === 'string') return va.localeCompare(vb) * inventorySort.dir;
      return (va - vb) * inventorySort.dir;
    });
  }

  const sortArrow = function(col) {
    if (inventorySort.col !== col) return '';
    return inventorySort.dir === 1 ? ' ▲' : ' ▼';
  };

  const html = `
    <table>
      <thead>
        <tr>
          <th class="th-sortable" onclick="sortInventory('name')">Товар${sortArrow('name')}</th>
          <th class="th-sortable" onclick="sortInventory('category')">Категорія${sortArrow('category')}</th>
          <th>Магазин</th>
          <th class="th-sortable" onclick="sortInventory('stock')">Залишок${sortArrow('stock')}</th>
          <th class="th-sortable" onclick="sortInventory('price')">Ціна${sortArrow('price')}</th>
          <th class="th-sortable" onclick="sortInventory('daysToExpiry')">Днів до терм.${sortArrow('daysToExpiry')}</th>
          <th class="th-sortable" onclick="sortInventory('projectedSales')">Прогноз продажів${sortArrow('projectedSales')}</th>
          <th class="th-sortable" onclick="sortInventory('projectedRemaining')">Прогнозний надлишок${sortArrow('projectedRemaining')}</th>
          <th class="th-sortable" onclick="sortInventory('rns')" title="RNS — Risk of Non-Sale">Ризик непродажу${sortArrow('rns')}</th>
          <th class="th-sortable" onclick="sortInventory('riskLevel')">Рівень${sortArrow('riskLevel')}</th>
          <th>Причина ризику</th>
          <th>Дії</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(p => {
          const risk = p.riskAnalysis;
          const rnsVal = risk.rns ?? Math.round(risk.probability * 100);
          const canCharity = risk.riskLevel === 'critical' || risk.riskLevel === 'high' || risk.riskLevel === 'medium';
          return `
            <tr>
              <td><strong>${p.name}</strong></td>
              <td>${p.category}</td>
              <td>${p.storeName}<br><span style="font-size:11px;color:#999">${p.storeAddress}</span></td>
              <td>${p.stock}</td>
              <td>${p.price} ₴</td>
              <td>${p.daysToExpiry}</td>
              <td>${risk.projectedSales ?? '—'}</td>
              <td>${risk.projectedRemaining ?? 0}</td>
              <td>
                ${rnsVal}%
                <div class="probability-bar">
                  <div class="probability-fill" style="width: ${rnsVal}%; background: ${getRiskColor(risk.riskLevel)};"></div>
                </div>
              </td>
              <td><span class="risk-badge ${risk.riskLevel}">${getRiskLabel(risk.riskLevel)}</span></td>
              <td style="font-size:11px; color:#78909c; max-width:220px;">${risk.reason}</td>
              <td>${canCharity ? '<button class="btn btn-primary btn-sm" onclick="markAsCharity(\'' + p.id + '\')">🎁 Благодійність</button>' : '<span style="color:var(--text-light);font-size:12px">—</span>'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('inventoryTable').innerHTML = html;
}

function sortInventory(col) {
  if (inventorySort.col === col) {
    inventorySort.dir *= -1;
  } else {
    inventorySort.col = col;
    inventorySort.dir = 1;
  }
  filterInventory();
}

function debouncedFilterInventory() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(function () {
    filterInventory();
  }, 250);
}

// ═══ CSV Export ═════════════════════════════════════════
function exportInventoryCSV() {
  if (!inventoryData || !inventoryData.products) {
    showToast('Немає даних для експорту', 'error');
    return;
  }

  const riskFilter = document.getElementById('riskFilter').value;
  const searchText = document.getElementById('searchFilter').value.toLowerCase();

  let products = inventoryData.products;
  if (riskFilter) products = products.filter(p => p.riskAnalysis.riskLevel === riskFilter);
  if (inventoryQuickFilter === 'atRisk') {
    products = products.filter(p => ['critical', 'high', 'medium'].includes(p.riskAnalysis.riskLevel));
  } else if (inventoryQuickFilter === 'anomalies') {
    products = products.filter(p => Array.isArray(p.anomalies) && p.anomalies.length > 0);
  } else if (inventoryQuickFilter === 'loss') {
    products = products.filter(p => (p.riskAnalysis.projectedRemaining ?? 0) > 0);
  }
  if (searchText) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchText) ||
      p.category.toLowerCase().includes(searchText) ||
      p.storeName.toLowerCase().includes(searchText)
    );
  }

  const headers = ['Товар', 'Категорія', 'Магазин', 'Адреса', 'Залишок', 'Ціна', 'Днів до терм.', 'Прогноз продажів', 'Прогнозний надлишок', 'RNS %', 'Рівень ризику', 'Причина'];
  const rows = products.map(p => {
    const r = p.riskAnalysis;
    return [
      csvEscape(p.name),
      csvEscape(p.category),
      csvEscape(p.storeName),
      csvEscape(p.storeAddress),
      p.stock,
      p.price,
      p.daysToExpiry,
      r.projectedSales ?? '',
      r.projectedRemaining ?? '',
      r.rns ?? Math.round(r.probability * 100),
      getRiskLabel(r.riskLevel),
      csvEscape(r.reason || ''),
    ].join(',');
  });

  const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inventory_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Експортовано ' + products.length + ' записів', 'success');
}

function csvEscape(str) {
  if (str == null) return '';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ═══ Charity Requests ═══════════════════════════════════
async function submitCharityRequest(event) {
  event.preventDefault();

  const categories = [...document.querySelectorAll('.checkbox input:checked')].map(cb => cb.value);
  const request = {
    organizationName: document.getElementById('orgName').value,
    categories,
    quantity: parseInt(document.getElementById('quantity').value),
    priority: document.getElementById('priority').value,
    deliveryAddress: document.getElementById('deliveryAddress').value,
    deadline: parseInt(document.getElementById('deadline').value),
  };

  try {
    const result = await api('POST', '/api/charity-request', request);
    charityRequests.push(result);
    renderCharityRequests();
    event.target.reset();
    document.getElementById('quantity').value = 10;
    document.getElementById('deadline').value = 3;
    showToast('Запит подано успішно', 'success');
    fireConfetti();
  } catch (e) {
    showToast('Помилка: ' + e.message);
    const form = event.target;
    form.classList.add('shake');
    setTimeout(function () { form.classList.remove('shake'); }, 400);
  }
}

async function loadCharityRequests() {
  try {
    const result = await api('GET', '/api/charity-requests');
    charityRequests = result.requests || [];
    renderCharityRequests();
  } catch (e) {
    console.error('Load charity requests error:', e);
  }
  updateCharityBadge();
}

function updateCharityBadge() {
  const badge = document.getElementById('badge-charity');
  if (!badge) return;
  if (charityRequests.length > 0) {
    badge.textContent = charityRequests.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function updateTabBadges(analysis) {
  const invBadge = document.getElementById('badge-inventory');
  if (invBadge) {
    const atRisk = analysis.summary.atRisk || 0;
    if (atRisk > 0) {
      invBadge.textContent = atRisk;
      invBadge.style.display = '';
    } else {
      invBadge.style.display = 'none';
    }
  }
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) {
    const now = new Date();
    el.textContent = 'Оновлено: ' + now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

function renderBasketPresets() {
  var container = document.getElementById('basketPresets');
  if (!container) return;

  container.innerHTML = basketPresets.map(function (preset) {
    var active = activeBasketPresetId === preset.id ? ' active' : '';
    return '<button class="basket-preset-card' + active + '" onclick="applyBasketPreset(\'' + preset.id + '\')">' +
      '<span class="basket-preset-icon">' + preset.icon + '</span>' +
      '<span class="basket-preset-title">' + preset.title + '</span>' +
      '<span class="basket-preset-subtitle">' + preset.subtitle + '</span>' +
      '</button>';
  }).join('');
}

function scoreBasketProduct(product, preset) {
  var score = 0;
  var name = String(product.name || '').toLowerCase();
  var category = String(product.category || '').toLowerCase();

  if ((preset.categories || []).some(function (cat) { return category.includes(String(cat).toLowerCase()); })) score += 35;
  if ((preset.keywords || []).some(function (kw) { return name.includes(String(kw).toLowerCase()); })) score += 45;
  if ((product.riskAnalysis?.riskLevel === 'low') || (product.riskAnalysis?.riskLevel === 'none')) score += 12;
  if ((product.stock || 0) > 10) score += 8;
  if ((product.daysToExpiry || 0) > 5) score += 10;
  if ((product.price || 0) <= (preset.budget || 1000) / Math.max(1, preset.limit || 6)) score += 10;
  if (preset.sort === 'priceAsc') score += Math.max(0, 20 - (product.price || 0) / 10);
  return score;
}

function buildBasketSelection(preset) {
  if (!inventoryData || !inventoryData.products) return [];

  var ranked = inventoryData.products
    .map(function (product) {
      return { product: product, score: scoreBasketProduct(product, preset) };
    })
    .filter(function (entry) { return entry.score > 20; })
    .sort(function (a, b) {
      if (preset.sort === 'priceAsc' && a.product.price !== b.product.price) return a.product.price - b.product.price;
      return b.score - a.score || a.product.price - b.product.price;
    });

  var selected = [];
  var total = 0;
  for (var i = 0; i < ranked.length; i++) {
    var product = ranked[i].product;
    var nextTotal = total + (product.price || 0);
    if (selected.length >= (preset.limit || 6)) break;
    if (selected.length > 0 && nextTotal > (preset.budget || 1200) * 1.15) continue;
    selected.push(product);
    total = nextTotal;
  }

  if (selected.length === 0) {
    selected = inventoryData.products.slice().sort(function (a, b) {
      return (a.price || 0) - (b.price || 0);
    }).slice(0, Math.min(4, preset.limit || 6));
  }

  return selected;
}

function renderBasketPreview(preset, items) {
  var container = document.getElementById('basketPreview');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-state">Для цього кошика не знайдено товарів</p>';
    return;
  }

  var total = items.reduce(function (sum, item) { return sum + (item.price || 0); }, 0);
  var avgRisk = items.reduce(function (sum, item) { return sum + (item.riskAnalysis?.rns || 0); }, 0) / items.length;

  container.innerHTML =
    '<div class="basket-preview-head">' +
      '<div><div class="basket-preview-kicker">' + preset.icon + ' ' + preset.title + '</div><h3>Готовий набір на ' + items.length + ' товарів</h3><p>' + preset.subtitle + '</p></div>' +
      '<div class="basket-preview-stats">' +
        '<div><strong>' + Math.round(total).toLocaleString('uk-UA') + ' ₴</strong><span>Сума кошика</span></div>' +
        '<div><strong>' + Math.round(avgRisk) + '%</strong><span>Середній RNS</span></div>' +
        '<div><strong>' + (preset.budget || 0).toLocaleString('uk-UA') + ' ₴</strong><span>Орієнтир бюджету</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="basket-preview-grid">' +
      items.map(function (item) {
        var risk = item.riskAnalysis || {};
        return '<div class="basket-item-card">' +
          '<div class="basket-item-top"><strong>' + item.name + '</strong><span class="risk-badge ' + (risk.riskLevel || 'low') + '">' + getRiskLabel(risk.riskLevel) + '</span></div>' +
          '<div class="basket-item-meta">' + item.category + ' · ' + item.storeName + '</div>' +
          '<div class="basket-item-bottom"><span>' + (item.price || 0) + ' ₴</span><span>Залишок: ' + (item.stock || 0) + '</span></div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="basket-preview-actions">' +
      '<button class="btn btn-primary" onclick="markPresetItemsAsBuy(\'' + preset.id + '\')">✅ Позначити кошик як купувати</button>' +
      '<button class="btn btn-outline-dark" onclick="openBasketInInventory(\'' + preset.id + '\')">📦 Відкрити ці товари в інвентаризації</button>' +
    '</div>';
}

function applyBasketPreset(presetId) {
  if (!inventoryData) {
    showToast('Спочатку дочекайтесь завантаження товарів');
    return;
  }
  var preset = basketPresets.find(function (item) { return item.id === presetId; });
  if (!preset) return;
  activeBasketPresetId = presetId;
  renderBasketPresets();
  renderBasketPreview(preset, buildBasketSelection(preset));
}

async function markPresetItemsAsBuy(presetId) {
  var preset = basketPresets.find(function (item) { return item.id === presetId; });
  if (!preset) return;
  var items = buildBasketSelection(preset);
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var existing = decisionsData[item.id] || { productId: item.id, productName: item.name };
    existing.buy = true;
    existing.productName = item.name;
    decisionsData[item.id] = existing;
    await api('POST', '/api/decision', existing);
  }
  renderDecisionsTable();
  showToast('Готовий кошик позначено як покупки', 'success');
}

function openBasketInInventory(presetId) {
  var preset = basketPresets.find(function (item) { return item.id === presetId; });
  if (!preset) return;
  switchTab('inventory');
  inventoryQuickFilter = 'all';
  var searchFilterEl = document.getElementById('searchFilter');
  var riskFilterEl = document.getElementById('riskFilter');
  if (riskFilterEl) riskFilterEl.value = '';
  if (searchFilterEl) searchFilterEl.value = (preset.keywords || [])[0] || '';
  filterInventory();
}

function handleDecisionSummaryCardKey(event, filter) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    applyDecisionFilter(filter);
  }
}

function applyDecisionFilter(filter) {
  var filterEl = document.getElementById('decisionFilter');
  if (!filterEl) return;
  filterEl.value = filter || '';
  renderDecisionsTable();
}

function renderCharityRequests() {
  const container = document.getElementById('charityRequestsList');

  if (charityRequests.length === 0) {
    container.innerHTML = '<p class="empty-state">Запитів поки немає<br><span class="empty-meme">' + getMemeForEmptyState() + '</span></p>';
    return;
  }

  container.innerHTML = charityRequests.map((r, i) => `
    <div class="list-item" style="animation-delay: ${i * 0.08}s">
      <div class="list-item-info">
        <div class="list-item-title">${escapeHtml(r.organizationName)}</div>
        <div class="list-item-meta">
          📦 ${r.quantity} шт ·
          📍 ${escapeHtml(r.deliveryAddress)} ·
          ⏰ ${r.deadline} дн. ·
          ${r.priority === 'high' ? '🔴 Високий' : r.priority === 'low' ? '🟢 Низький' : '🟡 Звичайний'} пріоритет
          ${r.categories && r.categories.length > 0 ? '· 🏷️ ' + r.categories.map(escapeHtml).join(', ') : ''}
        </div>
      </div>
      <span class="risk-badge ${r.status === 'pending' ? 'medium' : 'low'}">${r.status}</span>
    </div>
  `).join('');
}

// ═══ Transfer Plan ══════════════════════════════════════
async function generatePlan() {
  if (agentPlanRunning) return;
  agentPlanRunning = true;
  const container = document.getElementById('transferPlans');
  const runButton = document.getElementById('runAgentBtn');
  if (runButton) { runButton.disabled = true; runButton.textContent = 'MCP-агент працює…'; }
  container.innerHTML = '<p class="empty-state"><span class="loading-spinner"></span><br><br>Агент виконує MCP-сценарій...</p>';

  try {
    currentMcpPlan = await api('POST', '/api/mcp-charity-plan', {});
    renderMcpCharityPlan(currentMcpPlan);
  } catch (e) {
    if (e.code === 'CART_NOT_FOUND') {
      container.innerHTML = `
        <div class="agent-setup-state">
          <div class="agent-setup-icon">🛒</div>
          <h3>Потрібен активний кошик «Сільпо»</h3>
          <p>MCP успішно підключений, але у вашому акаунті ще немає кошика. Створіть його, виберіть магазин або адресу доставки й часовий слот.</p>
          <div class="agent-setup-steps"><span><b>1</b> Відкрийте «Сільпо»</span><span><b>2</b> Додайте будь-який товар</span><span><b>3</b> Налаштуйте доставку</span></div>
          <div class="agent-setup-actions">
            <a class="btn btn-primary" href="https://silpo.ua" target="_blank" rel="noopener">Створити кошик у «Сільпо» ↗</a>
            <button class="btn btn-outline-dark" onclick="generatePlan()">Перевірити знову</button>
          </div>
          <small>Після створення кошика повертайтесь сюди — повторна авторизація MCP не потрібна.</small>
        </div>`;
    } else {
      container.innerHTML = '<p class="empty-state">Не вдалося завершити MCP-сценарій: ' + escapeHtml(e.message) + '</p>';
      showToast('Не вдалося запустити агента', 'error');
    }
  } finally {
    agentPlanRunning = false;
    if (runButton) { runButton.disabled = false; runButton.textContent = 'Запустити MCP-агента'; }
  }
}

function renderMcpTrace(trace) {
  return `<div class="mcp-trace"><h3>Журнал MCP-викликів</h3>${(trace || []).slice().reverse().map(step => `
    <div class="mcp-trace-step ${step.status}"><span>${step.status === 'success' ? '✓' : '!'}</span><code>${escapeHtml(step.tool)}</code><small>${escapeHtml(step.details)}</small></div>
  `).join('')}</div>`;
}

function renderMcpCharityPlan(result) {
  const container = document.getElementById('transferPlans');
  container.innerHTML = `
    <div class="source-banner source-live"><strong>LIVE MCP «Сільпо»</strong> · товари та доступність отримано з офіційного каталогу</div>
    <div class="transfer-plan">
      <div class="transfer-plan-header"><div><div class="transfer-plan-title">🤝 ${escapeHtml(result.request.organizationName)}</div>
      <div class="transfer-plan-meta">📍 ${escapeHtml(result.request.deliveryAddress)} · ${result.totalItems} позицій · ${Number(result.estimatedTotal || 0).toLocaleString('uk-UA')} ₴</div></div>
      <span class="risk-badge low">MCP plan</span></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Товар</th><th>Ціна</th><th>Доступно</th><th>Кількість</th><th>Donation Score</th></tr></thead><tbody>
      ${(result.selected || []).map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.matchReason || '')}</small></td><td>${Number(item.price).toLocaleString('uk-UA')} ₴</td><td>${item.stock || 'у каталозі'}</td><td>${item.quantity}${item.displayRatio ? ' · ' + escapeHtml(item.displayRatio) : ''}</td><td><span class="donation-score-value ${getDonationScoreClass(item.donationScore)}">${item.donationScore}</span></td></tr>`).join('')}
      </tbody></table></div>
      ${result.canConfirm ? '<button class="btn btn-primary" onclick="confirmMcpPlan()">Підтвердити й додати через MCP</button>' : '<p class="empty-state">MCP не знайшов доступних товарів для цього запиту.</p>'}
    </div>${renderMcpTrace(result.trace)}`;
}

async function confirmMcpPlan() {
  if (!currentMcpPlan || !window.confirm('Додати підібрані товари у ваш кошик «Сільпо»?')) return;
  try {
    showLoading('Додавання та перевірка через MCP');
    const result = await api('POST', '/api/mcp-charity-confirm', { confirmed: true, planId: currentMcpPlan.planId });
    const checkoutLinks = [
      result.checkoutWebLink ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(result.checkoutWebLink)}" target="_blank" rel="noopener">Оформити на сайті ↗</a>` : '',
      result.checkoutMobileLink ? `<a class="btn btn-outline-dark btn-sm" href="${escapeHtml(result.checkoutMobileLink)}" target="_blank" rel="noopener">Оформити в застосунку ↗</a>` : '',
    ].join('');
    const validationNotice = result.blockingErrors?.length
      ? `<div class="source-banner source-model"><strong>Кошик має ${result.blockingErrors.length} блокуючих перевірок.</strong> Відкрийте оформлення та виправте їх перед замовленням.</div>`
      : '<div class="source-banner source-live"><strong>✓ MCP-дію виконано, кошик повторно перевірено.</strong></div>';
    document.getElementById('transferPlans').insertAdjacentHTML('afterbegin', `${validationNotice}<div class="agent-setup-actions">${checkoutLinks}</div>${renderMcpTrace(result.trace)}`);
    showToast(result.blockingErrors?.length ? 'Кошик оновлено, але потребує уваги' : 'Кошик оновлено і перевірено через MCP', result.blockingErrors?.length ? 'info' : 'success');
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

function renderTransferPlans(result) {
  const container = document.getElementById('transferPlans');

  if (!result.plans || result.plans.length === 0) {
    container.innerHTML = `
      <p class="empty-state">
        Не знайдено товарів з високим ризиком нереалізації, що відповідають запитам.
        <br>Спробуйте створити запит від благодійної організації або знизити поріг ризику.
        <br><span class="empty-meme">Або просто подаруйте усім по банану 🍌</span>
      </p>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cards-grid">
      <div class="card card-stat card-info">
        <div class="card-icon">📦</div>
        <div class="card-value">${result.totalProductsAllocated}</div>
        <div class="card-label">Товарних позицій</div>
      </div>
      <div class="card card-stat">
        <div class="card-icon">🛒</div>
        <div class="card-value">${result.totalUnitsAllocated}</div>
        <div class="card-label">Одиниць продукції</div>
      </div>
      <div class="card card-stat card-danger">
        <div class="card-icon">👥</div>
        <div class="card-value">${result.totalSocialImpact}</div>
        <div class="card-label">Людей отримають допомогу</div>
      </div>
      <div class="card card-stat card-warning">
        <div class="card-icon">🎯</div>
        <div class="card-value">${result.avgDonationScore || 0}</div>
        <div class="card-label">Середній Donation Score</div>
      </div>
    </div>
    ${result.plans.map((plan, pi) => `
      <div class="transfer-plan" style="animation-delay: ${pi * 0.15}s">
        <div class="transfer-plan-header">
          <div>
            <div class="transfer-plan-title">🤝 ${plan.charityName}</div>
            <div class="transfer-plan-meta">
              📍 ${plan.charityAddress} ·
              ${plan.priority === 'high' ? '🔴 Високий' : '🟡 Звичайний'} пріоритет ·
              ${plan.totalItems} позицій · ${plan.totalQuantity} од.
            </div>
          </div>
          <span class="risk-badge low">${plan.status}</span>
        </div>
        <div class="transfer-plan-stats">
          <div class="transfer-stat">
            <div class="transfer-stat-value">${plan.storesInvolved.length}</div>
            <div class="transfer-stat-label">Магазинів</div>
          </div>
          <div class="transfer-stat">
            <div class="transfer-stat-value">${plan.totalQuantity}</div>
            <div class="transfer-stat-label">Одиниць</div>
          </div>
          <div class="transfer-stat">
            <div class="transfer-stat-value">${plan.estimatedTime} год</div>
            <div class="transfer-stat-label">Час доставки</div>
          </div>
          <div class="transfer-stat">
            <div class="transfer-stat-value">${plan.socialImpact.peopleServed}</div>
            <div class="transfer-stat-label">Людей</div>
          </div>
          <div class="transfer-stat">
            <div class="transfer-stat-value">${Math.round(plan.economicImpact.estimatedLossPrevention).toLocaleString('uk-UA')} ₴</div>
            <div class="transfer-stat-label">Збережено</div>
          </div>
          <div class="transfer-stat">
            <div class="transfer-stat-value">${plan.avgDonationScore}</div>
            <div class="transfer-stat-label">Donation Score</div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Магазин</th>
                <th>Кількість</th>
                <th>Ризик непродажу</th>
                <th>Ризик</th>
                <th>Donation Score</th>
                <th>Причина</th>
                <th>Відповідність</th>
              </tr>
            </thead>
            <tbody>
              ${plan.items.map(item => `
                <tr>
                  <td><strong>${item.productName}</strong></td>
                  <td>${item.storeName}</td>
                  <td>${item.quantity}</td>
                  <td>${item.rns ?? Math.round(item.writeOffProbability * 100)}%</td>
                  <td><span class="risk-badge ${item.riskLevel}">${getRiskLabel(item.riskLevel)}</span></td>
                  <td>
                    <div class="donation-score-cell">
                      <span class="donation-score-value ${getDonationScoreClass(item.donationScore)}">${item.donationScore}</span>
                      <div class="donation-score-bar">
                        <div class="donation-score-fill ${getDonationScoreClass(item.donationScore)}" style="width: ${item.donationScore}%"></div>
                      </div>
                    </div>
                  </td>
                  <td style="font-size:11px; color:#78909c; max-width:200px;">${item.reason}</td>
                  <td style="font-size:11px; color:#78909c;">${item.matchDetails.join('; ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="transfer-route">
          <strong>🗺️ Маршрут збору:</strong>
          ${plan.route.map(stop => `
            <div class="route-stop">
              <div class="route-number">${stop.order}</div>
              <div class="route-info">
                <strong>${stop.storeName}</strong><br>
                <span>${stop.storeAddress} · ${stop.itemsToCollect} поз. до збору</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

// ═══ Network Analysis ═══════════════════════════════════
async function loadNetwork() {
  const overviewEl = document.getElementById('networkOverview');
  const storesEl = document.getElementById('networkStores');

  overviewEl.innerHTML = '<p class="empty-state"><span class="loading-spinner"></span><br><br>Аналіз мережі...</p>';
  storesEl.innerHTML = '';

  try {
    const result = await api('GET', '/api/network');
    networkData = result;

    // Overview stats
    overviewEl.innerHTML = `
      <div class="card card-stat">
        <div class="card-icon">🏪</div>
        <div class="card-value">${result.totalStores}</div>
        <div class="card-label">Магазинів мережі</div>
      </div>
      <div class="card card-stat card-danger">
        <div class="card-icon">⚠️</div>
        <div class="card-value">${result.totalAtRisk}</div>
        <div class="card-label">Товарів під ризиком</div>
      </div>
      <div class="card card-stat card-warning">
        <div class="card-icon">📦</div>
        <div class="card-value">${result.totalWriteOff}</div>
        <div class="card-label">Прогноз списань (од.)</div>
      </div>
      <div class="card card-stat card-info">
        <div class="card-icon">💰</div>
        <div class="card-value">${Math.round(result.totalLossValue).toLocaleString('uk-UA')} ₴</div>
        <div class="card-label">Збитки всієї мережі</div>
      </div>
    `;

    // Stores table
    storesEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Магазин</th>
            <th>Адреса</th>
            <th>Товарів</th>
            <th>Під ризиком</th>
            <th>Критичних</th>
            <th>Високих</th>
            <th>Середній ризик непродажу</th>
            <th>Прогноз списань</th>
            <th>Збитки</th>
          </tr>
        </thead>
        <tbody>
          ${result.stores.map(s => `
            <tr>
              <td><strong>${s.storeName}</strong></td>
              <td style="font-size:12px; color:#78909c;">${s.storeAddress}</td>
              <td>${s.totalProducts}</td>
              <td><span class="risk-badge ${s.atRiskProducts > 5 ? 'critical' : s.atRiskProducts > 2 ? 'high' : 'medium'}">${s.atRiskProducts}</span></td>
              <td>${s.criticalRisk}</td>
              <td>${s.highRisk}</td>
              <td>
                ${s.avgRNS}%
                <div class="probability-bar">
                  <div class="probability-fill" style="width: ${s.avgRNS}%; background: ${getRiskColor(s.avgRNS >= 60 ? 'critical' : s.avgRNS >= 40 ? 'high' : s.avgRNS >= 20 ? 'medium' : 'low')};"></div>
                </div>
              </td>
              <td>${s.projectedWriteOff}</td>
              <td>${s.projectedLossValue.toLocaleString('uk-UA')} ₴</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    overviewEl.innerHTML = '<p class="empty-state">Помилка: ' + e.message + '</p>';
    showToast('Помилка завантаження мережевого аналізу: ' + e.message);
  }
}

// ═══ Trends ═════════════════════════════════════════════
async function loadTrends() {
  const container = document.getElementById('trendsCharts');
  container.innerHTML = '<p class="empty-state"><span class="loading-spinner"></span><br><br>Завантаження трендів...</p>';

  try {
    const result = await api('GET', '/api/trends');
    trendsData = result;

    // Populate category filter
    const catFilter = document.getElementById('trendCategoryFilter');
    const cats = [...new Set(result.products.map(p => p.category))];
    catFilter.innerHTML = '<option value="">Всі категорії</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');

    // Render category summary
    renderTrendsCategorySummary(result.categoryTrends);

    filterTrends();
  } catch (e) {
    container.innerHTML = '<p class="empty-state">Помилка: ' + e.message + '</p>';
    showToast('Помилка завантаження трендів: ' + e.message);
  }
}

function filterTrends() {
  if (!trendsData) return;

  const catFilter = document.getElementById('trendCategoryFilter').value;
  const riskFilter = document.getElementById('trendRiskFilter').value;
  const searchText = document.getElementById('trendSearchFilter').value.toLowerCase();

  let products = trendsData.products;

  if (catFilter) products = products.filter(p => p.category === catFilter);
  if (riskFilter) products = products.filter(p => p.riskLevel === riskFilter);
  if (searchText) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchText) ||
      p.category.toLowerCase().includes(searchText) ||
      p.storeName.toLowerCase().includes(searchText)
    );
  }

  products = [...products].sort((a, b) => b.rns - a.rns);

  const container = document.getElementById('trendsCharts');
  if (products.length === 0) {
    container.innerHTML = '<p class="empty-state">Немає товарів для відображення<br><span class="empty-meme">' + getMemeForEmptyState() + '</span></p>';
    return;
  }

  const visibleProducts = products.slice(0, 12);
  container.innerHTML = (products.length > visibleProducts.length
    ? `<p class="render-note">Показано 12 із ${products.length} товарів із найвищим ризиком непродажу. Використайте фільтри для точнішого пошуку.</p>`
    : '') + visibleProducts.map((p, i) => renderTrendChart(p, i)).join('');
}

function renderTrendsCategorySummary(categoryTrends) {
  const container = document.getElementById('trendsCategorySummary');
  if (!categoryTrends || categoryTrends.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = categoryTrends.slice(0, 6).map((c, i) => {
    const trendIcon = c.trendCounts.declining > c.trendCounts.growing ? '📉' : c.trendCounts.growing > c.trendCounts.declining ? '📈' : '➡️';
    return `
      <div class="card card-stat" style="animation-delay:${i * 0.05}s">
        <div class="card-icon">${trendIcon}</div>
        <div class="card-value" style="font-size:16px;line-height:1.3">${c.category}</div>
        <div class="card-label">${c.products} товарів · ${c.atRisk} під ризиком · ризик ${c.avgRNS}%</div>
      </div>
    `;
  }).join('');
}

function renderTrendChart(product, index) {
  const sales = product.salesHistory || [];
  if (sales.length === 0) return '<div class="trend-chart-card"><p class="empty-state">Немає даних</p></div>';

  var W = 800, H = 340;
  var padL = 50, padR = 20, padT = 25, padB = 55;
  var plotW = W - padL - padR;
  var plotH = H - padT - padB;

  var maxQty = Math.max.apply(null, sales.map(function (s) { return s.quantity; })
    .concat(product.movingAvg || [1]).concat([1]));
  var yMax = Math.ceil(maxQty * 1.15);

  var n = sales.length;
  var xStep = plotW / Math.max(1, n - 1);

  function xPos(i) { return padL + i * xStep; }
  function yPos(v) { return padT + plotH - (v / yMax) * plotH; }

  // Sales line points
  var salesPoints = sales.map(function (s, i) { return xPos(i) + ',' + yPos(s.quantity); }).join(' ');

  // Moving average points
  var maPoints = (product.movingAvg || []).map(function (v, i) { return xPos(i) + ',' + yPos(v); }).join(' ');

  // Interactive points: a larger transparent hit area makes hovering easy,
  // while the tooltip stays inside the SVG near the selected value.
  var pointMarkers = sales.map(function (sale, i) {
    var cx = xPos(i);
    var cy = yPos(sale.quantity);
    var tooltipW = 112;
    var tooltipH = 42;
    var tooltipX = Math.max(padL, Math.min(W - padR - tooltipW, cx - tooltipW / 2));
    var tooltipY = cy - tooltipH - 14;
    if (tooltipY < padT) tooltipY = cy + 14;
    var dayLabel = sale.date ? new Date(sale.date + 'T00:00:00').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : 'День ' + (sale.day ?? i);
    var valueLabel = Number(sale.quantity).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
    return '<g class="chart-point" tabindex="0" role="img" aria-label="' + dayLabel + ': ' + valueLabel + ' одиниць">' +
      '<circle class="chart-point-hit" cx="' + cx + '" cy="' + cy + '" r="11" />' +
      '<circle class="chart-point-dot" cx="' + cx + '" cy="' + cy + '" r="3.5" />' +
      '<g class="chart-point-tooltip" transform="translate(' + tooltipX + ',' + tooltipY + ')">' +
        '<rect width="' + tooltipW + '" height="' + tooltipH + '" rx="8" />' +
        '<text class="chart-tooltip-date" x="10" y="16">' + dayLabel + '</text>' +
        '<text class="chart-tooltip-value" x="10" y="33">' + valueLabel + ' од.</text>' +
      '</g>' +
    '</g>';
  }).join('');

  // Anomaly markers
  var anomalyMarkers = (product.anomalies || []).map(function (a) {
    var dayIdx = sales.findIndex(function (s) { return s.date === a.date; });
    if (dayIdx === -1) return '';
    var cx = xPos(dayIdx);
    var cy = yPos(a.actual);
    var color = a.type === 'demand_drop' ? '#f44336' : '#ff9800';
    var label = a.type === 'demand_drop' ? '📉 Аномальне зниження попиту' : '📈 Аномальний сплеск попиту';
    return '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + color + '" stroke="white" stroke-width="2" opacity="0.9" pointer-events="none">' +
      '<title>' + label + ': очікувалось ' + a.expected.toFixed(1) + ', фактично ' + a.actual + '. Відхилення: ' + a.deviation.toFixed(1) + '</title>' +
      '</circle>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.4" pointer-events="none">' +
      '<animate attributeName="r" from="6" to="14" dur="1.5s" repeatCount="indefinite"/>' +
      '<animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite"/>' +
      '</circle>';
  }).join('');

  // Donation point marker
  var donationMarker = '';
  if (product.donationDay != null && product.donationDay >= 0 && product.donationDay < n) {
    var dx = xPos(product.donationDay);
    donationMarker =
      '<line x1="' + dx + '" y1="' + padT + '" x2="' + dx + '" y2="' + (padT + plotH) + '" stroke="#4caf50" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>' +
      '<g transform="translate(' + dx + ',' + (padT + plotH + 18) + ')">' +
      '<polygon points="0,0 -6,-10 6,-10" fill="#4caf50" stroke="white" stroke-width="1.5"/>' +
      '<text x="0" y="22" text-anchor="middle" font-size="10" fill="#4caf50" font-weight="700">🎁 Благодійність</text>' +
      '</g>';
  }

  // Grid lines
  var gridLines = '';
  for (var i = 0; i <= 4; i++) {
    var y = padT + (plotH / 4) * i;
    var val = Math.round(yMax - (yMax / 4) * i);
    gridLines += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--border)" stroke-width="0.5"/>';
    gridLines += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="var(--text-light)">' + val + '</text>';
  }

  // X axis labels
  var xLabels = '';
  var labelEvery = Math.ceil(n / 6);
  for (var j = 0; j < n; j += labelEvery) {
    var x = xPos(j);
    xLabels += '<text x="' + x + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="11" fill="var(--text-light)">Д' + (sales[j].day != null ? sales[j].day : j) + '</text>';
  }

  // Trend indicator
  var trendArrow = product.trend === 'declining' ? '📉 Сниження' : product.trend === 'growing' ? '📈 Зростання' : '➡️ Стабільно';
  var trendColor = product.trend === 'declining' ? '#f44336' : product.trend === 'growing' ? '#4caf50' : '#607d8b';

  return '<div class="trend-chart-card" style="animation-delay:' + (index * 0.05) + 's">' +
    '<div class="trend-chart-header">' +
    '<div>' +
    '<span class="trend-chart-title">' + product.name + '</span>' +
    '<span class="risk-badge ' + product.riskLevel + '" style="margin-left:8px">' + getRiskLabel(product.riskLevel) + '</span>' +
    '</div>' +
    '<div class="trend-chart-meta">Ризик непродажу: ' + product.rns + '% · Залишок: ' + product.stock + ' · Термін: ' + product.daysToExpiry + ' дн. · <span style="color:' + trendColor + ';font-weight:600">' + trendArrow + '</span></div>' +
    '</div>' +
    '<div class="trend-svg-wrap">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" class="trend-svg">' +
    gridLines +
    '<polyline points="' + salesPoints + '" fill="none" stroke="#2196f3" stroke-width="2" stroke-linejoin="round"/>' +
    '<polyline points="' + maPoints + '" fill="none" stroke="#4caf50" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>' +
    pointMarkers +
    anomalyMarkers +
    donationMarker +
    xLabels +
    '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="var(--text-light)" stroke-width="1"/>' +
    '</svg>' +
    '</div>' +
    '<div class="trend-chart-legend">' +
    '<span class="legend-item"><span class="legend-dot" style="background:#2196f3"></span> Продажі</span>' +
    '<span class="legend-item"><span class="legend-dot" style="background:#4caf50"></span> Ковзне середнє</span>' +
    '<span class="legend-item"><span class="legend-dot" style="background:#f44336"></span> Зниження попиту</span>' +
    '<span class="legend-item"><span class="legend-dot" style="background:#ff9800"></span> Сплеск попиту</span>' +
    (product.donationDay != null ? '<span class="legend-item"><span class="legend-dot" style="background:#4caf50"></span> Точка благодійності</span>' : '') +
    '</div>' +
    (product.reason ? '<div class="trend-chart-reason">💡 ' + product.reason + '</div>' : '') +
    '</div>';
}

// ═══ Decisions ══════════════════════════════════════════
async function loadDecisions() {
  try {
    if (!inventoryData) {
      var products = await api('GET', '/api/products');
      inventoryData = await api('POST', '/api/analyze', { products: products.products });
    }
    var result = await api('GET', '/api/decisions');
    decisionsData = {};
    for (var d of result.decisions) {
      decisionsData[d.productId] = d;
    }
    renderBasketPresets();
    if (activeBasketPresetId) applyBasketPreset(activeBasketPresetId);
    renderDecisionsTable();
  } catch (e) {
    showToast('Помилка завантаження вибірки: ' + e.message);
  }
}

function renderDecisionsTable() {
  if (!inventoryData) return;

  var filter = document.getElementById('decisionFilter').value;
  var products = inventoryData.products;

  // Render summary
  var buyCount = 0, nobuyCount = 0, keepCount = 0, nokeepCount = 0, undecided = 0;
  for (var p of products) {
    var d = decisionsData[p.id];
    if (!d) { undecided++; continue; }
    if (d.buy) buyCount++; else nobuyCount++;
    if (d.keep) keepCount++; else nokeepCount++;
  }

  document.getElementById('decisionsSummary').innerHTML =
    '<div class="card card-stat card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'\')" onkeydown="handleDecisionSummaryCardKey(event, \'\')"><div class="card-icon">📋</div><div class="card-value">' + products.length + '</div><div class="card-label">Всього товарів</div></div>' +
    '<div class="card card-stat card-warning card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'undecided\')" onkeydown="handleDecisionSummaryCardKey(event, \'undecided\')"><div class="card-icon">⬜</div><div class="card-value">' + undecided + '</div><div class="card-label">Не вирішено</div></div>' +
    '<div class="card card-stat card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'buy\')" onkeydown="handleDecisionSummaryCardKey(event, \'buy\')"><div class="card-icon">✅</div><div class="card-value">' + buyCount + '</div><div class="card-label">Купувати</div></div>' +
    '<div class="card card-stat card-danger card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'nobuy\')" onkeydown="handleDecisionSummaryCardKey(event, \'nobuy\')"><div class="card-icon">❌</div><div class="card-value">' + nobuyCount + '</div><div class="card-label">Не купувати</div></div>' +
    '<div class="card card-stat card-info card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'keep\')" onkeydown="handleDecisionSummaryCardKey(event, \'keep\')"><div class="card-icon">📦</div><div class="card-value">' + keepCount + '</div><div class="card-label">Утримати</div></div>' +
    '<div class="card card-stat card-danger card-clickable" role="button" tabindex="0" onclick="applyDecisionFilter(\'nokeep\')" onkeydown="handleDecisionSummaryCardKey(event, \'nokeep\')"><div class="card-icon">📤</div><div class="card-value">' + nokeepCount + '</div><div class="card-label">Не утримати</div></div>';

  // Filter
  var filtered = products.filter(function (p) {
    var d = decisionsData[p.id];
    if (filter === 'undecided') return !d;
    if (filter === 'buy') return d && d.buy;
    if (filter === 'nobuy') return d && !d.buy;
    if (filter === 'keep') return d && d.keep;
    if (filter === 'nokeep') return d && !d.keep;
    return true;
  });

  // Update badge
  var badge = document.getElementById('badge-decisions');
  if (badge) {
    badge.textContent = undecided;
    badge.style.display = undecided > 0 ? '' : 'none';
  }

  if (filtered.length === 0) {
    document.getElementById('decisionsTable').innerHTML = '<p class="empty-state">Немає товарів<br><span class="empty-meme">' + getMemeForEmptyState() + '</span></p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Товар</th><th>Категорія</th><th>Магазин</th><th>Залишок</th><th>Ризик непродажу</th><th>Рівень</th>' +
    '<th>Купувати?</th><th>Утримати?</th><th>Дія</th>' +
    '</tr></thead><tbody>';

  for (var p of filtered) {
    var d = decisionsData[p.id] || {};
    var risk = p.riskAnalysis || {};
    var rnsVal = risk.rns != null ? risk.rns : Math.round((risk.probability || 0) * 100);

    html += '<tr>' +
      '<td><strong>' + p.name + '</strong></td>' +
      '<td>' + (p.category || '') + '</td>' +
      '<td>' + (p.storeName || '') + '</td>' +
      '<td>' + (p.stock || 0) + '</td>' +
      '<td>' + rnsVal + '%</td>' +
      '<td><span class="risk-badge ' + (risk.riskLevel || 'none') + '">' + getRiskLabel(risk.riskLevel) + '</span></td>' +
      '<td><div class="toggle-group">' +
      '<button class="toggle-btn ' + (d.buy === true ? 'toggle-active-green' : '') + '" onclick="setDecision(\'' + p.id + '\',\'' + p.name.replace(/'/g, "\\'") + '\',\'buy\',true)">✅ Купувати</button>' +
      '<button class="toggle-btn ' + (d.buy === false ? 'toggle-active-red' : '') + '" onclick="setDecision(\'' + p.id + '\',\'' + p.name.replace(/'/g, "\\'") + '\',\'buy\',false)">❌ Не купувати</button>' +
      '</div></td>' +
      '<td><div class="toggle-group">' +
      '<button class="toggle-btn ' + (d.keep === true ? 'toggle-active-blue' : '') + '" onclick="setDecision(\'' + p.id + '\',\'' + p.name.replace(/'/g, "\\'") + '\',\'keep\',true)">📦 Утримати</button>' +
      '<button class="toggle-btn ' + (d.keep === false ? 'toggle-active-orange' : '') + '" onclick="setDecision(\'' + p.id + '\',\'' + p.name.replace(/'/g, "\\'") + '\',\'keep\',false)">📤 Не утримати</button>' +
      '</div></td>' +
      '<td>' + (d.keep === false
        ? '<button class="btn btn-primary btn-sm" onclick="markAsCharity(\'' + p.id + '\')">🎁 → Благодійність</button>'
        : '<span style="color:var(--text-light);font-size:12px">—</span>') + '</td>' +
      '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('decisionsTable').innerHTML = html;
}

async function setDecision(productId, productName, field, value) {
  var existing = decisionsData[productId] || { productId: productId, productName: productName };
  existing[field] = value;
  existing.productName = productName;
  decisionsData[productId] = existing;

  try {
    await api('POST', '/api/decision', existing);
    renderDecisionsTable();
  } catch (e) {
    showToast('Помилка збереження: ' + e.message);
  }
}

// ═══ Charity Items ══════════════════════════════════════
async function loadCharityItems() {
  try {
    var result = await api('GET', '/api/charity-items');
    charityItemsData = result.items || [];
    renderCharityItems();
  } catch (e) {
    showToast('Помилка завантаження благодійних товарів: ' + e.message);
  }
}

function renderCharityItems() {
  var summaryEl = document.getElementById('charityItemsSummary');
  var listEl = document.getElementById('charityItemsList');

  // Update badge
  var badge = document.getElementById('badge-charity-items');
  if (badge) {
    badge.textContent = charityItemsData.length;
    badge.style.display = charityItemsData.length > 0 ? '' : 'none';
  }

  if (charityItemsData.length === 0) {
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<p class="empty-state">Поки немає благодійних товарів<br><span style="font-size:13px">Переведіть товари з високим ризиком у благодійність зі вкладок «Інвентаризація» або «Вибірка»</span></p>';
    return;
  }

  var totalUnits = charityItemsData.reduce(function (s, i) { return s + (i.quantity || i.stock || 0); }, 0);
  var totalValue = charityItemsData.reduce(function (s, i) { return s + (i.quantity || i.stock || 0) * (i.price || 0); }, 0);
  var peopleServed = Math.floor(totalUnits / 2);

  summaryEl.innerHTML =
    '<div class="card card-stat"><div class="card-icon">🎁</div><div class="card-value">' + charityItemsData.length + '</div><div class="card-label">Благодійних товарів</div></div>' +
    '<div class="card card-stat card-info"><div class="card-icon">📦</div><div class="card-value">' + totalUnits + '</div><div class="card-label">Одиниць врятовано</div></div>' +
    '<div class="card card-stat card-warning"><div class="card-icon">💰</div><div class="card-value">' + Math.round(totalValue).toLocaleString('uk-UA') + ' ₴</div><div class="card-label">Вартість збережена</div></div>' +
    '<div class="card card-stat"><div class="card-icon">👥</div><div class="card-value">' + peopleServed + '</div><div class="card-label">Людей отримають допомогу</div></div>';

  listEl.innerHTML = charityItemsData.map(function (item, i) {
    var quantity = item.quantity || item.stock || 0;
    var availableStock = item.stock || 0;
    return '<div class="charity-item-card" style="animation-delay:' + (i * 0.08) + 's">' +
      '<div class="charity-item-header">' +
      '<span class="charity-item-name">' + item.productName + '</span>' +
      '<span class="risk-badge ' + (item.riskLevel || 'high') + '">' + getRiskLabel(item.riskLevel) + '</span>' +
      '</div>' +
      '<div class="charity-item-meta">' +
      '🏷️ ' + (item.category || '') + ' · 🏪 ' + (item.storeName || '') + '<br>' +
      '🎁 На передачу: ' + quantity + ' шт · 📦 Доступно: ' + availableStock + ' шт<br>' +
      '💰 ' + (item.price || 0) + ' ₴ · ⏰ ' + (item.daysToExpiry || 0) + ' дн.' +
      '</div>' +
      '<div class="charity-item-reason">💡 ' + (item.reason || '') + '</div>' +
      '<div class="charity-item-actions">' +
      '<span class="charity-status-badge">✅ Доступно для передачі</span>' +
      '<button class="btn btn-outline-dark btn-sm" onclick="removeFromCharity(\'' + item.productId + '\')">✕ Вилучити</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

async function markAsCharity(productId) {
  if (!inventoryData || !inventoryData.products) {
    showToast('Дані інвентаризації не завантажені');
    return;
  }

  var product = inventoryData.products.find(function (p) { return p.id === productId; });
  if (!product) {
    showToast('Товар не знайдено');
    return;
  }

  var maxQuantity = Number(product.stock) || 0;
  if (maxQuantity <= 0) {
    showToast('Для цього товару немає доступного залишку');
    return;
  }

  var quantityInput = window.prompt('Вкажіть кількість для передачі на благодійність', String(maxQuantity));
  if (quantityInput === null) return;

  var quantity = Number(quantityInput);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    showToast('Вкажіть коректну цілу кількість');
    return;
  }

  if (quantity > maxQuantity) {
    showToast('Кількість не може бути більшою за доступний залишок (' + maxQuantity + ')');
    return;
  }

  var risk = product.riskAnalysis || {};
  try {
    await api('POST', '/api/charity-item', {
      productId: product.id,
      productName: product.name,
      category: product.category,
      storeName: product.storeName,
      storeAddress: product.storeAddress,
      stock: product.stock,
      quantity: quantity,
      price: product.price,
      daysToExpiry: product.daysToExpiry,
      rns: risk.rns,
      riskLevel: risk.riskLevel,
      reason: risk.reason,
    });
    showToast('"' + product.name + '" переведено в благодійність (' + quantity + ' шт)', 'success');
    fireConfetti(30);
    loadCharityItems();
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function removeFromCharity(productId) {
  try {
    await api('DELETE', '/api/charity-item', { productId: productId });
    showToast('Товар вилучено з благодійності', 'info');
    loadCharityItems();
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

// ═══ Helpers ════════════════════════════════════════════
function getRiskColor(level) {
  const colors = {
    critical: '#f44336',
    high: '#ff9800',
    medium: '#fdd835',
    low: '#4caf50',
    none: '#e0e0e0',
  };
  return colors[level] || '#e0e0e0';
}

function getRiskLabel(level) {
  const labels = {
    critical: 'Критичний',
    high: 'Високий',
    medium: 'Середній',
    low: 'Низький',
    none: '—',
  };
  return labels[level] || level;
}

function getDonationScoreClass(score) {
  if (score >= 70) return 'score-excellent';
  if (score >= 50) return 'score-good';
  if (score >= 30) return 'score-medium';
  return 'score-low';
}

// ═══ Theme ══════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch (e) {}
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = document.documentElement.getAttribute('data-theme');
  const theme = saved === 'dark' || saved === 'light' ? saved : 'light';
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ═══ Scroll Performance ═════════════════════════════════
// Pause all running CSS animations while the user is actively dragging the
// scrollbar / scrolling to avoid expensive repaints during scroll.
function initScrollPerf() {
  let scrollTimer;
  window.addEventListener('scroll', function () {
    document.body.classList.add('is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      document.body.classList.remove('is-scrolling');
    }, 220);
  }, { passive: true });
}

// ═══ Keyboard Shortcuts ════════════════════════════════
function initKeyboardShortcuts() {
  const tabMap = { '1': 'dashboard', '2': 'inventory', '3': 'trends', '4': 'decisions', '5': 'charity-items', '6': 'charity', '7': 'transfer', '8': 'network' };

  document.addEventListener('keydown', function (e) {
    // Don't intercept when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Tab switching 1-5
    if (tabMap[e.key]) {
      e.preventDefault();
      switchTab(tabMap[e.key]);
      return;
    }

    // T — theme toggle
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleTheme();
      return;
    }

    // ? — show shortcuts
    if (e.key === '?') {
      e.preventDefault();
      document.getElementById('shortcutsOverlay').style.display = 'flex';
      return;
    }

    // Esc — close overlays
    if (e.key === 'Escape') {
      document.getElementById('shortcutsOverlay').style.display = 'none';
    }
  });
}

function closeShortcuts() {
  document.getElementById('shortcutsOverlay').style.display = 'none';
}

// ═══ URL Hash Navigation ═══════════════════════════════
function initHashNavigation() {
  window.addEventListener('hashchange', function () {
    const hash = location.hash.slice(1);
    if (hash && document.getElementById(`tab-${hash}`)) {
      switchTab(hash);
    }
  });
}

// ═══ Back to Top Button ════════════════════════════════
function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', function () {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }, { passive: true });
}

// ═══ Auto-Refresh ══════════════════════════════════════
let autoRefreshTimer = null;

function toggleAutoRefresh() {
  const btn = document.getElementById('autoRefreshBtn');
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    btn.textContent = '⏱️ Авто: вимк';
    btn.classList.remove('active');
    showToast('Автооновлення вимкнено', 'info');
  } else {
    autoRefreshTimer = setInterval(function () {
      if (!document.hidden && document.getElementById('tab-dashboard').classList.contains('active')) loadDashboard();
    }, 30000);
    btn.textContent = '⏱️ Авто: увімк';
    btn.classList.add('active');
    showToast('Автооновлення кожні 30с', 'success');
  }
}

// ═══ Confetti ══════════════════════════════════════════
function fireConfetti(count) {
  count = count || 50;
  var colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0', '#00e676', '#fdd835'];
  for (var i = 0; i < count; i++) {
    var piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    document.body.appendChild(piece);
    (function (p) {
      setTimeout(function () { p.remove(); }, 5000);
    })(piece);
  }
}

// ═══ Konami Code Easter Egg ════════════════════════════
function initKonamiCode() {
  var konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  var pos = 0;
  document.addEventListener('keydown', function (e) {
    if (e.key === konami[pos] || e.key.toLowerCase() === konami[pos]) {
      pos++;
      if (pos === konami.length) {
        pos = 0;
        fireConfetti(120);
        showToast('🎮 Konami! Ви розблокували безкінечний запас хліба! 🍞', 'success');
        showToast('...жарт, але конфеті справжні! 🎉', 'info');
      }
    } else {
      pos = 0;
    }
  });
}

// ═══ Logo Click Easter Egg ═════════════════════════════
function initLogoEasterEgg() {
  var clicks = 0;
  var logo = document.querySelector('.logo-icon');
  if (!logo) return;
  var memes = [
    '🥚 Ви знайшли пасхалку! Але яйця вже прострочені...',
    '📦 -50% на все! Шахрай, повернись у Сільпо!',
    '🧀 Сир не пахне... якщо це не списаний сир',
    '🍌 Банан скільки коштує? Не важливо, він все одно згниє',
    '🤖 AI каже: краще роздати, ніж викинути!',
    '💰 Збережено 1 грн! Нет, це просто Monopoly',
  ];
  logo.addEventListener('click', function () {
    clicks++;
    logo.classList.add('wiggle');
    setTimeout(function () { logo.classList.remove('wiggle'); }, 500);
    if (clicks >= 5) {
      clicks = 0;
      var meme = memes[Math.floor(Math.random() * memes.length)];
      showToast(meme, 'success');
      var toast = document.querySelector('.toast:last-child');
      if (toast) toast.classList.add('meme-toast');
    }
  });
}

// ═══ Meme Empty States ════════════════════════════════
function getMemeForEmptyState() {
  var memes = [
    'Тут порожньо, як у холодильнику студента 🧊',
    'Даних немає, але ви тримаєтесь молодцями 💪',
    'Схоже, всі товари вже з\'їли 🍽️',
    'Порожньо... як рахунок після Сільпо 💸',
  ];
  return memes[Math.floor(Math.random() * memes.length)];
}

// ═══ Start ══════════════════════════════════════════════
init();
