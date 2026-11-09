// ---- Injected into the page. Must be fully self-contained (no outer closures). ----
function pageScanFunction(includeBackgrounds) {
  function absolutize(url) {
    try { return new URL(url, document.baseURI).href; } catch (e) { return null; }
  }

  function pickBestFromSrcset(srcset) {
    if (!srcset) return null;
    const candidates = srcset.split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      const widthMatch = (bits[1] || '').match(/(\d+)w/);
      const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      return { url, width };
    }).filter((c) => c.url);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0].url;
  }

  function extractBgUrl(bgImageValue) {
    const match = /url\((['"]?)(.*?)\1\)/.exec(bgImageValue || '');
    return match ? match[2] : null;
  }

  function detectWordPress() {
    const signals = [];
    const generator = document.querySelector('meta[name="generator"]');
    if (generator && /wordpress/i.test(generator.content || '')) {
      signals.push('meta[generator]=' + generator.content);
    }
    if (document.querySelector('link[rel="https://api.w.org/"]')) {
      signals.push('wp REST API link tag present');
    }
    const resourceNodes = document.querySelectorAll('link[href], script[src]');
    let wpPathHits = 0;
    resourceNodes.forEach((node) => {
      const url = node.getAttribute('href') || node.getAttribute('src') || '';
      if (/\/wp-content\/|\/wp-includes\//.test(url)) wpPathHits++;
    });
    if (wpPathHits > 0) signals.push(wpPathHits + ' resource(s) under /wp-content//wp-includes/');
    if (typeof window._wpemojiSettings !== 'undefined') signals.push('window._wpemojiSettings present');
    if (document.querySelector('body[class*="wp-"]') || document.documentElement.classList.contains('wp-toolbar')) {
      signals.push('wp-* body/html class present');
    }
    return { isWordPress: signals.length > 0, signals };
  }

  const found = new Map();
  let skippedDataUris = 0;

  function addImage(rawUrl, meta) {
    if (!rawUrl) return;
    if (rawUrl.startsWith('data:')) { skippedDataUris++; return; }
    const abs = absolutize(rawUrl);
    if (!abs || found.has(abs)) return;
    found.set(abs, Object.assign({ url: abs, alt: '', width: 0, height: 0, source: 'img' }, meta || {}));
  }

  document.querySelectorAll('img').forEach((img) => {
    const best = pickBestFromSrcset(img.getAttribute('srcset')) ||
      img.currentSrc || img.getAttribute('src') ||
      img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') || pickBestFromSrcset(img.getAttribute('data-srcset'));
    addImage(best, {
      alt: img.alt || '',
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      source: 'img',
    });
  });

  document.querySelectorAll('picture source[srcset]').forEach((source) => {
    const best = pickBestFromSrcset(source.getAttribute('srcset'));
    addImage(best, { alt: '', width: 0, height: 0, source: 'picture-source' });
  });

  if (includeBackgrounds) {
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const bgUrl = extractBgUrl(style.backgroundImage);
      if (bgUrl) {
        addImage(bgUrl, { alt: el.getAttribute('aria-label') || '', width: 0, height: 0, source: 'css-background' });
      }
    });
  }

  const wp = detectWordPress();
  return {
    isWordPress: wp.isWordPress,
    signals: wp.signals,
    images: Array.from(found.values()),
    skippedDataUris,
    pageTitle: document.title,
    pageUrl: location.href,
  };
}

// ---- Popup controller ----
const els = {
  siteInfo: document.getElementById('siteInfo'),
  banner: document.getElementById('detectionBanner'),
  summary: document.getElementById('summary'),
  imgCount: document.getElementById('imgCount'),
  skippedCount: document.getElementById('skippedCount'),
  rescanBtn: document.getElementById('rescanBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  progressSection: document.getElementById('progressSection'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  resultSection: document.getElementById('resultSection'),
  includeBackgrounds: document.getElementById('includeBackgrounds'),
  forceNonWp: document.getElementById('forceNonWp'),
};

let lastScan = null;
let activeTab = null;

function setBanner(kind, text) {
  els.banner.className = 'banner banner-' + kind;
  els.banner.textContent = text;
}

function showResult(text) {
  els.resultSection.classList.remove('hidden');
  els.resultSection.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runScan() {
  els.downloadBtn.disabled = true;
  els.summary.classList.add('hidden');
  els.resultSection.classList.add('hidden');
  setBanner('neutral', 'Scanning page…');

  activeTab = await getActiveTab();
  if (!activeTab || !/^https?:/.test(activeTab.url || '')) {
    setBanner('bad', 'This page cannot be scanned (not http/https).');
    els.siteInfo.textContent = activeTab ? activeTab.url : 'No active tab';
    return;
  }
  els.siteInfo.textContent = activeTab.url;

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: pageScanFunction,
      args: [els.includeBackgrounds.checked],
    });
    lastScan = injection.result;
  } catch (err) {
    setBanner('bad', 'Could not scan this page: ' + err.message);
    return;
  }

  if (lastScan.isWordPress) {
    setBanner('good', '✓ WordPress detected — ' + lastScan.signals[0]);
  } else {
    setBanner('bad', '✗ WordPress not detected on this page.');
  }

  els.imgCount.textContent = lastScan.images.length;
  els.skippedCount.textContent = lastScan.skippedDataUris;
  els.summary.classList.remove('hidden');

  const canDownload = lastScan.images.length > 0 && (lastScan.isWordPress || els.forceNonWp.checked);
  els.downloadBtn.disabled = !canDownload;
  if (!lastScan.isWordPress && lastScan.images.length > 0) {
    showResult('Check "Scan anyway" below to download images from a non-WordPress page.');
  }
}

els.forceNonWp.addEventListener('change', () => {
  if (lastScan) {
    els.downloadBtn.disabled = !(lastScan.images.length > 0 && (lastScan.isWordPress || els.forceNonWp.checked));
  }
});

els.rescanBtn.addEventListener('click', runScan);

els.downloadBtn.addEventListener('click', async () => {
  if (!lastScan || !activeTab) return;
  els.downloadBtn.disabled = true;
  els.rescanBtn.disabled = true;
  els.progressSection.classList.remove('hidden');
  els.resultSection.classList.add('hidden');
  els.progressFill.style.width = '0%';
  els.progressText.textContent = 'Starting…';

  chrome.runtime.sendMessage({
    type: 'BUILD_ZIP',
    images: lastScan.images,
    pageTitle: lastScan.pageTitle,
    pageUrl: lastScan.pageUrl,
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ZIP_PROGRESS') {
    const pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
    els.progressFill.style.width = pct + '%';
    els.progressText.textContent = msg.phase + ': ' + msg.done + ' / ' + msg.total;
  } else if (msg.type === 'ZIP_DONE') {
    els.progressFill.style.width = '100%';
    els.progressText.textContent = 'Done';
    els.rescanBtn.disabled = false;
    els.downloadBtn.disabled = false;
    showResult(
      'Saved ' + msg.filename + '\n' +
      msg.savedCount + ' image(s) zipped, ' + msg.failedCount + ' failed to fetch.'
    );
  } else if (msg.type === 'ZIP_ERROR') {
    els.rescanBtn.disabled = false;
    els.downloadBtn.disabled = false;
    showResult('Error building zip: ' + msg.message);
  }
});

runScan();
