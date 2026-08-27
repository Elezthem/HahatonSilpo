'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const mcp = require('./lib/mcp-client');
const analyzer = require('./lib/analyzer');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory state for charity requests
const charityRequests = [];
let requestIdCounter = 1;

// In-memory state for charity items (products saved from write-off)
const charityItems = [];
let charityItemIdCounter = 1;

// In-memory state for procurement decisions (buy/keep)
const decisions = {};
const pendingMcpPlans = new Map();

// Track whether we're using demo data
let usingDemoData = true;

// Visible audit trail for the hackathon demo. Never store tokens or full profile data here.
const mcpTrace = [];
let mcpHealthCache = null;
let mcpHealthCacheAt = 0;

async function getMcpHealth() {
  if (mcpHealthCache && Date.now() - mcpHealthCacheAt < 15_000) return mcpHealthCache;
  mcpHealthCache = await mcp.healthCheck();
  mcpHealthCacheAt = Date.now();
  return mcpHealthCache;
}

function addMcpTrace(tool, status, details = '') {
  mcpTrace.unshift({ tool, status, details, timestamp: new Date().toISOString() });
  if (mcpTrace.length > 100) mcpTrace.length = 100;
}

function parseMcpPayload(result) {
  if (result?.structuredContent) return result.structuredContent;
  for (const item of result?.content || []) {
    if (item.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch { /* plain-text response */ }
  }
  return null;
}

function findValue(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findValue(child, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

async function tracedToolCall(name, args = {}) {
  const started = Date.now();
  try {
    const result = await mcp.callTool(name, args);
    addMcpTrace(name, 'success', `${Date.now() - started} ms`);
    return result;
  } catch (error) {
    const message = String(error?.message || error || 'Unknown MCP error');
    addMcpTrace(name, 'error', message.substring(0, 240));
    throw new Error(message);
  }
}

async function getMcpShoppingContext() {
  const cartRef = parseMcpPayload(await tracedToolCall('silpo_get_my_shopping_cart'));
  const shoppingCartId = findValue(cartRef, ['shoppingCartId', 'cartId', 'id']);
  if (!shoppingCartId) throw new Error('MCP не повернув ID активного кошика. Створіть кошик у застосунку або на silpo.ua.');

  const cartPayload = parseMcpPayload(await tracedToolCall('silpo_get_shopping_cart_by_id', { shoppingCartId }));
  const cart = cartPayload?.cart || cartPayload;
  const branchId = findValue(cart, ['branchId']);
  let deliveryType = findValue(cart, ['deliveryType']);
  const timeslot = findValue(cart, ['timeslot']);
  if (deliveryType === 'DeliveryExpressByPromise') deliveryType = 'DeliveryHome';
  if (!branchId || !deliveryType || !timeslot?.start || !timeslot?.end) {
    throw new Error('У кошику не налаштовано магазин, тип доставки або часовий слот. Налаштуйте доставку у «Сільпо».');
  }

  const slotsPayload = parseMcpPayload(await tracedToolCall('silpo_get_time_slots', {
    branchId,
    deliveryTypes: [deliveryType],
    start: new Date().toISOString(),
    limit: 10,
  }));
  const availableSlots = [];
  const collectSlots = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.start && value.end && value.available !== false && value.isAvailable !== false) availableSlots.push(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) collectSlots(child);
  };
  collectSlots(slotsPayload);
  const sameInstant = (left, right) => {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime === rightTime : left === right;
  };
  const currentSlotIsValid = availableSlots.some(slot => sameInstant(slot.start, timeslot.start) && sameInstant(slot.end, timeslot.end));
  if (!currentSlotIsValid) {
    throw new Error('Поточний часовий слот кошика недоступний. Оберіть новий слот у «Сільпо» та повторіть спробу.');
  }

  return { shoppingCartId, branchId, deliveryType, timeslot, cart, currentSlotIsValid };
}

function extractProductArray(payload) {
  const found = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && (value.productId || (value.slug && (value.title || value.name)))) {
      found.push(value);
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(payload);
  return found;
}

function normalizeMcpProduct(product, context) {
  return {
    id: product.productId || product.id,
    productId: product.productId || product.id,
    externalProductId: product.externalProductId,
    companyId: product.companyId,
    branchId: product.branchId || context.branchId,
    name: product.title || product.name || product.displayName || 'Товар «Сільпо»',
    category: product.categoryName || product.category || 'Каталог «Сільпо»',
    price: Number(product.price?.value ?? product.price?.price ?? product.currentPrice ?? product.price ?? 0) || 0,
    stock: Number(product.stock ?? product.quantityAvailable ?? 0),
    available: product.available !== false && Number(product.stock ?? product.quantityAvailable ?? 0) > 0,
    step: Number(product.addToBasketStep ?? product.step ?? 1) || 1,
    displayRatio: product.displayRatio,
    image: product.imageUrl || product.image || product.mainImage,
    slug: product.slug,
    source: 'mcp',
  };
}

function scoreCharityProducts(products, request) {
  const terms = (request.categories || []).map(value => String(value).toLowerCase());
  const unique = new Map();
  for (const product of products) {
    if (!product.productId || !product.companyId || !product.available || product.stock <= 0) continue;
    if (!unique.has(product.productId)) unique.set(product.productId, product);
  }
  return [...unique.values()].map(product => {
    const haystack = `${product.name} ${product.category}`.toLowerCase();
    const matches = terms.filter(term => haystack.includes(term) || haystack.includes(term.replace(/.$/, ''))).length;
    const categoryScore = terms.length ? Math.round(45 * matches / terms.length) : 20;
    const stockScore = Math.min(25, Math.round(Math.log2(product.stock + 1) * 5));
    const affordabilityScore = product.price > 0 ? Math.max(3, 20 - Math.round(product.price / 25)) : 3;
    const donationScore = Math.min(100, categoryScore + stockScore + affordabilityScore + 10);
    return { ...product, donationScore, matchReason: matches ? 'відповідає категоріям запиту' : 'доступний альтернативний товар' };
  }).sort((a, b) => b.donationScore - a.donationScore || a.price - b.price);
}

function allocateCharityQuantities(products, requestedQuantity) {
  let remaining = Math.max(1, Number(requestedQuantity) || 1);
  const selected = [];
  for (const product of products.slice(0, 12)) {
    if (remaining <= 0) break;
    const step = Math.max(0.001, product.step || 1);
    const maxQuantity = Math.floor(product.stock / step) * step;
    if (maxQuantity <= 0) continue;
    const desired = Math.max(step, Math.floor(Math.min(remaining, maxQuantity) / step) * step);
    const quantity = Math.min(maxQuantity, desired);
    if (quantity <= 0 || quantity > product.stock) continue;
    selected.push({ ...product, quantity: Math.round(quantity * 1000) / 1000 });
    remaining -= quantity;
  }
  return selected;
}

async function findMcpProducts(queries) {
  const context = await getMcpShoppingContext();
  const cleanQueries = [...new Set(queries.map(q => String(q).trim()).filter(Boolean))].slice(0, 30);
  if (!cleanQueries.length) throw new Error('Додайте хоча б одну категорію або назву товару.');
  const result = await tracedToolCall('silpo_find_products_batch', {
    branchId: context.branchId,
    deliveryType: context.deliveryType,
    timeslotStart: context.timeslot.start,
    timeslotEnd: context.timeslot.end,
    products: cleanQueries,
    limit: 10,
  });
  const products = extractProductArray(parseMcpPayload(result)).map(p => normalizeMcpProduct(p, context));
  return { context, products, queries: cleanQueries };
}

// ─── Demo data ───────────────────────────────────────────────────────
// Використовується коли MCP недоступний, для демонстрації концепції

function generateDemoProducts() {
  const categories = [
    { cat: 'Молочні продукти', items: ['Молоко 2.5% 1л', 'Кефір 1% 900мл', 'Сметана 20% 350г', 'Йогурт натуральний 290г', 'Сир кисломолочний 200г'] },
    { cat: 'Хлібобулочні', items: ['Хліб білий нарізний', 'Батон «Сільпо»', 'Багет французький', 'Круасан з шоколадом'] },
    { cat: 'М\'ясо та ковбаси', items: ['Ковбаса «Докторська» 500г', 'Сосиски молочні 400г', 'Шинка куряча 300г', 'Фарш яловичий 1кг'] },
    { cat: 'Овочі та фрукти', items: ['Банани 1кг', 'Яблука Голден 1кг', 'Помідори чері 250г', 'Огірки свіжі 1кг', 'Картопля молода 1кг'] },
    { cat: 'Напої', items: ['Сік яблучний 1л', 'Вода мінеральна 1.5л', 'Лимонад 1л', 'Чай чорний 100 пакетиків'] },
    { cat: 'Бакалія', items: ['Гречка 800г', 'Макарони спагеті 500г', 'Олія соняшникова 1л', 'Цукор 1кг', 'Сіль 1кг'] },
    { cat: 'Кондитерські', items: ['Печиво «Весняне» 300г', 'Шоколад молочний 90г', 'Вафлі 200г', 'Торт «Київський» 1кг'] },
    { cat: 'Заморожені', items: ['Пельмені 450г', 'Піца заморожена 400г', 'Овочева суміш 400г', 'Морозиво 1л'] },
  ];

  const stores = [
    { id: 's1', name: 'Сільпо ТЦ «Космополіт»', address: 'Київ, вул. Гетьмана, 6' },
    { id: 's2', name: 'Сільпо ТЦ «Караван»', address: 'Київ, вул. Лугова, 12' },
    { id: 's3', name: 'Сільпо ТЦ «City Mall»', address: 'Київ, просп. Перемоги, 46' },
    { id: 's4', name: 'Сільпо ТЦ «Оазис»', address: 'Київ, вул. Бориспільська, 9' },
    { id: 's5', name: 'Сільпо ТЦ «Троєщина»', address: 'Київ, вул. Закревського, 36' },
  ];

  const products = [];
  let pid = 1;

  for (const catGroup of categories) {
    for (const itemName of catGroup.items) {
      const store = stores[Math.floor(Math.random() * stores.length)];
      const stock = Math.floor(Math.random() * 80) + 5;
      const daysToExpiry = Math.floor(Math.random() * 30) + 1;
      const salesVelocity = Math.random() * 8 + 0.5;

      // Generate sales history (30 days)
      const salesHistory = [];
      let baseDemand = salesVelocity;
      for (let d = 30; d >= 0; d--) {
        let qty = baseDemand + (Math.random() - 0.5) * baseDemand * 0.4;
        qty = Math.max(0, qty);

        // Inject anomalies — unforeseen demand drops
        if (Math.random() < 0.15) {
          qty *= 0.2 + Math.random() * 0.3; // 20-50% of normal
        }
        // Inject demand spikes
        if (Math.random() < 0.08) {
          qty *= 1.5 + Math.random() * 0.5;
        }

        const date = new Date();
        date.setDate(date.getDate() - d);
        salesHistory.push({
          date: date.toISOString().split('T')[0],
          quantity: Math.round(qty * 10) / 10,
          day: 30 - d,
        });
      }

      // Sometimes apply a declining trend
      if (Math.random() < 0.3) {
        const decline = 0.02 + Math.random() * 0.03;
        salesHistory.forEach((d, i) => {
          d.quantity *= (1 - decline * i);
          d.quantity = Math.max(0, Math.round(d.quantity * 10) / 10);
        });
      }

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysToExpiry);

      products.push({
        id: `p${pid++}`,
        name: itemName,
        category: catGroup.cat,
        storeId: store.id,
        storeName: store.name,
        storeAddress: store.address,
        stock,
        quantity: stock,
        unit: 'шт',
        price: Math.floor(Math.random() * 150) + 15,
        expiryDate: expiryDate.toISOString().split('T')[0],
        daysToExpiry,
        salesVelocity,
        salesHistory,
      });
    }
  }

  return products;
}

// Pre-seed demo charity requests so the system works out of the box
function seedDemoCharityRequests() {
  const demoRequests = [
    {
      id: `cr${requestIdCounter++}`,
      organizationName: 'Благодійний фонд «Разом»',
      categories: ['молочн', 'хліб', 'бакал'],
      quantity: 50,
      priority: 'high',
      deliveryAddress: 'Київ, вул. Межигірська, 24',
      deadline: 3,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      status: 'pending',
    },
    {
      id: `cr${requestIdCounter++}`,
      organizationName: 'ГО «Карітас Україна»',
      categories: ['бакал', 'овоч', 'заморож'],
      quantity: 80,
      priority: 'normal',
      deliveryAddress: 'Київ, вул. Велика Васильківська, 30',
      deadline: 5,
      createdAt: new Date(Date.now() - 43200000).toISOString(),
      status: 'pending',
    },
    {
      id: `cr${requestIdCounter++}`,
      organizationName: 'Фонд «Табличка»',
      categories: ['напій', 'кондит', 'хліб'],
      quantity: 30,
      priority: 'normal',
      deliveryAddress: 'Київ, вул. Прорізна, 14',
      deadline: 7,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      status: 'pending',
    },
  ];
  charityRequests.push(...demoRequests);
}

// Seed demo charity items (products saved from write-off)
function seedDemoCharityItems() {
  const demo = [
    { productName: 'Кефір 1% 900мл', category: 'Молочні продукти', storeName: 'Сільпо ТЦ «Космополіт»', storeAddress: 'Київ, вул. Гетьмана, 6', stock: 24, quantity: 24, price: 32, daysToExpiry: 4, rns: 78, riskLevel: 'high', reason: 'виявлено аномальне зниження попиту; короткий термін придатності (4 дн.)' },
    { productName: 'Хліб білий нарізний', category: 'Хлібобулочні', storeName: 'Сільпо ТЦ «Караван»', storeAddress: 'Київ, вул. Лугова, 12', stock: 15, quantity: 15, price: 18, daysToExpiry: 2, rns: 85, riskLevel: 'critical', reason: 'виявлено аномальне зниження попиту; тренд зниження продажів' },
    { productName: 'Печиво «Весняне» 300г', category: 'Кондитерські', storeName: 'Сільпо ТЦ «City Mall»', storeAddress: 'Київ, просп. Перемоги, 46', stock: 40, quantity: 40, price: 45, daysToExpiry: 12, rns: 62, riskLevel: 'high', reason: 'надлишковий залишок відносно прогнозованого попиту' },
  ];
  for (const item of demo) {
    charityItems.push({ id: `ci${charityItemIdCounter++}`, ...item, status: 'available', addedAt: new Date(Date.now() - Math.random() * 86400000).toISOString() });
  }
}

// Seed demo decisions
function seedDemoDecisions() {
  const demo = [
    { productId: 'p1', productName: 'Молоко 2.5% 1л', buy: true, keep: true },
    { productId: 'p3', productName: 'Сметана 20% 350г', buy: false, keep: true },
    { productId: 'p6', productName: 'Хліб білий нарізний', buy: false, keep: false },
  ];
  for (const d of demo) {
    decisions[d.productId] = { ...d, decidedAt: new Date(Date.now() - Math.random() * 3600000).toISOString() };
  }
}

// Seed demo requests on startup
seedDemoCharityRequests();
seedDemoCharityItems();
seedDemoDecisions();

let demoProducts = null;
let productsCache = null;
let productsCacheAt = 0;
let productsPromise = null;
const PRODUCTS_CACHE_TTL = 5 * 60_000;

async function getProducts() {
  if (productsCache && Date.now() - productsCacheAt < PRODUCTS_CACHE_TTL) return productsCache;
  if (productsPromise) return productsPromise;

  productsPromise = loadProducts();
  try {
    productsCache = await productsPromise;
    productsCacheAt = Date.now();
    return productsCache;
  } finally {
    productsPromise = null;
  }
}

async function loadProducts() {
  try {
    if (await mcp.ensureValidToken()) {
      const { products } = await findMcpProducts(['молоко', 'хліб', 'крупа', 'вода', 'дитяче харчування']);
      if (products.length) {
        usingDemoData = false;
        return products;
      }
    }
  } catch (e) {
    console.log('[Server] MCP unavailable, using demo data:', e.message);
  }

  // Fallback to demo data
  if (!demoProducts) {
    demoProducts = generateDemoProducts();
  }
  usingDemoData = true;
  return demoProducts;
}

// ─── HTTP Server ─────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
  let filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(filePath);

  if (!ext || !MIME_TYPES[ext]) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    sendJSON(res, 200, {});
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // API routes
  if (pathname.startsWith('/api/')) {
    try {
      // ─── GET /api/status ──────────────────────────────────────────
      if (pathname === '/api/status' && method === 'GET') {
        const health = await getMcpHealth();
        sendJSON(res, 200, {
          status: 'online',
          mcpAuthenticated: health.authenticated,
          mcpConnected: health.reachable,
          mcpToolCount: health.toolCount,
          mcpError: health.error,
          dataSource: usingDemoData ? 'demo' : 'mcp',
          mcpServer: 'https://mcp.silpo.ua/mcp',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // ─── GET /api/mcp-tools ────────────────────────────────────────
      if (pathname === '/api/mcp-tools' && method === 'GET') {
        try {
          await mcp.initialize();
          const result = await mcp.listTools();
          sendJSON(res, 200, { tools: result.tools || [], count: (result.tools || []).length });
        } catch (e) {
          sendJSON(res, 200, { tools: [], count: 0, error: e.message, demo: true });
        }
        return;
      }

      // Live, privacy-safe proof that authenticated MCP tools execute even when no cart exists.
      if (pathname === '/api/mcp-proof' && method === 'GET') {
        try {
          const [loyaltyResult, restrictionsResult, ordersResult] = await Promise.all([
            tracedToolCall('silpo_get_loyalty_info'),
            tracedToolCall('silpo_get_my_food_restrictions'),
            tracedToolCall('silpo_get_my_online_orders', { limit: 3 }),
          ]);
          const loyalty = parseMcpPayload(loyaltyResult) || {};
          const restrictions = parseMcpPayload(restrictionsResult) || {};
          const orders = parseMcpPayload(ordersResult) || {};
          sendJSON(res, 200, {
            success: true,
            source: 'mcp',
            checks: [
              { tool: 'silpo_get_loyalty_info', success: loyalty.success !== false, summary: 'Авторизований профіль лояльності доступний' },
              { tool: 'silpo_get_my_food_restrictions', success: restrictions.success !== false, summary: `${Array.isArray(restrictions.restrictions) ? restrictions.restrictions.length : 0} харчових обмежень у профілі` },
              { tool: 'silpo_get_my_online_orders', success: orders.success !== false, summary: `${Array.isArray(orders.orders) ? orders.orders.length : 0} останніх онлайн-замовлень отримано` },
            ],
            trace: mcpTrace.slice(0, 10),
            checkedAt: new Date().toISOString(),
          });
        } catch (error) {
          sendJSON(res, 502, { error: error.message, code: 'MCP_PROOF_FAILED', trace: mcpTrace.slice(0, 10) });
        }
        return;
      }

      // ─── POST /api/mcp-authenticate ────────────────────────────────
      if (pathname === '/api/mcp-authenticate' && method === 'POST') {
        try {
          await mcp.authenticate();
          mcpHealthCache = null;
          productsCache = null;
          sendJSON(res, 200, { success: true, message: 'Авторизація успішна' });
        } catch (e) {
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // ─── GET /api/products ────────────────────────────────────────
      if (pathname === '/api/products' && method === 'GET') {
        const products = await getProducts();
        sendJSON(res, 200, { products, count: products.length, source: usingDemoData ? 'demo' : 'mcp' });
        return;
      }

      // One round-trip for the initial screen instead of products + analyze.
      if (pathname === '/api/dashboard' && method === 'GET') {
        const products = await getProducts();
        const analysis = analyzer.analyzeInventory(products);
        sendJSON(res, 200, {
          ...analysis,
          source: usingDemoData ? 'demo' : 'mcp',
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // ─── POST /api/analyze ────────────────────────────────────────
      if (pathname === '/api/analyze' && method === 'POST') {
        const body = await readBody(req);
        const products = body.products || await getProducts();
        const result = analyzer.analyzeInventory(products);
        sendJSON(res, 200, result);
        return;
      }

      // ─── GET /api/network ─────────────────────────────────────────
      if (pathname === '/api/network' && method === 'GET') {
        const products = await getProducts();
        const result = analyzer.analyzeNetwork(products);
        sendJSON(res, 200, result);
        return;
      }

      // ─── POST /api/charity-request ────────────────────────────────
      if (pathname === '/api/charity-request' && method === 'POST') {
        const body = await readBody(req);
        const organizationName = String(body.organizationName || '').trim();
        const deliveryAddress = String(body.deliveryAddress || '').trim();
        const quantity = Number(body.quantity);
        if (!organizationName || !deliveryAddress || !Number.isFinite(quantity) || quantity < 1) {
          sendJSON(res, 400, { error: 'Перевірте назву організації, адресу та кількість' });
          return;
        }
        const newRequest = {
          id: `cr${requestIdCounter++}`,
          organizationName: organizationName.substring(0, 120),
          deliveryAddress: deliveryAddress.substring(0, 240),
          quantity: Math.min(Math.floor(quantity), 10000),
          categories: Array.isArray(body.categories) ? body.categories.map(String).slice(0, 30) : [],
          priority: ['high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal',
          deadline: Math.max(1, Math.min(Number(body.deadline) || 3, 365)),
          createdAt: new Date().toISOString(),
          status: 'pending',
        };
        charityRequests.push(newRequest);
        sendJSON(res, 201, newRequest);
        return;
      }

      // ─── GET /api/charity-requests ────────────────────────────────
      if (pathname === '/api/charity-requests' && method === 'GET') {
        sendJSON(res, 200, { requests: charityRequests });
        return;
      }

      // ─── POST /api/mcp-charity-plan ──────────────────────────────
      // Builds a charity basket from real Silpo catalog data. No write happens until confirmed.
      if (pathname === '/api/mcp-charity-plan' && method === 'POST') {
        const body = await readBody(req);
        const request = charityRequests.find(item => item.id === body.requestId)
          || charityRequests.find(item => item.status === 'pending');
        if (!request) {
          sendJSON(res, 400, { error: 'Спочатку створіть запит благодійної організації' });
          return;
        }
        try {
          const found = await findMcpProducts(request.categories || []);
          const ranked = scoreCharityProducts(found.products, request);
          const selected = allocateCharityQuantities(ranked, request.quantity);
          const planId = crypto.randomUUID();
          pendingMcpPlans.set(planId, {
            shoppingCartId: found.context.shoppingCartId,
            selected,
            requestId: request.id,
            expiresAt: Date.now() + 15 * 60_000,
            confirmed: false,
          });
          sendJSON(res, 200, {
            source: 'mcp',
            request,
            selected,
            totalItems: selected.length,
            estimatedTotal: selected.reduce((sum, item) => sum + item.price * item.quantity, 0),
            shoppingCartId: found.context.shoppingCartId,
            planId,
            slotValidated: found.context.currentSlotIsValid,
            trace: mcpTrace.slice(0, 10),
            canConfirm: selected.length > 0,
          });
        } catch (error) {
          const cartMissing = /get-my-shopping-cart|resource not found/i.test(error.message);
          sendJSON(res, 409, {
            error: cartMissing
              ? 'В акаунті «Сільпо» немає активного кошика'
              : error.message,
            code: cartMissing ? 'CART_NOT_FOUND' : 'MCP_PLAN_FAILED',
            source: 'mcp',
            trace: mcpTrace.slice(0, 10),
          });
        }
        return;
      }

      // ─── POST /api/mcp-charity-confirm ───────────────────────────
      if (pathname === '/api/mcp-charity-confirm' && method === 'POST') {
        const body = await readBody(req);
        if (!body.confirmed) {
          sendJSON(res, 400, { error: 'Потрібне явне підтвердження перед зміною кошика' });
          return;
        }
        const plan = pendingMcpPlans.get(body.planId);
        if (!plan || plan.expiresAt < Date.now() || plan.confirmed) {
          sendJSON(res, 409, { error: 'План прострочений або вже виконаний. Згенеруйте його повторно.', code: 'PLAN_EXPIRED' });
          return;
        }
        const safeProducts = plan.selected.map(item => ({
          productId: item.productId,
          companyId: item.companyId,
          branchId: item.branchId,
          quantity: item.quantity,
          addQuantity: true,
        })).filter(item => item.productId && item.companyId && item.branchId);
        if (!safeProducts.length) {
          sendJSON(res, 400, { error: 'План не містить коректних MCP-товарів' });
          return;
        }
        try {
          await tracedToolCall('silpo_add_or_update_cart_products', {
            shoppingCartId: plan.shoppingCartId,
            products: safeProducts,
          });
          const verified = await tracedToolCall('silpo_get_shopping_cart_by_id', {
            shoppingCartId: plan.shoppingCartId,
          });
          const verifiedPayload = parseMcpPayload(verified);
          const validations = findValue(verifiedPayload, ['validations']) || [];
          const blockingErrors = Array.isArray(validations)
            ? validations.filter(item => /error|critical/i.test(String(item.level || item.type || item.severity || '')))
            : [];
          plan.confirmed = true;
          sendJSON(res, 200, {
            success: true,
            message: 'Товари додано через MCP «Сільпо» та повторно перевірено',
            cart: verifiedPayload,
            validations,
            blockingErrors,
            checkoutWebLink: findValue(verifiedPayload, ['checkoutWebLink']),
            checkoutMobileLink: findValue(verifiedPayload, ['checkoutMobileLink']),
            trace: mcpTrace.slice(0, 10),
          });
        } catch (error) {
          sendJSON(res, 409, { error: error.message, trace: mcpTrace.slice(0, 10) });
        }
        return;
      }

      if (pathname === '/api/mcp-trace' && method === 'GET') {
        sendJSON(res, 200, { trace: mcpTrace });
        return;
      }

      // ─── POST /api/transfer-plan ──────────────────────────────────
      if (pathname === '/api/transfer-plan' && method === 'POST') {
        const body = await readBody(req);
        const products = body.products || await getProducts();
        const requests = body.charityRequests || charityRequests;

        if (!requests || requests.length === 0) {
          sendJSON(res, 400, { error: 'Немає запитів від благодійних організацій' });
          return;
        }

        const plans = analyzer.generateTransferPlan(products, requests, {
          riskThreshold: body.riskThreshold || 0.5,
          maxStoresPerRequest: body.maxStoresPerRequest || 5,
        });

        sendJSON(res, 200, {
          plans,
          totalProductsAllocated: plans.reduce((s, p) => s + p.totalItems, 0),
          totalUnitsAllocated: plans.reduce((s, p) => s + p.totalQuantity, 0),
          totalSocialImpact: plans.reduce((s, p) => s + p.socialImpact.peopleServed, 0),
          avgDonationScore: plans.length > 0
            ? Math.round(plans.reduce((s, p) => s + p.avgDonationScore, 0) / plans.length)
            : 0,
        });
        return;
      }

      // ─── POST /api/search (MCP search) ────────────────────────────
      if (pathname === '/api/search' && method === 'POST') {
        const body = await readBody(req);
        try {
          const found = await findMcpProducts([body.query || '']);
          sendJSON(res, 200, { products: found.products, source: 'mcp', tool: 'silpo_find_products_batch' });
        } catch (e) {
          sendJSON(res, 500, { error: e.message });
        }
        return;
      }

      // ─── POST /api/reset-demo ─────────────────────────────────────
      if (pathname === '/api/reset-demo' && method === 'POST') {
        demoProducts = generateDemoProducts();
        productsCache = demoProducts;
        productsCacheAt = Date.now();
        usingDemoData = true;
        sendJSON(res, 200, { success: true, message: 'Демо-дані перегенеровано', count: demoProducts.length });
        return;
      }

      // ─── POST /api/charity-item ───────────────────────────────────
      if (pathname === '/api/charity-item' && method === 'POST') {
        const body = await readBody(req);
        const stock = Number(body.stock) || 0;
        const quantity = Number(body.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          sendJSON(res, 400, { error: 'Quantity must be a positive integer' });
          return;
        }
        if (stock > 0 && quantity > stock) {
          sendJSON(res, 400, { error: 'Quantity exceeds available stock' });
          return;
        }
        // Prevent duplicates
        const existing = charityItems.find(ci => ci.productId === body.productId);
        if (existing) {
          existing.quantity = quantity;
          existing.stock = stock;
          existing.price = body.price;
          existing.daysToExpiry = body.daysToExpiry;
          existing.rns = body.rns;
          existing.riskLevel = body.riskLevel;
          existing.reason = body.reason;
          existing.updatedAt = new Date().toISOString();
          sendJSON(res, 200, existing);
          return;
        }
        const newItem = {
          id: `ci${charityItemIdCounter++}`,
          productId: body.productId,
          productName: body.productName,
          category: body.category,
          storeName: body.storeName,
          storeAddress: body.storeAddress,
          stock: stock,
          quantity: quantity,
          price: body.price,
          daysToExpiry: body.daysToExpiry,
          rns: body.rns,
          riskLevel: body.riskLevel,
          reason: body.reason,
          status: 'available',
          addedAt: new Date().toISOString(),
        };
        charityItems.push(newItem);
        sendJSON(res, 201, newItem);
        return;
      }

      // ─── GET /api/charity-items ───────────────────────────────────
      if (pathname === '/api/charity-items' && method === 'GET') {
        sendJSON(res, 200, { items: charityItems, count: charityItems.length });
        return;
      }

      // ─── DELETE /api/charity-item ─────────────────────────────────
      if (pathname === '/api/charity-item' && method === 'DELETE') {
        const body = await readBody(req);
        const idx = charityItems.findIndex(ci => ci.productId === body.productId);
        if (idx !== -1) {
          const removed = charityItems.splice(idx, 1)[0];
          sendJSON(res, 200, { success: true, removed });
        } else {
          sendJSON(res, 404, { error: 'Charity item not found' });
        }
        return;
      }

      // ─── POST /api/decision ──────────────────────────────────────
      if (pathname === '/api/decision' && method === 'POST') {
        const body = await readBody(req);
        decisions[body.productId] = {
          productId: body.productId,
          productName: body.productName,
          buy: !!body.buy,
          keep: !!body.keep,
          decidedAt: new Date().toISOString(),
        };
        sendJSON(res, 200, decisions[body.productId]);
        return;
      }

      // ─── GET /api/decisions ──────────────────────────────────────
      if (pathname === '/api/decisions' && method === 'GET') {
        sendJSON(res, 200, { decisions: Object.values(decisions), count: Object.keys(decisions).length });
        return;
      }

      // ─── GET /api/trends ─────────────────────────────────────────
      if (pathname === '/api/trends' && method === 'GET') {
        const products = await getProducts();
        const analyzed = products.map(p => {
          const risk = analyzer.predictWriteOffRisk(p);
          const analysis = risk.analysis || {};
          // Build moving average series for charting
          const sales = (p.salesHistory || []);
          const windowSize = Math.min(7, Math.floor(sales.length / 2) || 1);
          const movingAvg = sales.map((_, i) => {
            const start = Math.max(0, i - windowSize + 1);
            const window = sales.slice(start, i + 1);
            return window.reduce((s, d) => s + d.quantity, 0) / window.length;
          });

          // Find donation point: first day where projected remaining > 0 significantly
          let donationDay = null;
          const adjustedRate = risk.adjustedRate || analysis.meanSalesRate || p.salesVelocity || 0;
          if (adjustedRate > 0 && risk.projectedRemaining > 0) {
            const daysToSellAll = (p.stock || 0) / adjustedRate;
            if (daysToSellAll > (p.daysToExpiry || 0)) {
              donationDay = Math.floor(p.daysToExpiry * 0.7); // 70% of shelf life = action point
            }
          }

          return {
            id: p.id,
            name: p.name,
            category: p.category,
            storeName: p.storeName,
            storeAddress: p.storeAddress,
            stock: p.stock,
            price: p.price,
            daysToExpiry: p.daysToExpiry,
            expiryDate: p.expiryDate,
            salesVelocity: p.salesVelocity,
            salesHistory: sales,
            movingAvg,
            anomalies: analysis.anomalies || [],
            trend: analysis.trend || 'stable',
            volatility: analysis.volatility || 0,
            rns: risk.rns,
            riskLevel: risk.riskLevel,
            reason: risk.reason,
            projectedRemaining: risk.projectedRemaining,
            projectedSales: risk.projectedSales,
            adjustedRate,
            donationDay,
          };
        });

        // Category-level aggregates
        const catMap = {};
        for (const p of analyzed) {
          const cat = p.category || 'Інше';
          if (!catMap[cat]) catMap[cat] = { category: cat, products: 0, atRisk: 0, avgRNS: 0, totalRemaining: 0, trendCounts: { declining: 0, stable: 0, growing: 0 } };
          catMap[cat].products++;
          if (p.rns >= 50) catMap[cat].atRisk++;
          catMap[cat].avgRNS += p.rns;
          catMap[cat].totalRemaining += p.projectedRemaining;
          catMap[cat].trendCounts[p.trend] = (catMap[cat].trendCounts[p.trend] || 0) + 1;
        }
        const categoryTrends = Object.values(catMap).map(c => ({ ...c, avgRNS: Math.round(c.avgRNS / c.products) }));
        categoryTrends.sort((a, b) => b.avgRNS - a.avgRNS);

        sendJSON(res, 200, { products: analyzed, categoryTrends });
        return;
      }

      // 404 for unknown API routes
      sendJSON(res, 404, { error: 'Not found' });
      return;
    } catch (e) {
      console.error('[Server] API error:', e);
      sendJSON(res, 500, { error: e.message });
      return;
    }
  }

  // Serve static files
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   AI Charity Connect — запущено!                 ║`);
  console.log(`║   ${PUBLIC_BASE_URL}                          ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║   MCP: https://mcp.silpo.ua/mcp                  ║`);
  console.log(`║   OAuth redirect: ${(process.env.MCP_REDIRECT_URI || 'http://localhost:9876/callback')} ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});
