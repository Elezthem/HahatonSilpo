'use strict';

// ═══ State ═══════════════════════════════════════════════
let inventoryData = null;
let networkData = null;
let charityRequests = [];
let searchDebounceTimer = null;

// ═══ Background Particles ═════════════════════════════════
function createBackgroundParticles() {
  const container = document.getElementById('bgParticles');
  if (!container) return;
  const colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0'];
  for (let i = 0; i < 8; i++) {
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
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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
  initTheme();
  initScrollPerf();
  initKeyboardShortcuts();
  initBackToTop();
  initHashNavigation();
  initKonamiCode();
  initLogoEasterEgg();

  // Restore tab from URL hash
  const hash = location.hash.slice(1);
  if (hash && document.getElementById(`tab-${hash}`)) {
    switchTab(hash);
  }

  await checkStatus();
  await loadDashboard();
  await loadCharityRequests();
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
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'network') loadNetwork();
}

// ═══ MCP Status ═════════════════════════════════════════
async function checkStatus() {
  try {
    const status = await api('GET', '/api/status');
    const badge = document.getElementById('mcpStatus');
    const btn = document.getElementById('authBtn');

    if (status.mcpConnected) {
      badge.className = 'status-badge status-connected';
      badge.querySelector('.status-text').textContent = 'MCP Сільпо підключено';
      btn.style.display = 'none';
    } else {
      badge.className = 'status-badge status-disconnected';
      badge.querySelector('.status-text').textContent = 'MCP не підключено (демо-режим)';
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

// ═══ Dashboard ═════════════════════════════════════════
async function loadDashboard() {
  try {
    const products = await api('GET', '/api/products');
    const analysis = await api('POST', '/api/analyze', { products: products.products });
    inventoryData = analysis;

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
          <th>RNS</th>
          <th>Рівень</th>
          <th>Причина</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(p => `
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
          </tr>
        `).join('')}
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
          <th class="th-sortable" onclick="sortInventory('rns')">RNS${sortArrow('rns')}</th>
          <th class="th-sortable" onclick="sortInventory('riskLevel')">Рівень${sortArrow('riskLevel')}</th>
          <th>Причина ризику</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(p => {
          const risk = p.riskAnalysis;
          const rnsVal = risk.rns ?? Math.round(risk.probability * 100);
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

function renderCharityRequests() {
  const container = document.getElementById('charityRequestsList');

  if (charityRequests.length === 0) {
    container.innerHTML = '<p class="empty-state">Запитів поки немає<br><span class="empty-meme">' + getMemeForEmptyState() + '</span></p>';
    return;
  }

  container.innerHTML = charityRequests.map((r, i) => `
    <div class="list-item" style="animation-delay: ${i * 0.08}s">
      <div class="list-item-info">
        <div class="list-item-title">${r.organizationName}</div>
        <div class="list-item-meta">
          📦 ${r.quantity} шт ·
          📍 ${r.deliveryAddress} ·
          ⏰ ${r.deadline} дн. ·
          ${r.priority === 'high' ? '🔴 Високий' : r.priority === 'low' ? '🟢 Низький' : '🟡 Звичайний'} пріоритет
          ${r.categories && r.categories.length > 0 ? '· 🏷️ ' + r.categories.join(', ') : ''}
        </div>
      </div>
      <span class="risk-badge ${r.status === 'pending' ? 'medium' : 'low'}">${r.status}</span>
    </div>
  `).join('');
}

// ═══ Transfer Plan ══════════════════════════════════════
async function generatePlan() {
  const container = document.getElementById('transferPlans');
  container.innerHTML = '<p class="empty-state"><span class="loading-spinner"></span><br><br>Генерування плану...</p>';

  try {
    if (!inventoryData) {
      const products = await api('GET', '/api/products');
      inventoryData = await api('POST', '/api/analyze', { products: products.products });
    }

    const result = await api('POST', '/api/transfer-plan', {
      products: inventoryData.products,
      riskThreshold: 0.5,
    });

    renderTransferPlans(result);
  } catch (e) {
    container.innerHTML = '<p class="empty-state">Помилка: ' + e.message + '</p>';
    showToast('Помилка генерації плану: ' + e.message);
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
                <th>RNS</th>
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
            <th>Середній RNS</th>
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
  const tabMap = { '1': 'dashboard', '2': 'inventory', '3': 'charity', '4': 'transfer', '5': 'network' };

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
      loadDashboard();
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
