importScripts('lib/jszip.min.js');

const CONCURRENCY = 6;

function sanitizeSegment(str, maxLen) {
  const cleaned = (str || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, maxLen || 60) || 'untitled';
}

function extensionFromContentType(contentType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/pjpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/tiff': '.tiff',
  };
  return map[(contentType || '').split(';')[0].trim().toLowerCase()] || '';
}

function baseNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'image';
    return decodeURIComponent(last);
  } catch (e) {
    return 'image';
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

function timestampParts(date) {
  return {
    date: date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()),
    time: pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()),
  };
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

async function fetchWithPool(items, concurrency, worker) {
  let index = 0;
  let active = 0;
  return new Promise((resolve) => {
    const results = new Array(items.length);
    function next() {
      if (index >= items.length && active === 0) {
        resolve(results);
        return;
      }
      while (active < concurrency && index < items.length) {
        const i = index++;
        active++;
        worker(items[i], i).then((r) => {
          results[i] = r;
          active--;
          next();
        });
      }
    }
    next();
  });
}

async function buildAndDownloadZip(images, pageTitle, pageUrl, tabId) {
  const notify = (msg) => {
    chrome.runtime.sendMessage(msg).catch(() => {});
  };

  let domain = 'site';
  try { domain = new URL(pageUrl).hostname; } catch (e) {}
  const domainSlug = sanitizeSegment(domain, 60);

  const now = new Date();
  const { date, time } = timestampParts(now);

  const zip = new JSZip();
  const imagesFolder = zip.folder('images');

  const manifestRows = [
    ['index', 'status', 'saved_filename', 'original_url', 'alt_text', 'width', 'height', 'source', 'content_type', 'bytes'],
  ];

  const usedNames = new Set();
  let done = 0;
  const total = images.length;
  notify({ type: 'ZIP_PROGRESS', phase: 'Fetching images', done: 0, total });

  await fetchWithPool(images, CONCURRENCY, async (img, i) => {
    const seq = String(i + 1).padStart(4, '0');
    let status = 'ok';
    let savedName = '';
    let contentType = '';
    let bytes = 0;

    try {
      const resp = await fetch(img.url, { credentials: 'omit' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      contentType = resp.headers.get('content-type') || '';
      const blob = await resp.blob();
      bytes = blob.size;

      let base = sanitizeSegment(baseNameFromUrl(img.url).replace(/\.[a-zA-Z0-9]+$/, ''), 60);
      let ext = (baseNameFromUrl(img.url).match(/\.[a-zA-Z0-9]+$/) || [''])[0];
      if (!ext) ext = extensionFromContentType(contentType) || '.img';

      savedName = `${seq}_${domainSlug}_${base}${ext}`;
      let dedupeCounter = 1;
      while (usedNames.has(savedName)) {
        savedName = `${seq}_${domainSlug}_${base}-${dedupeCounter}${ext}`;
        dedupeCounter++;
      }
      usedNames.add(savedName);

      imagesFolder.file(savedName, blob);
    } catch (err) {
      status = 'failed: ' + err.message;
    }

    manifestRows.push([
      i + 1,
      status,
      savedName,
      img.url,
      img.alt || '',
      img.width || 0,
      img.height || 0,
      img.source || '',
      contentType,
      bytes,
    ]);

    done++;
    notify({ type: 'ZIP_PROGRESS', phase: 'Fetching images', done, total });
    return status;
  });

  const csv = manifestRows.map((row) => row.map(csvEscape).join(',')).join('\n');
  zip.file('manifest.csv', csv);
  zip.file('manifest.json', JSON.stringify({
    pageTitle,
    pageUrl,
    domain,
    scrapedAt: now.toISOString(),
    totalImages: total,
    savedCount: usedNames.size,
    failedCount: total - usedNames.size,
  }, null, 2));

  notify({ type: 'ZIP_PROGRESS', phase: 'Compressing', done: 0, total: 1 });
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  notify({ type: 'ZIP_PROGRESS', phase: 'Compressing', done: 1, total: 1 });

  const zipFilename = `wp-images_${domainSlug}_${date}-${time}.zip`;
  const blobUrl = URL.createObjectURL(zipBlob);

  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename: zipFilename,
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  notify({
    type: 'ZIP_DONE',
    filename: zipFilename,
    savedCount: usedNames.size,
    failedCount: total - usedNames.size,
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'BUILD_ZIP') {
    buildAndDownloadZip(msg.images, msg.pageTitle, msg.pageUrl, sender.tab ? sender.tab.id : null).catch((err) => {
      chrome.runtime.sendMessage({ type: 'ZIP_ERROR', message: err.message }).catch(() => {});
    });
  }
});
