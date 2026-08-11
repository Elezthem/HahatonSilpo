'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const mcp = require('./lib/mcp-client');
const analyzer = require('./lib/analyzer');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory state for charity requests
const charityRequests = [];
let requestIdCounter = 1;

// Track whether we're using demo data
let usingDemoData = false;

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

// Seed demo requests on startup
seedDemoCharityRequests();

let demoProducts = null;

async function getProducts() {
  // Try MCP first
  try {
    const isAuth = await mcp.ensureValidToken();
    if (isAuth) {
      const toolsResult = await mcp.listTools();
      const tools = toolsResult.tools || [];
      const searchTool = tools.find(t =>
        t.name?.toLowerCase().includes('search') || t.name?.toLowerCase().includes('product')
      );
      if (searchTool) {
        const result = await mcp.callTool(searchTool.name, { query: '' });
        const mcpProducts = parseMcpProducts(result);
        if (mcpProducts.length > 0) {
          usingDemoData = false;
          return mcpProducts;
        }
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

function parseMcpProducts(mcpResult) {
  if (!mcpResult) return [];
  if (Array.isArray(mcpResult.content)) {
    for (const item of mcpResult.content) {
      if (item.type === 'text') {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) return parsed;
          if (parsed.products) return parsed.products;
          if (parsed.items) return parsed.items;
        } catch {
          // Not JSON
        }
      }
    }
  }
  return [];
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
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
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
        const isAuth = await mcp.ensureValidToken();
        sendJSON(res, 200, {
          status: 'online',
          mcpConnected: isAuth,
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

      // ─── POST /api/mcp-authenticate ────────────────────────────────
      if (pathname === '/api/mcp-authenticate' && method === 'POST') {
        try {
          await mcp.authenticate();
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
        const newRequest = {
          id: `cr${requestIdCounter++}`,
          ...body,
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
          const toolsResult = await mcp.listTools();
          const tools = toolsResult.tools || [];
          const searchTool = tools.find(t =>
            t.name?.toLowerCase().includes('search') || t.name?.toLowerCase().includes('product')
          );
          if (searchTool) {
            const result = await mcp.callTool(searchTool.name, { query: body.query || '' });
            sendJSON(res, 200, { result, tool: searchTool.name });
          } else {
            sendJSON(res, 200, { error: 'Search tool not found', availableTools: tools.map(t => t.name) });
          }
        } catch (e) {
          sendJSON(res, 500, { error: e.message });
        }
        return;
      }

      // ─── POST /api/reset-demo ─────────────────────────────────────
      if (pathname === '/api/reset-demo' && method === 'POST') {
        demoProducts = generateDemoProducts();
        sendJSON(res, 200, { success: true, message: 'Демо-дані перегенеровано', count: demoProducts.length });
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
  console.log(`║   http://localhost:${PORT}                          ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║   MCP: https://mcp.silpo.ua/mcp                  ║`);
  console.log(`║   OAuth redirect: http://localhost:9876/callback ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});
