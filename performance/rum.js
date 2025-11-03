/* performance/rum.js
   Сбор Core Web Vitals (LCP, CLS, FID/INP) и отправка на endpoint (опционально).
   Использование:
     import { initRUM } from './performance/rum.js';
     initRUM({ endpoint: 'https://example.com/rum', sampleRate: 1.0 });
*/
(function(global){
  function nowTs(){ return Date.now(); }
  function send(endpoint, payload) {
    if (!endpoint) { console.log('[RUM]', payload); return; }
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, body);
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(()=>{});
    }
  }
  function initRUM({ endpoint = '', sampleRate = 1.0 } = {}) {
    if (Math.random() > sampleRate) return; // семплирование
    const base = {
      url: location.href,
      ua: navigator.userAgent,
      ts: nowTs()
    };
    try {
      // LCP
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries[entries.length - 1];
        if (last) send(endpoint, { ...base, type: 'LCP', value: last.startTime, size: last.size || 0 });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      // CLS
      let clsValue = 0;
      new PerformanceObserver((entryList) => {
        for (const e of entryList.getEntries()) {
          if (!e.hadRecentInput) clsValue += e.value;
        }
        send(endpoint, { ...base, type: 'CLS', value: clsValue });
      }).observe({ type: 'layout-shift', buffered: true });
      // INP (или FID как fallback)
      if (PerformanceEventTiming && 'interactionId' in PerformanceEventTiming.prototype) {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const worst = entries.reduce((m, e) => Math.max(m, e.duration), 0);
          send(endpoint, { ...base, type: 'INP', value: worst });
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      } else {
        new PerformanceObserver((entryList) => {
          const e = entryList.getEntries()[0];
          if (e) send(endpoint, { ...base, type: 'FID', value: e.processingStart - e.startTime });
        }).observe({ type: 'first-input', buffered: true });
      }
      // TTFB
      new PerformanceObserver((list) => {
        const nav = list.getEntries()[0];
        if (nav) send(endpoint, { ...base, type: 'TTFB', value: nav.responseStart });
      }).observe({ type: 'navigation', buffered: true });
    } catch (e) {
      console.warn('[RUM] init error', e);
    }
  }
  global.initRUM = initRUM;
})(self || window);
