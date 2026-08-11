'use strict';

/**
 * AI Charity Connect — Demand Prediction & Charity Matching Engine
 *
 * Ключова інновація: НЕ просто продукти з добігаючим терміном придатності,
 * а продукти з ПОРОГОВО ВИСОКОЮ ймовірністю нереалізації в межах строку
 * придатності через непередбачувані обставини, що вплинули на попит.
 */

// ─── Demand Anomaly Detection ────────────────────────────────────────

/**
 * Аналізує історію продажів та виявляє аномалії попиту.
 * Аномалія = непередбачувана обставина, що вплинула на попит.
 */
function detectDemandAnomalies(salesHistory) {
  if (!salesHistory || salesHistory.length < 3) {
    return { anomalies: [], trend: 'stable', volatility: 0 };
  }

  const sales = salesHistory.map(d => ({
    date: d.date,
    quantity: d.quantity,
    day: d.day || null,
  }));

  // Розрахунок ковзного середнього (window = 7 днів або менше)
  const windowSize = Math.min(7, Math.floor(sales.length / 2));
  const movingAvg = [];
  for (let i = 0; i < sales.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = sales.slice(start, i + 1);
    const avg = window.reduce((s, d) => s + d.quantity, 0) / window.length;
    movingAvg.push(avg);
  }

  // Виявлення аномалій: відхилення > 2 стандартних відхилень
  const deviations = sales.map((d, i) => Math.abs(d.quantity - movingAvg[i]));
  const meanDeviation = deviations.reduce((s, d) => s + d, 0) / deviations.length;
  const variance = deviations.reduce((s, d) => s + Math.pow(d - meanDeviation, 2), 0) / deviations.length;
  const stdDeviation = Math.sqrt(variance);

  const anomalies = [];
  sales.forEach((d, i) => {
    if (stdDeviation > 0 && deviations[i] > 2 * stdDeviation) {
      anomalies.push({
        date: d.date,
        expected: Math.round(movingAvg[i]),
        actual: d.quantity,
        deviation: d.quantity - movingAvg[i],
        type: d.quantity < movingAvg[i] ? 'demand_drop' : 'demand_spike',
        severity: Math.min(1, Math.abs(deviations[i]) / (3 * stdDeviation)),
      });
    }
  });

  // Визначення загального тренду
  const recentAvg = movingAvg.slice(-3).reduce((s, d) => s + d, 0) / Math.min(3, movingAvg.length);
  const olderAvg = movingAvg.slice(0, 3).reduce((s, d) => s + d, 0) / Math.min(3, movingAvg.length);
  const trendDelta = (recentAvg - olderAvg) / (olderAvg || 1);
  let trend = 'stable';
  if (trendDelta < -0.15) trend = 'declining';
  else if (trendDelta > 0.15) trend = 'growing';

  // Волатильність — міра непередбачуваності
  const volatility = stdDeviation / (meanDeviation || 1);

  return { anomalies, trend, volatility, meanSalesRate: recentAvg };
}

// ─── Write-off Risk Prediction ───────────────────────────────────────

/**
 * Прогнозує ймовірність нереалізації продукту до завершення терміну придатності.
 *
 * Формула: P(write-off) = 1 - P(sell_all_before_expiry)
 *
 * P(sell_all_before_expiry) розраховується на основі:
 * - поточного залишку
 * - прогнозованої швидкості продажу (з урахуванням аномалій)
 * - кількості днів до завершення терміну
 * - волатильності попиту
 *
 * RNS (Risk of Non-Sale) = P(write-off) * 100%
 */
function predictWriteOffRisk(product) {
  const stock = product.stock || product.quantity || 0;
  const daysToExpiry = product.daysToExpiry ?? Math.ceil(
    (new Date(product.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
  );

  if (daysToExpiry <= 0) {
    return {
      probability: 1.0,
      rns: 100,
      riskLevel: 'critical',
      reason: 'Термін придатності вже закінчився',
      projectedRemaining: stock,
      projectedSales: 0,
      analysis: { anomalies: [], trend: 'stable', volatility: 0 },
    };
  }

  if (stock <= 0) {
    return {
      probability: 0,
      rns: 0,
      riskLevel: 'none',
      reason: 'Товар відсутній на складі',
      projectedRemaining: 0,
      projectedSales: 0,
      analysis: { anomalies: [], trend: 'stable', volatility: 0 },
    };
  }

  // Аналіз попиту
  const salesHistory = product.salesHistory || [];
  const analysis = detectDemandAnomalies(salesHistory);

  // Базова швидкість продажу
  let baseRate = analysis.meanSalesRate || product.salesVelocity || 0;

  // Коригування швидкості з урахуванням аномалій
  let adjustedRate = baseRate;
  let anomalyImpact = 0;

  if (analysis.anomalies.length > 0) {
    // Якщо є аномалії зниження попиту — зменшуємо прогноз
    const demandDrops = analysis.anomalies.filter(a => a.type === 'demand_drop');
    if (demandDrops.length > 0) {
      const avgDropSeverity = demandDrops.reduce((s, a) => s + a.severity, 0) / demandDrops.length;
      anomalyImpact = avgDropSeverity * 0.5;
      adjustedRate = baseRate * (1 - anomalyImpact);
    }
  }

  // Тренд: якщо попит падає — зменшуємо прогнозовану швидкість
  if (analysis.trend === 'declining') {
    adjustedRate *= 0.75;
  }

  // Прогнозований обсяг продажу до закінчення терміну
  const projectedSales = adjustedRate * daysToExpiry;

  // Прогнозований залишок після завершення терміну
  const projectedRemaining = Math.max(0, stock - projectedSales);

  // Ймовірність нереалізації (write-off risk)
  const expectedDaily = adjustedRate;
  const stdDaily = expectedDaily * (analysis.volatility || 0.3);

  if (expectedDaily <= 0) {
    return {
      probability: 1.0,
      rns: 100,
      riskLevel: 'critical',
      reason: 'Попит відсутній — продаж не прогнозується',
      projectedRemaining: stock,
      projectedSales: 0,
      analysis,
    };
  }

  // Кількість днів, потрібних для продажу всього залишку при прогнозованій швидкості
  const daysToSellAll = stock / expectedDaily;

  // P(sell all before expiry) через апроксимацію кумулятивного розподілу
  const z = (daysToExpiry - daysToSellAll) / (Math.sqrt(daysToExpiry) * (stdDaily / expectedDaily) + 0.001);
  const pSellAll = normalCDF(z);
  const pWriteOff = 1 - pSellAll;

  let riskLevel = 'low';
  if (pWriteOff >= 0.8) riskLevel = 'critical';
  else if (pWriteOff >= 0.6) riskLevel = 'high';
  else if (pWriteOff >= 0.4) riskLevel = 'medium';

  // Причина ризику
  const reasons = [];
  if (analysis.anomalies.filter(a => a.type === 'demand_drop').length > 0) {
    reasons.push('виявлено аномальне зниження попиту');
  }
  if (analysis.trend === 'declining') {
    reasons.push('спостерігається тренд зниження продажів');
  }
  if (analysis.volatility > 0.5) {
    reasons.push('висока волатильність попиту');
  }
  if (daysToExpiry < 7) {
    reasons.push(`короткий термін придатності (${daysToExpiry} дн.)`);
  }
  if (stock / (expectedDaily * daysToExpiry) > 1.5) {
    reasons.push('надлишковий залишок відносно прогнозованого попиту');
  }
  const reason = reasons.length > 0 ? reasons.join('; ') : 'прогноз попиту в межах норми';

  return {
    probability: Math.round(pWriteOff * 100) / 100,
    rns: Math.round(pWriteOff * 100),
    riskLevel,
    reason,
    projectedRemaining: Math.round(projectedRemaining),
    projectedSales: Math.round(projectedSales),
    daysToSellAll: Math.round(daysToSellAll * 10) / 10,
    adjustedRate: Math.round(adjustedRate * 100) / 100,
    anomalyImpact: Math.round(anomalyImpact * 100) / 100,
    analysis,
  };
}

// Нормальний кумулятивний розподіл (апроксимація Abramowitz & Stegun 26.2.17)
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return Math.max(0, Math.min(1, p));
}

// ─── AI Donation Score ──────────────────────────────────────────────

/**
 * AI Donation Score — інтегральний показник пріоритетності передачі.
 *
 * Компоненти (сума = 100):
 * - RNS (ризик нереалізації): 35 балів
 * - Термін придатності (безпечний залишок): 20 балів
 * - Відповідність запиту фонду: 20 балів
 * - Логістична доступність: 10 балів
 * - Достатня кількість: 15 балів
 */
function calculateDonationScore(product, riskAnalysis, charityRequest) {
  // 1. RNS компонент (0-35)
  const rnsScore = (riskAnalysis.rns || 0) / 100 * 35;

  // 2. Термін придатності — продукт має бути безпечним для споживання (0-20)
  const daysToExpiry = product.daysToExpiry ?? Math.ceil(
    (new Date(product.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
  );
  let shelfLifeScore = 0;
  if (daysToExpiry >= 7) shelfLifeScore = 20;
  else if (daysToExpiry >= 3) shelfLifeScore = 15;
  else if (daysToExpiry >= 1) shelfLifeScore = 5;

  // 3. Відповідність запиту благодійної організації (0-20)
  let matchScore = 0;
  let matchDetails = [];

  if (charityRequest) {
    // Категорійний збіг
    if (charityRequest.categories && charityRequest.categories.length > 0) {
      const productCategory = (product.category || '').toLowerCase();
      const matched = charityRequest.categories.some(
        cat => productCategory.includes(cat.toLowerCase()) || cat.toLowerCase().includes(productCategory)
      );
      if (matched) {
        matchScore += 10;
        matchDetails.push('категорія відповідає');
      }
    } else {
      matchScore += 5;
    }

    // Семантичний збіг назви
    if (charityRequest.keywords && charityRequest.keywords.length > 0) {
      const productName = (product.name || '').toLowerCase();
      const kwMatch = charityRequest.keywords.filter(kw => productName.includes(kw.toLowerCase()));
      if (kwMatch.length > 0) {
        matchScore += 10 * (kwMatch.length / charityRequest.keywords.length);
        matchDetails.push(`ключові слова: ${kwMatch.join(', ')}`);
      }
    }
  }

  // 4. Логістична доступність (0-10)
  // У реальній системі — відстань до організації.
  // Для демо: всі магазини в Києві — базовий бал 7
  const logisticsScore = 7;

  // 5. Достатня кількість для передачі (0-15)
  const available = riskAnalysis.projectedRemaining || product.stock || 0;
  const needed = charityRequest?.quantity || charityRequest?.minQuantity || 1;
  const quantityRatio = available / needed;
  let quantityScore = 0;
  if (quantityRatio >= 1) quantityScore = 15;
  else if (quantityRatio >= 0.5) quantityScore = 10;
  else if (quantityRatio >= 0.25) quantityScore = 5;

  const total = Math.round(rnsScore + shelfLifeScore + matchScore + logisticsScore + quantityScore);

  return {
    score: total,
    components: {
      rns: Math.round(rnsScore),
      shelfLife: shelfLifeScore,
      match: Math.round(matchScore),
      logistics: logisticsScore,
      quantity: quantityScore,
    },
    matchDetails,
  };
}

// ─── Multi-Criteria Matching ─────────────────────────────────────────

/**
 * Оцінка відповідності продукту запиту благодійної організації.
 */
function matchProductToRequest(product, charityRequest) {
  let score = 0;
  const matchDetails = [];

  // 1. Категорійний збіг
  if (charityRequest.categories && charityRequest.categories.length > 0) {
    const productCategory = (product.category || '').toLowerCase();
    const matchedCategory = charityRequest.categories.some(
      cat => productCategory.includes(cat.toLowerCase()) || cat.toLowerCase().includes(productCategory)
    );
    if (matchedCategory) {
      score += 30;
      matchDetails.push('категорія відповідає запиту');
    }
  } else {
    score += 15;
  }

  // 2. Семантичний збіг назви
  if (charityRequest.keywords && charityRequest.keywords.length > 0) {
    const productName = (product.name || '').toLowerCase();
    const keywordMatch = charityRequest.keywords.filter(kw =>
      productName.includes(kw.toLowerCase())
    );
    if (keywordMatch.length > 0) {
      score += 20 * (keywordMatch.length / charityRequest.keywords.length);
      matchDetails.push(`збіг за ключовими словами: ${keywordMatch.join(', ')}`);
    }
  }

  // 3. Пріоритет ризику нереалізації
  const risk = product.riskAnalysis || predictWriteOffRisk(product);
  if (risk.riskLevel === 'critical') {
    score += 25;
    matchDetails.push('критичний ризик нереалізації');
  } else if (risk.riskLevel === 'high') {
    score += 20;
    matchDetails.push('високий ризик нереалізації');
  } else if (risk.riskLevel === 'medium') {
    score += 10;
    matchDetails.push('середній ризик нереалізації');
  }

  // 4. Кількість — чи достатньо продукту для передачі
  const availableQty = risk.projectedRemaining || product.stock || 0;
  if (availableQty >= (charityRequest.minQuantity || 1)) {
    score += 15;
    matchDetails.push(`доступна кількість: ${availableQty}`);
  }

  // 5. Термін придатності — продукт має бути безпечним
  const daysToExpiry = product.daysToExpiry ?? Math.ceil(
    (new Date(product.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
  );
  if (daysToExpiry >= 3) {
    score += 10;
    matchDetails.push(`термін придатності: ${daysToExpiry} дн.`);
  } else if (daysToExpiry < 1) {
    score -= 30;
    matchDetails.push('термін придатності критично короткий');
  }

  return { score: Math.round(score), matchDetails, availableQty };
}

// ─── Transfer Plan Generation ────────────────────────────────────────

/**
 * Формування оптимального плану передачі продукції.
 * Використовує AI Donation Score для ранжування.
 */
function generateTransferPlan(products, charityRequests, options = {}) {
  const riskThreshold = options.riskThreshold || 0.5;
  const maxStoresPerRequest = options.maxStoresPerRequest || 5;

  // Фільтрація: лише продукти з високим ризиком нереалізації
  const atRiskProducts = products.map(p => {
    const risk = predictWriteOffRisk(p);
    return { ...p, riskAnalysis: risk };
  }).filter(p => p.riskAnalysis.probability >= riskThreshold);

  const plans = [];

  for (const request of charityRequests) {
    // Розрахунок AI Donation Score для кожного кандидата
    const candidates = atRiskProducts.map(p => {
      const match = matchProductToRequest(p, request);
      const donation = calculateDonationScore(p, p.riskAnalysis, request);
      return { product: p, match, donation };
    }).filter(c => c.match.score > 0)
      .sort((a, b) => b.donation.score - a.donation.score);

    // Вибір найкращих кандидатів
    const selected = candidates.slice(0, maxStoresPerRequest * 10);
    let remainingNeeded = request.quantity || request.minQuantity || 1;
    const planItems = [];
    const stores = new Set();

    for (const candidate of selected) {
      if (remainingNeeded <= 0) break;

      const available = candidate.match.availableQty;
      const allocated = Math.min(available, remainingNeeded);

      if (allocated > 0) {
        planItems.push({
          productId: candidate.product.id,
          productName: candidate.product.name,
          category: candidate.product.category,
          storeId: candidate.product.storeId,
          storeName: candidate.product.storeName,
          storeAddress: candidate.product.storeAddress,
          quantity: allocated,
          matchScore: candidate.match.score,
          donationScore: candidate.donation.score,
          donationComponents: candidate.donation.components,
          matchDetails: [...candidate.match.matchDetails, ...candidate.donation.matchDetails],
          riskLevel: candidate.product.riskAnalysis.riskLevel,
          writeOffProbability: candidate.product.riskAnalysis.probability,
          rns: candidate.product.riskAnalysis.rns,
          reason: candidate.product.riskAnalysis.reason,
          expiryDate: candidate.product.expiryDate,
          daysToExpiry: candidate.product.daysToExpiry ?? Math.ceil(
            (new Date(candidate.product.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)
          ),
          price: candidate.product.price,
        });
        stores.add(candidate.product.storeId);
        remainingNeeded -= allocated;
      }
    }

    if (planItems.length > 0) {
      // Оптимізація маршруту
      const route = optimizeRoute(planItems);

      plans.push({
        requestId: request.id,
        charityName: request.organizationName || 'Благодійна організація',
        charityAddress: request.deliveryAddress,
        priority: request.priority || 'normal',
        totalItems: planItems.length,
        totalQuantity: planItems.reduce((s, i) => s + i.quantity, 0),
        avgDonationScore: Math.round(
          planItems.reduce((s, i) => s + i.donationScore, 0) / planItems.length
        ),
        storesInvolved: [...stores],
        items: planItems,
        route,
        estimatedTime: estimateDeliveryTime(route.length, planItems.length),
        status: 'draft',
        socialImpact: calculateSocialImpact(planItems),
        economicImpact: calculateEconomicImpact(planItems),
      });
    }
  }

  return plans;
}

function optimizeRoute(items) {
  const stores = [...new Map(items.map(i => [i.storeId, {
    storeId: i.storeId,
    storeName: i.storeName,
    storeAddress: i.storeAddress,
  }])).values()];

  return stores.map((s, i) => ({
    ...s,
    order: i + 1,
    itemsToCollect: items.filter(it => it.storeId === s.storeId).length,
  }));
}

function estimateDeliveryTime(numStops, numItems) {
  const baseTime = 30;
  const itemTime = 2;
  return Math.round((numStops * baseTime + numItems * itemTime) / 60 * 10) / 10;
}

function calculateSocialImpact(items) {
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  return {
    peopleServed: Math.floor(totalQty / 2),
    mealsProvided: Math.floor(totalQty / 1.5),
    estimatedValue: items.reduce((s, i) => s + i.quantity * (i.price || 50), 0),
  };
}

function calculateEconomicImpact(items) {
  return {
    savedFromWriteOff: items.reduce((s, i) => s + i.quantity, 0),
    estimatedLossPrevention: items.reduce((s, i) => s + i.quantity * (i.price || 50), 0),
    logisticsCost: items.length * 15,
  };
}

// ─── Network Analysis ───────────────────────────────────────────────

/**
 * Мережевий аналіз: ризики нереалізації по всіх магазинах мережі.
 * Розділ 11 концепції — розподіл допомоги між магазинами.
 */
function analyzeNetwork(products) {
  const stores = {};

  for (const p of products) {
    const risk = predictWriteOffRisk(p);
    const storeId = p.storeId || 'unknown';

    if (!stores[storeId]) {
      stores[storeId] = {
        storeId,
        storeName: p.storeName || 'Невідомий магазин',
        storeAddress: p.storeAddress || '',
        totalProducts: 0,
        atRiskProducts: 0,
        criticalRisk: 0,
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        totalStock: 0,
        projectedWriteOff: 0,
        projectedLossValue: 0,
        totalRNS: 0,
        categories: {},
      };
    }

    const store = stores[storeId];
    store.totalProducts++;
    store.totalStock += p.stock || 0;
    store.totalRNS += risk.rns || 0;
    store.projectedWriteOff += risk.projectedRemaining || 0;
    store.projectedLossValue += (risk.projectedRemaining || 0) * (p.price || 50);

    if (risk.probability >= 0.5) store.atRiskProducts++;
    if (risk.riskLevel === 'critical') store.criticalRisk++;
    else if (risk.riskLevel === 'high') store.highRisk++;
    else if (risk.riskLevel === 'medium') store.mediumRisk++;
    else store.lowRisk++;

    const cat = p.category || 'Інше';
    if (!store.categories[cat]) {
      store.categories[cat] = { total: 0, atRisk: 0, writeOff: 0 };
    }
    store.categories[cat].total++;
    if (risk.probability >= 0.5) store.categories[cat].atRisk++;
    store.categories[cat].writeOff += risk.projectedRemaining || 0;
  }

  const storeList = Object.values(stores).map(s => ({
    ...s,
    avgRNS: s.totalProducts > 0 ? Math.round(s.totalRNS / s.totalProducts) : 0,
    projectedLossValue: Math.round(s.projectedLossValue),
  }));

  storeList.sort((a, b) => b.projectedLossValue - a.projectedLossValue);

  return {
    stores: storeList,
    totalStores: storeList.length,
    totalProducts: storeList.reduce((s, st) => s + st.totalProducts, 0),
    totalAtRisk: storeList.reduce((s, st) => s + st.atRiskProducts, 0),
    totalWriteOff: storeList.reduce((s, st) => s + st.projectedWriteOff, 0),
    totalLossValue: storeList.reduce((s, st) => s + st.projectedLossValue, 0),
    totalStock: storeList.reduce((s, st) => s + st.totalStock, 0),
  };
}

// ─── Batch Analysis ──────────────────────────────────────────────────

/**
 * Повний аналіз інвентаризації: для кожного продукту розраховує ризик нереалізації.
 */
function analyzeInventory(products) {
  const results = products.map(p => {
    const risk = predictWriteOffRisk(p);
    return {
      ...p,
      riskAnalysis: risk,
    };
  });

  // Сортування за ризиком (найвищий — перший)
  results.sort((a, b) => b.riskAnalysis.probability - a.riskAnalysis.probability);

  const summary = {
    totalProducts: results.length,
    totalStock: results.reduce((s, p) => s + (p.stock || 0), 0),
    atRisk: results.filter(p => p.riskAnalysis.probability >= 0.5).length,
    criticalRisk: results.filter(p => p.riskAnalysis.probability >= 0.8).length,
    highRisk: results.filter(p => p.riskAnalysis.probability >= 0.6 && p.riskAnalysis.probability < 0.8).length,
    mediumRisk: results.filter(p => p.riskAnalysis.probability >= 0.4 && p.riskAnalysis.probability < 0.6).length,
    lowRisk: results.filter(p => p.riskAnalysis.probability < 0.4).length,
    projectedWriteOffUnits: results.reduce((s, p) => s + p.riskAnalysis.projectedRemaining, 0),
    anomalyDetected: results.filter(p => p.riskAnalysis.analysis?.anomalies?.length > 0).length,
    decliningTrend: results.filter(p => p.riskAnalysis.analysis?.trend === 'declining').length,
    avgRNS: results.length > 0
      ? Math.round(results.reduce((s, p) => s + (p.riskAnalysis.rns || 0), 0) / results.length)
      : 0,
  };

  summary.projectedLossValue = results.reduce((s, p) =>
    s + p.riskAnalysis.projectedRemaining * (p.price || 50), 0
  );

  // Мережевий аналіз
  const network = analyzeNetwork(products);

  return { products: results, summary, network };
}

module.exports = {
  detectDemandAnomalies,
  predictWriteOffRisk,
  calculateDonationScore,
  matchProductToRequest,
  generateTransferPlan,
  analyzeNetwork,
  analyzeInventory,
};
