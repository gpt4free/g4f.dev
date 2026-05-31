/**
 * Cloudflare Worker — Torrent Download & AnonDrop Upload
 * 
 * Endpoints:
 *   POST /download          — Start a torrent download (magnet or .torrent URL)
 *   GET  /status/:id        — Check download progress
 *   POST /upload            — Upload downloaded file to AnonDrop
 *   GET  /files/:id         — Stream/download the completed file
 *   GET  /list              — List all downloads
 *   DELETE /delete/:id      — Delete a download and its files
 *   GET  /debug             — Debug connectivity tests
 *
 * Uses real BitTorrent peer protocol for P2P downloading.
 * Files are stored in R2.
 */

// ── Node.js compat imports ──
let nodeConnect;
let nodeStream;
try {
  const net = await import('node:net');
  nodeConnect = net.connect;
} catch {
  // node:net not available, will try global connect()
}
try {
  nodeStream = await import('node:stream');
} catch {
  // node:stream not available
}

// ── Helpers ──
function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Configuration ──
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB max per file
const MAX_TOTAL_SIZE = 10 * 1024 * 1024 * 1024; // 10GB total across all downloads
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const ANONDROP_HOST = 'https://anondrop.net';
const CLEANUP_AGE = 60 * 60 * 1000; // Clean up downloads older than 1 hour

// ── In-memory state (ephemeral, resets on Worker cold start) ──
const downloads = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleCors();
    }

    try {
      // ── POST /download — Start torrent download ──
      if (path === '/download' && method === 'POST') {
        return handleDownload(request, env, ctx);
      }

      // ── GET /status/:id — Check download status ──
      const statusMatch = path.match(/^\/status\/(.+)$/);
      if (statusMatch && method === 'GET') {
        return handleStatus(statusMatch[1], env, ctx);
      }

      // ── POST /upload — Upload to AnonDrop ──
      if (path === '/upload' && method === 'POST') {
        return handleUpload(request, env);
      }

      // ── GET /files/:id — Stream file ──
      const filesMatch = path.match(/^\/files\/(.+)$/);
      if (filesMatch && method === 'GET') {
        return handleGetFile(filesMatch[1], env);
      }

      // ── GET /list — List all downloads ──
      if (path === '/list' && method === 'GET') {
        return handleList();
      }

      // ── DELETE /delete/:id — Delete download ──
      const deleteMatch = path.match(/^\/delete\/(.+)$/);
      if (deleteMatch && method === 'DELETE') {
        return handleDelete(deleteMatch[1], env);
      }

      // ── POST /upload-torrent — Upload .torrent file ──
      if (path === '/upload-torrent' && method === 'POST') {
        return handleTorrentFileUpload(request, env, ctx);
      }

      // ── POST /resolve — Resolve torrent metadata (file list) ──
      if (path === '/resolve' && method === 'POST') {
        return handleResolve(request);
      }

      // ── GET /debug — Debug connectivity and tracker tests ──
      if (path === '/debug' && method === 'GET') {
        return handleDebug(env);
      }

      // ── GET / — Web UI ──
      if (path === '/' && method === 'GET') {
        return htmlResponse(getWebUI());
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse(err.message || 'Internal server error', 500);
    }
  },
};

// ── POST /resolve — Resolve torrent metadata without downloading ──
async function handleResolve(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { magnet, torrentUrl } = body;
  if (!magnet && !torrentUrl) {
    return errorResponse('Either "magnet" or "torrentUrl" is required', 400);
  }

  try {
    const info = await resolveTorrentInfo(magnet || torrentUrl, magnet ? 'magnet' : 'url');
    return jsonResponse({
      name: info.name,
      totalSize: info.totalSize,
      files: info.files.map((f, i) => ({
        index: i,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
      })),
    });
  } catch (err) {
    return errorResponse(`Failed to resolve torrent: ${err.message}`, 500);
  }
}

// ── GET /debug — Test connectivity and tracker reachability ──
async function handleDebug(env) {
  const results = {
    timestamp: new Date().toISOString(),
    worker: 'g4f-torrent',
    tests: {},
  };

  // Test 1: R2 bucket access
  try {
    const testKey = 'debug/test.txt';
    await env.TORRENT_BUCKET.put(testKey, 'debug-test');
    const obj = await env.TORRENT_BUCKET.get(testKey);
    await env.TORRENT_BUCKET.delete(testKey);
    results.tests.r2 = { ok: true, message: 'R2 bucket accessible' };
  } catch (e) {
    results.tests.r2 = { ok: false, error: e.message };
  }

  // Test 2: TCP connect() availability
  try {
    if (typeof connect === 'function') {
      results.tests.tcpConnect = { ok: true, message: 'connect() is available' };
    } else {
      results.tests.tcpConnect = { ok: false, error: 'connect() is not defined — need nodejs_compat' };
    }
  } catch (e) {
    results.tests.tcpConnect = { ok: false, error: e.message };
  }

  // Test 3: Try connecting to a known BitTorrent peer port
  try {
    const testHost = '1.1.1.1';
    const testPort = 80;
    const conn = connect({ hostname: testHost, port: testPort });
    results.tests.tcpOutbound = { ok: true, message: `TCP connect to ${testHost}:${testPort} succeeded` };
    try { conn.close(); } catch {}
  } catch (e) {
    results.tests.tcpOutbound = { ok: false, error: e.message };
  }

  // Test 4: HTTP tracker reachability
  const testTrackers = [
    'http://tracker.opentrackr.org:1337/announce',
    'http://tracker.openbittorrent.com:6969/announce',
  ];
  results.tests.httpTrackers = [];
  for (const tracker of testTrackers) {
    try {
      const resp = await fetch(tracker + '?compact=1&no_peer_id=1&uploaded=0&downloaded=0&left=0&port=6881', {
        headers: { 'User-Agent': 'g4f-torrent/1.0' },
      });
      results.tests.httpTrackers.push({
        url: tracker,
        status: resp.status,
        ok: resp.ok,
      });
    } catch (e) {
      results.tests.httpTrackers.push({
        url: tracker,
        error: e.message,
      });
    }
  }

  // Test 5: scheduler.wait availability
  try {
    if (typeof scheduler !== 'undefined' && typeof scheduler.wait === 'function') {
      results.tests.schedulerWait = { ok: true, message: 'scheduler.wait() is available' };
    } else {
      results.tests.schedulerWait = { ok: false, error: 'scheduler.wait() not available' };
    }
  } catch (e) {
    results.tests.schedulerWait = { ok: false, error: e.message };
  }

  return jsonResponse(results);
}

// ── POST /download ──
async function handleDownload(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { magnet, torrentUrl, anondropKey, autoUpload, fileIndices } = body;

  if (!magnet && !torrentUrl) {
    return errorResponse('Either "magnet" or "torrentUrl" is required', 400);
  }

  const id = generateId();
  const download = {
    id,
    status: 'initializing',
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    name: null,
    size: null,
    files: [],
    anondropKey: anondropKey || null,
    autoUpload: autoUpload === true,
    anondropUrls: [],
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    _fileIndices: fileIndices || null, // null = all files
  };

  downloads.set(id, download);

  // Start download in background
  ctx.waitUntil(
    performDownload(id, magnet || torrentUrl, magnet ? 'magnet' : 'url', env, ctx)
  );

  return jsonResponse({ id, status: 'initializing', message: 'Download started' }, 202);
}

// ── POST /upload-torrent — Upload .torrent file directly ──
async function handleTorrentFileUpload(request, env, ctx) {
  let body;
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('multipart/form-data')) {
      body = await request.formData();
    } else {
      body = await request.json();
    }
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  let torrentBuffer = null;
  let anondropKey = null;
  let autoUpload = false;
  let fileIndices = null;

  // Handle multipart file upload
  if (body instanceof FormData) {
    const file = body.get('torrent') || body.get('file');
    if (!file || !(file instanceof File)) {
      return errorResponse('No .torrent file provided. Use field name "torrent" or "file".', 400);
    }
    if (!file.name.endsWith('.torrent')) {
      return errorResponse('File must be a .torrent file', 400);
    }
    torrentBuffer = await file.arrayBuffer();
    anondropKey = body.get('anondropKey') || null;
    autoUpload = body.get('autoUpload') === 'true';
    const fiRaw = body.get('fileIndices');
    if (fiRaw) {
      try { fileIndices = JSON.parse(fiRaw); } catch { fileIndices = null; }
    }
  } else {
    // Handle JSON with base64-encoded torrent
    const { torrentBase64, anondropKey: ak, autoUpload: au, fileIndices: fi } = body;
    if (!torrentBase64) {
      return errorResponse('"torrentBase64" is required for JSON uploads', 400);
    }
    try {
      const binary = atob(torrentBase64);
      torrentBuffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        torrentBuffer[i] = binary.charCodeAt(i);
      }
      torrentBuffer = torrentBuffer.buffer;
    } catch {
      return errorResponse('Invalid base64 torrent data', 400);
    }
    anondropKey = ak || null;
    autoUpload = au === true;
    fileIndices = fi || null;
  }

  // Parse the torrent file
  let info;
  try {
    info = parseTorrentFile(torrentBuffer);
  } catch (err) {
    return errorResponse(`Failed to parse .torrent file: ${err.message}`, 400);
  }

  if (!info.files || info.files.length === 0) {
    return errorResponse('Torrent file contains no files', 400);
  }

  // Compute info hash from the raw torrent data
  const infoHash = await computeInfoHash(torrentBuffer);

  const id = generateId();
  const download = {
    id,
    status: 'initializing',
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    name: info.name,
    size: info.totalSize,
    files: info.files,
    anondropKey: anondropKey,
    autoUpload: autoUpload === true,
    anondropUrls: [],
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    _infoHash: infoHash,
    _source: 'torrent-file-upload',
    _sourceType: 'torrent-file',
    _fileIndices: fileIndices,
  };

  downloads.set(id, download);

  // Start download in background using the parsed torrent info
  ctx.waitUntil(
    performDownloadFromInfo(id, info, env, ctx)
  );

  return jsonResponse({
    id,
    status: 'initializing',
    name: info.name,
    size: info.totalSize,
    files: info.files.length,
    message: 'Torrent parsed and download started',
  }, 202);
}

// ── Download from pre-parsed torrent info ──
async function performDownloadFromInfo(id, info, env, ctx) {
  const download = downloads.get(id);
  if (!download) return;

  try {
    download.status = 'downloading';

    // Filter files if selective download was requested
    let filesToDownload = info.files;
    if (download._fileIndices && Array.isArray(download._fileIndices) && download._fileIndices.length > 0) {
      const indexSet = new Set(download._fileIndices);
      filesToDownload = info.files.filter((f, i) => indexSet.has(i));
      if (filesToDownload.length === 0) {
        throw new Error('No files matched the selected indices');
      }
      download.size = filesToDownload.reduce((sum, f) => sum + f.size, 0);
    }

    if (download.size > MAX_FILE_SIZE) {
      throw new Error(`Total size exceeds maximum limit of ${formatSize(MAX_FILE_SIZE)}`);
    }

    // Initialize peer download (saves state to R2, actual download via poll)
    await downloadFromPeers(id, info, filesToDownload, env, download);
    // downloadFromPeers now just saves state and returns — client polls /status/:id
  } catch (err) {
    download.status = 'error';
    download.error = err.message;
    console.error(`Download ${id} failed:`, err.message);
  }
}

// ── Core download logic ──
async function performDownload(id, source, sourceType, env, ctx) {
  const download = downloads.get(id);
  if (!download) return;

  try {
    download.status = 'downloading';

    // Fetch .torrent file if URL
    let torrentData;
    if (sourceType === 'url') {
      const response = await fetch(source, {
        headers: { 'User-Agent': 'g4f-torrent-worker/1.0' },
        cf: { timeout: 60 },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch torrent file: ${response.status}`);
      }
      torrentData = await response.arrayBuffer();
    }

    // Store source metadata for later use
    download._source = source;
    download._sourceType = sourceType;
    if (sourceType === 'magnet') {
      download._magnet = source;
      const hashMatch = source.match(/btih:([a-fA-F0-9]{40})/i) || source.match(/btih:([a-fA-F0-9]{32})/i);
      if (hashMatch) download._infoHash = hashMatch[1].toLowerCase();
    }

    const info = await resolveTorrentInfo(source, sourceType);
    download.name = info.name;
    download.size = info.totalSize;
    download.files = info.files;

    // Preserve raw torrent data for peer protocol
    if (info._rawPieces) download._rawPieces = info._rawPieces;
    if (info._rawPieceLength) download._rawPieceLength = info._rawPieceLength;
    if (info._rawAnnounce) download._rawAnnounce = info._rawAnnounce;
    if (info._rawAnnounceList) download._rawAnnounceList = info._rawAnnounceList;
    if (info.infoHash) download._infoHash = info.infoHash;

    // Filter files if selective download was requested
    let filesToDownload = info.files;
    if (download._fileIndices && Array.isArray(download._fileIndices) && download._fileIndices.length > 0) {
      const indexSet = new Set(download._fileIndices);
      filesToDownload = info.files.filter((f, i) => indexSet.has(i));
      if (filesToDownload.length === 0) {
        throw new Error('No files matched the selected indices');
      }
      download.size = filesToDownload.reduce((sum, f) => sum + f.size, 0);
    }

    if (download.size > MAX_FILE_SIZE) {
      throw new Error(`Total size exceeds maximum limit of ${formatSize(MAX_FILE_SIZE)}`);
    }

    // Initialize peer download (saves state to R2, actual download via poll)
    await downloadFromPeers(id, info, filesToDownload, env, download);
    // downloadFromPeers now just saves state and returns — client polls /status/:id
  } catch (err) {
    download.status = 'error';
    download.error = err.message;
    console.error(`Download ${id} failed:`, err.message);
  }
}

// ── Resolve torrent metadata ──
async function resolveTorrentInfo(source, sourceType) {
  // Use iTorrents / TorrentProject API or similar to resolve metadata
  // For magnet links, extract info hash and query torrent metadata APIs
  
  let infoHash = null;
  
  if (sourceType === 'magnet') {
    const hashMatch = source.match(/btih:([a-fA-F0-9]{40})/i) || source.match(/btih:([a-fA-F0-9]{32})/i);
    if (hashMatch) {
      infoHash = hashMatch[1].toLowerCase();
    }
  }

  // Try multiple metadata APIs
  const apis = [
    // TorrentProject API
    async () => {
      if (!infoHash) return null;
      const resp = await fetch(`https://torrentproject.one/torrent/${infoHash}/json`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        name: data.title || 'Unknown',
        totalSize: parseInt(data.total_size) || 0,
        files: (data.files || []).map(f => ({
          name: f.name || f.path || 'unknown',
          size: parseInt(f.size) || 0,
          mimeType: guessMimeType(f.name || ''),
        })),
      };
    },
    // iTorrents API
    async () => {
      if (!infoHash) return null;
      const resp = await fetch(`https://itorrents.org/torrent/${infoHash}.json`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        name: data.name || 'Unknown',
        totalSize: parseInt(data.size) || 0,
        files: (data.files || []).map(f => ({
          name: f.path || f.name || 'unknown',
          size: parseInt(f.length || f.size) || 0,
          mimeType: guessMimeType(f.path || ''),
        })),
      };
    },
    // Direct .torrent file parsing (for torrentUrl)
    async () => {
      if (sourceType !== 'url') return null;
      const resp = await fetch(source);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      const parsed = parseTorrentFile(buf);
      // Also compute info hash from the raw buffer
      const hash = await computeInfoHash(buf);
      return { ...parsed, infoHash: hash };
    },
  ];

  for (const api of apis) {
    try {
      const result = await api();
      if (result && result.files && result.files.length > 0) {
        return result;
      }
    } catch (e) {
      // Try next API
    }
  }

  throw new Error('Could not resolve torrent metadata. Try providing a direct .torrent URL.');
}

// ── Standalone bencode parser (reusable) ──
function parseBencode(data) {
  const decoder = new TextDecoder();
  let pos = 0;

  function readString(length) {
    const str = decoder.decode(data.slice(pos, pos + length));
    pos += length;
    return str;
  }

  function parse() {
    const byte = data[pos];
    if (byte === 0x69) { // 'i'
      pos++;
      let numStr = '';
      while (data[pos] !== 0x65) numStr += String.fromCharCode(data[pos++]);
      pos++;
      return parseInt(numStr);
    }
    if (byte === 0x6c) { // 'l'
      pos++;
      const list = [];
      while (data[pos] !== 0x65) list.push(parse());
      pos++;
      return list;
    }
    if (byte === 0x64) { // 'd'
      pos++;
      const dict = {};
      while (data[pos] !== 0x65) {
        const key = parse();
        const value = parse();
        dict[key] = value;
      }
      pos++;
      return dict;
    }
    if (byte >= 0x30 && byte <= 0x39) {
      let lenStr = '';
      while (data[pos] >= 0x30 && data[pos] <= 0x39) lenStr += String.fromCharCode(data[pos++]);
      pos++;
      const length = parseInt(lenStr);
      return readString(length);
    }
    throw new Error(`Unexpected byte: ${byte}`);
  }

  return parse();
}

// ── Simple bencode parser for .torrent files ──
function parseTorrentFile(buffer) {
  const data = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  let pos = 0;

  function readByte() {
    return data[pos++];
  }

  function readString(length) {
    const str = decoder.decode(data.slice(pos, pos + length));
    pos += length;
    return str;
  }

  function parse() {
    const byte = data[pos];
    // Integer: i...e
    if (byte === 0x69) { // 'i'
      pos++;
      let numStr = '';
      while (data[pos] !== 0x65) { // 'e'
        numStr += String.fromCharCode(data[pos++]);
      }
      pos++; // skip 'e'
      return parseInt(numStr);
    }
    // List: l...e
    if (byte === 0x6c) { // 'l'
      pos++;
      const list = [];
      while (data[pos] !== 0x65) {
        list.push(parse());
      }
      pos++; // skip 'e'
      return list;
    }
    // Dict: d...e
    if (byte === 0x64) { // 'd'
      pos++;
      const dict = {};
      while (data[pos] !== 0x65) {
        const key = parse();
        const value = parse();
        dict[key] = value;
      }
      pos++; // skip 'e'
      return dict;
    }
    // String: length:content
    if (byte >= 0x30 && byte <= 0x39) { // digit
      let lenStr = '';
      while (data[pos] >= 0x30 && data[pos] <= 0x39) {
        lenStr += String.fromCharCode(data[pos++]);
      }
      pos++; // skip ':'
      const length = parseInt(lenStr);
      const str = readString(length);
      return str;
    }
    throw new Error(`Unexpected byte: ${byte}`);
  }

  const torrent = parse();
  const info = torrent.info;
  
  if (!info) throw new Error('Invalid torrent file: no info dict');

  const name = info.name || 'Unknown';
  let files = [];
  let totalSize = 0;

  if (info.files) {
    // Multi-file torrent
    for (const f of info.files) {
      const path = Array.isArray(f.path) ? f.path.join('/') : f.path;
      const size = f.length || 0;
      files.push({
        name: path,
        size: size,
        mimeType: guessMimeType(path),
      });
      totalSize += size;
    }
  } else if (info.length) {
    // Single-file torrent
    const size = info.length || 0;
    files.push({
      name: name,
      size: size,
      mimeType: guessMimeType(name),
    });
    totalSize = size;
  }

  // Preserve raw binary data needed for peer protocol
  const result = {
    name,
    totalSize,
    files,
    _rawPieces: info.pieces,       // binary SHA1 hashes (string)
    _rawPieceLength: info['piece length'] || 262144,
    _rawAnnounce: torrent.announce,
    _rawAnnounceList: torrent['announce-list'],
  };

  return result;
}

// ── Compute SHA1 info hash from raw torrent buffer ──
async function computeInfoHash(torrentBuffer) {
  try {
    // Parse to find the "info" dictionary boundaries, then SHA1 it
    const data = new Uint8Array(torrentBuffer);
    const decoder = new TextDecoder();
    
    // Find the info dictionary: look for "4:infod" pattern
    const searchStr = '4:infod';
    let infoStart = -1;
    for (let i = 0; i < data.length - searchStr.length; i++) {
      let match = true;
      for (let j = 0; j < searchStr.length; j++) {
        if (data[i + j] !== searchStr.charCodeAt(j)) {
          match = false;
          break;
        }
      }
      if (match) {
        infoStart = i + 6; // skip "4:infod"
        break;
      }
    }

    if (infoStart === -1) return null;

    // Extract the info dict bytes (bencoded, ends with 'e')
    let depth = 1;
    let infoEnd = infoStart;
    while (depth > 0 && infoEnd < data.length) {
      if (data[infoEnd] === 0x64) depth++; // 'd'
      else if (data[infoEnd] === 0x65) depth--; // 'e'
      infoEnd++;
    }

    const infoBytes = data.slice(infoStart, infoEnd);
    const hashBuffer = await crypto.subtle.digest('SHA-1', infoBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BitTorrent Peer Protocol — Real P2P downloading
// ═══════════════════════════════════════════════════════════════

// ── Download file(s) from BitTorrent peers ──
async function downloadFromPeers(id, info, filesToDownload, env, download) {
  const infoHash = extractInfoHash(download);
  if (!infoHash) throw new Error('No info hash available for peer download');

  const infoHashBin = hexToBytes(infoHash);
  const peerId = generatePeerId();
  const peerIdBin = new TextEncoder().encode(peerId);
  
  const totalLength = filesToDownload.reduce((s, f) => s + f.size, 0);

  const pieces = info._rawPieces || download._rawPieces || (info.pieces ? hexToBytes(info.pieces) : null);
  const pieceLength = info._rawPieceLength || download._rawPieceLength || info.pieceLength || 262144;
  const numPieces = Math.ceil(totalLength / pieceLength);

  download.status = 'downloading';
  download.currentFile = 'Connecting to trackers...';
  const announce = info._rawAnnounce || download._rawAnnounce || info.announce;
  const announceList = info._rawAnnounceList || download._rawAnnounceList || info.announceList;
  
  const peers = await getPeers(infoHashBin, peerIdBin, totalLength, announce, announceList);
  
  if (peers.length === 0) {
    throw new Error('No peers found. The torrent may have no seeders.');
  }

  download.peers = peers.length;

  // Save resume state to R2 (minimal — piece data stored separately as binary)
  const stateKey = `torrents/${id}/__state__`;
  const state = {
    infoHashBin: Array.from(infoHashBin),
    peerIdBin: Array.from(peerIdBin),
    pieceLength,
    numPieces,
    totalLength,
    pieces: pieces ? Array.from(pieces) : null,
    filesToDownload,
    peers,
    downloadedPieces: 0,
  };
  await env.TORRENT_BUCKET.put(stateKey, JSON.stringify(state));

  // Don't download here — the client will poll /status/:id which triggers resumeDownload
  // This avoids waitUntil CPU timeout on long downloads
  download.status = 'downloading';
  download.peers = peers.length;
  download.progress = 0;
}

// ── Download pieces with resume support (poll-driven, time-limited) ──
// Each call downloads as many pieces as possible within ~20s, then saves state.
// Returns true if all pieces are done, false if more polling needed.
async function downloadPiecesWithResume(id, env, download, state) {
  const { peers, infoHashBin, peerIdBin, pieceLength, numPieces, totalLength, pieces, filesToDownload } = state;
  const infoHashBinArr = new Uint8Array(infoHashBin);
  const peerIdBinArr = new Uint8Array(peerIdBin);
  const piecesArr = pieces ? new Uint8Array(pieces) : null;
  const stateKey = `torrents/${id}/__state__`;

  const startPiece = state.downloadedPieces;
  const PARALLEL_PIECES = 5;
  const BATCH_TIME_LIMIT = 20000; // Stop after 20s to avoid CPU timeout
  const batchStartTime = Date.now();
  let allDone = true;

  for (let batchStart = startPiece; batchStart < numPieces; batchStart += PARALLEL_PIECES) {
    // Check time limit — if we're running low on time, save state and return
    if (Date.now() - batchStartTime > BATCH_TIME_LIMIT) {
      allDone = false;
      break;
    }

    const batchEnd = Math.min(batchStart + PARALLEL_PIECES, numPieces);
    const batchPieces = [];

    for (let pieceIdx = batchStart; pieceIdx < batchEnd; pieceIdx++) {
      const pieceSize = pieceIdx === numPieces - 1
        ? totalLength - pieceIdx * pieceLength
        : pieceLength;
      batchPieces.push({ pieceIdx, pieceSize });
    }

    download.currentFile = `Piece ${batchStart + 1}-${batchEnd}/${numPieces}`;

    // Download batch in parallel — catch errors so one failure doesn't kill the batch
    const results = await Promise.all(batchPieces.map(({ pieceIdx, pieceSize }) =>
      downloadPiece(peers, infoHashBinArr, peerIdBinArr, pieceIdx, pieceSize, piecesArr, pieceIdx)
        .then(data => ({ pieceIdx, data }))
        .catch(err => {
          console.log(`[batch] piece ${pieceIdx} exception: ${err.message}`);
          return { pieceIdx, data: null };
        })
    ));

    // Store all pieces from this batch — skip nulls (failed pieces)
    let anySaved = false;
    for (const { pieceIdx, data } of results) {
      if (data === null) {
        console.log(`[batch] piece ${pieceIdx} failed, will retry next poll`);
        continue;
      }
      const pieceKey = `torrents/${id}/__piece_${pieceIdx}`;
      await env.TORRENT_BUCKET.put(pieceKey, data);
      anySaved = true;
    }

    // Only advance downloadedPieces for consecutive completed pieces from the start
    // This ensures failed pieces get retried on the next poll
    while (state.downloadedPieces < numPieces) {
      const checkKey = `torrents/${id}/__piece_${state.downloadedPieces}`;
      const exists = await env.TORRENT_BUCKET.get(checkKey);
      if (exists === null) break;
      state.downloadedPieces++;
    }

    download.progress = Math.round((state.downloadedPieces / numPieces) * 100);

    // Save state after each batch
    await env.TORRENT_BUCKET.put(stateKey, JSON.stringify(state));
  }

  if (!allDone) return false; // More pieces to download

  // All pieces done — assemble files one at a time to avoid memory blowup
  download.currentFile = 'Assembling files...';
  await assembleAndStoreFiles(id, env, filesToDownload, pieceLength, totalLength, numPieces);

  // Clean up state and piece blobs
  await env.TORRENT_BUCKET.delete(stateKey);
  const deletePromises = [];
  for (let pieceIdx = 0; pieceIdx < numPieces; pieceIdx++) {
    deletePromises.push(env.TORRENT_BUCKET.delete(`torrents/${id}/__piece_${pieceIdx}`));
  }
  await Promise.all(deletePromises);

  download.progress = 100;
  return true;
}

// ── Stream assembly: process one file at a time, reading only needed pieces ──
// R2 Workers binding doesn't support multipart uploads, so we assemble in memory.
// Files up to ~100MB work within the 128MB limit. Larger files are skipped.
async function assembleAndStoreFiles(id, env, files, pieceLength, totalLength, numPieces) {
  // Build file offset map
  const offsets = [0];
  for (let i = 0; i < files.length; i++) {
    offsets.push(offsets[i] + files[i].size);
  }

  for (let fi = 0; fi < files.length; fi++) {
    const fStart = offsets[fi];
    const fEnd = offsets[fi + 1];
    const fileSize = files[fi].size;
    const firstPiece = Math.floor(fStart / pieceLength);
    const lastPiece = Math.min(Math.floor((fEnd - 1) / pieceLength), numPieces - 1);

    const r2Key = `torrents/${id}/${files[fi].name}`;

    // Skip files that are too large for the 128MB memory limit
    if (fileSize > 100 * 1024 * 1024) {
      console.error(`File too large for assembly: ${files[fi].name} (${fileSize} bytes)`);
      continue;
    }

    // Allocate file buffer and fill from pieces
    const fileData = new Uint8Array(fileSize);

    for (let p = firstPiece; p <= lastPiece; p++) {
      const pieceKey = `torrents/${id}/__piece_${p}`;
      const obj = await env.TORRENT_BUCKET.get(pieceKey);
      if (!obj) continue;

      const pieceData = new Uint8Array(await obj.arrayBuffer());
      const pStart = p * pieceLength;
      const copyStart = Math.max(pStart, fStart);
      const copyEnd = Math.min(pStart + pieceData.length, fEnd);
      const srcOff = copyStart - pStart;
      const dstOff = copyStart - fStart;
      const copyLen = copyEnd - copyStart;

      if (copyLen > 0) {
        fileData.set(pieceData.slice(srcOff, srcOff + copyLen), dstOff);
      }
    }

    // Store assembled file
    await env.TORRENT_BUCKET.put(r2Key, fileData, {
      httpMetadata: { contentType: files[fi].mimeType || 'application/octet-stream' },
    });
  }
}

// ── Resume a download that was interrupted ──
// Returns true if download completed, false if more polling needed
async function resumeDownload(id, env, download) {
  const stateKey = `torrents/${id}/__state__`;
  const obj = await env.TORRENT_BUCKET.get(stateKey);
  if (!obj) return null; // No state = nothing to resume

  const state = await obj.json();
  download.status = 'downloading';
  download.peers = state.peers.length;

  const completed = await downloadPiecesWithResume(id, env, download, state);
  return completed;
}

// ── Get peers from trackers ──
async function getPeers(infoHashBin, peerIdBin, totalLength, announce, announceList) {
  const peers = [];
  const trackers = [];

  if (announceList) {
    for (const tier of announceList) {
      for (const url of tier) trackers.push(url);
    }
  }
  if (announce) trackers.push(announce);

  // Add some well-known HTTP trackers as fallback (UDP won't work in Workers)
  if (trackers.length === 0) {
    trackers.push(
      'https://tracker.tamersunion.org:443/announce',
      'http://tracker.opentrackr.org:1337/announce',
      'http://open.tracker.cl:1337/announce',
      'http://tracker.openbittorrent.com:6969/announce',
      'http://open.demonii.com:1337/announce',
      'http://explodie.org:6969/announce',
      'http://tracker.torrent.eu.org:451/announce',
      'http://tracker.moeking.me:6969/announce',
    );
  }

  for (const trackerUrl of trackers) {
    try {
      let newPeers;
      if (trackerUrl.startsWith('udp://')) {
        // UDP trackers not supported in Cloudflare Workers (no raw UDP sockets)
        // Skip them — we rely on HTTP trackers only
        continue;
      } else if (trackerUrl.startsWith('http://') || trackerUrl.startsWith('https://')) {
        newPeers = await queryHttpTracker(trackerUrl, infoHashBin, peerIdBin, totalLength);
      } else {
        continue;
      }
      for (const p of newPeers) {
        if (!peers.some(ex => ex.host === p.host && ex.port === p.port)) {
          peers.push(p);
        }
      }
    } catch (e) {
    }
  }

  // Shuffle peers
  for (let i = peers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [peers[i], peers[j]] = [peers[j], peers[i]];
  }

  return peers;
}

// ── UDP Tracker Protocol ──
async function queryUdpTracker(url, infoHashBin, peerId, totalLength) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parseInt(parsed.port) || 80;

  // Connect
  const conn = await connectTCP(host, port);

  try {
    // Connection request
    const connReq = new Uint8Array(16);
    const writer = conn.writable.getWriter();
    const reader = conn.readable.getReader();

    // Protocol ID (0x41727101980) + action 0 (connect)
    setBigInt64(connReq, 0, 0x41727101980n);
    setInt32(connReq, 8, 0); // action: connect
    setInt32(connReq, 12, Math.floor(Math.random() * 0x7fffffff)); // transaction id
    await writer.write(connReq);

    // Read connect response (16 bytes)
    const connResp = await readExact(reader, 16);
    if (connResp.length < 16) throw new Error('Short UDP connect response');
    const txId = getInt32(connResp, 4);
    const connId = getBigInt64(connResp, 8);

    // Announce request
    const annReq = new Uint8Array(98);
    setBigInt64(annReq, 0, connId);
    setInt32(annReq, 8, 1); // action: announce
    setInt32(annReq, 12, txId);
    annReq.set(infoHashBin, 16); // info_hash (20 bytes)
    annReq.set(hexToBytes(peerId), 36); // peer_id (20 bytes)
    setBigInt64(annReq, 56, BigInt(totalLength)); // downloaded
    setBigInt64(annReq, 64, 0n); // left
    setBigInt64(annReq, 72, 0n); // uploaded
    setInt32(annReq, 80, 0); // event: 0=started
    setInt32(annReq, 84, 0); // IP: 0=default
    setInt32(annReq, 88, Math.floor(Math.random() * 0x7fffffff)); // key
    setInt32(annReq, 92, -1); // num_want: -1=default
    setInt16(annReq, 96, port || 6881); // port
    await writer.write(annReq);

    // Read announce response (variable, at least 20 bytes header)
    const annHeader = await readExact(reader, 20);
    if (annHeader.length < 20) throw new Error('Short announce response');
    const numPeers = getInt32(annHeader, 16);

    // Read peer list (6 bytes per peer: 4 IP + 2 port)
    const peerData = await readExact(reader, numPeers * 6);
    const peers = [];
    for (let i = 0; i < numPeers; i++) {
      const off = i * 6;
      const ip = `${peerData[off]}.${peerData[off+1]}.${peerData[off+2]}.${peerData[off+3]}`;
      const prt = (peerData[off+4] << 8) | peerData[off+5];
      if (prt > 0 && prt < 65536) peers.push({ host: ip, port: prt });
    }

    writer.releaseLock();
    reader.releaseLock();
    return peers;
  } finally {
    try { conn.close(); } catch {}
  }
}

// ── HTTP Tracker Protocol ──
async function queryHttpTracker(url, infoHashBin, peerIdBin, totalLength) {
  // Build the info_hash parameter: BitTorrent uses the raw 20-byte SHA1, URL-encoded
  const infoHashEnc = urlEncodeHash(infoHashBin);
  
  // Build the peer_id parameter: raw 20 bytes, URL-encoded
  const peerIdEnc = urlEncodeHash(peerIdBin);
  
  const params = new URLSearchParams();
  params.set('info_hash', infoHashEnc);
  params.set('peer_id', peerIdEnc);
  params.set('port', '6881');
  params.set('uploaded', '0');
  params.set('downloaded', '0');
  params.set('left', String(totalLength));
  params.set('compact', '1');
  params.set('no_peer_id', '1');

  const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
  const resp = await fetch(fullUrl, {
    headers: { 'User-Agent': 'g4f-torrent/1.0' },
  });

  if (!resp.ok) throw new Error(`HTTP tracker returned ${resp.status}`);
  
  const data = new Uint8Array(await resp.arrayBuffer());

  // Try to parse as bencoded dict first (non-compact response)
  // If it starts with 'd', it's a bencoded dict
  if (data.length > 0 && data[0] === 0x64) {
    try {
      const parsed = parseBencode(new Uint8Array(data));
      if (parsed && parsed.peers) {
        // peers could be a string (compact) or list of dicts
        if (typeof parsed.peers === 'string') {
          const peerBytes = new TextEncoder().encode(parsed.peers);
          return parseCompactPeers(peerBytes);
        }
      }
    } catch (e) {
    }
  }

  // Compact response: 6 bytes per peer (4 IP + 2 port)
  return parseCompactPeers(data);
}

function parseCompactPeers(data) {
  const peers = [];
  for (let i = 0; i + 6 <= data.length; i += 6) {
    const ip = `${data[i]}.${data[i+1]}.${data[i+2]}.${data[i+3]}`;
    const port = (data[i+4] << 8) | data[i+5];
    if (port > 0 && port < 65536) peers.push({ host: ip, port });
  }
  return peers;
}

// ── Download a single piece from peers ──
async function downloadPiece(peers, infoHashBin, peerIdBin, pieceIdx, pieceSize, pieces, pieceIdxForHash) {
  const BLOCK_SIZE = 16384;
  const numBlocks = Math.ceil(pieceSize / BLOCK_SIZE);
  const piece = new Uint8Array(pieceSize);
  const received = new Uint8Array(numBlocks);
  let remaining = numBlocks;
  let done = false;

  const handshakeMsg = buildHandshake(infoHashBin, peerIdBin);
  const activePeers = peers.slice(0, Math.min(5, peers.length));

  console.log(`[piece ${pieceIdx}] trying ${activePeers.length} peers, ${numBlocks} blocks, ${pieceSize} bytes`);

  // Try each peer sequentially until one delivers data
  for (const peer of activePeers) {
    if (done || remaining === 0) break;

    console.log(`[piece ${pieceIdx}] connecting to ${peer.host}:${peer.port}`);
    try {
      const conn = await connectTCP(peer.host, peer.port);
      const writer = conn.writable.getWriter();
      const reader = conn.readable.getReader();
      const br = createBufferedReader(reader);

      try {
        // Send handshake
        await writer.write(handshakeMsg);
        console.log(`[piece ${pieceIdx}] sent handshake to ${peer.host}:${peer.port}`);

        // Read handshake response
        const hs = await br.readExact(68);
        console.log(`[piece ${pieceIdx}] handshake response: ${hs.length} bytes from ${peer.host}:${peer.port}`);
        if (hs.length < 68) {
          console.log(`[piece ${pieceIdx}] short handshake (${hs.length}), skipping peer`);
          continue;
        }

        // Verify info_hash
        let hashOk = true;
        for (let i = 0; i < 20; i++) {
          if (hs[28 + i] !== infoHashBin[i]) { hashOk = false; break; }
        }
        if (!hashOk) {
          console.log(`[piece ${pieceIdx}] info_hash mismatch on ${peer.host}:${peer.port}`);
          continue;
        }
        console.log(`[piece ${pieceIdx}] info_hash OK from ${peer.host}:${peer.port}`);

        // Send interested
        await writer.write(MSG_INTERESTED);
        console.log(`[piece ${pieceIdx}] sent interested`);

        // Wait for unchoke before sending requests
        let unchoked = false;
        const handshakeDeadline = Date.now() + 10000;

        while (Date.now() < handshakeDeadline) {
          const msg = await br.readPeerMessage();
          if (!msg) {
            console.log(`[piece ${pieceIdx}] peer ${peer.host}:${peer.port} closed (no message)`);
            break;
          }
          console.log(`[piece ${pieceIdx}] got msg id=${msg.id} len=${msg.data.length} from ${peer.host}:${peer.port}`);

          if (msg.id === 0) {
            console.log(`[piece ${pieceIdx}] choked by ${peer.host}:${peer.port}`);
          } else if (msg.id === 1) {
            unchoked = true;
            console.log(`[piece ${pieceIdx}] unchoked by ${peer.host}:${peer.port}`);
            break;
          } else if (msg.id === 5) {
            const byteIdx = pieceIdx >> 3;
            const bitIdx = 7 - (pieceIdx & 7);
            if (byteIdx < msg.data.length && (msg.data[byteIdx] & (1 << bitIdx))) {
              console.log(`[piece ${pieceIdx}] peer has piece (bitfield)`);
            }
          }
        }

        if (!unchoked) {
          console.log(`[piece ${pieceIdx}] never unchoked by ${peer.host}:${peer.port}`);
          continue;
        }

        // Now send all block requests
        console.log(`[piece ${pieceIdx}] sending ${numBlocks} block requests`);
        for (let b = 0; b < numBlocks; b++) {
          if (!received[b]) {
            await writer.write(buildRequestMsg(pieceIdx, b * BLOCK_SIZE, Math.min(BLOCK_SIZE, pieceSize - b * BLOCK_SIZE)));
          }
        }

        // Read piece messages
        const peerDeadline = Date.now() + 15000;
        while (remaining > 0 && Date.now() < peerDeadline) {
          const msg = await br.readPeerMessage();
          if (!msg) {
            console.log(`[piece ${pieceIdx}] peer closed, remaining=${remaining}`);
            break;
          }

          if (msg.id === 7 && msg.data.length >= 8) {
            const rxPieceIdx = getInt32(msg.data, 0);
            const rxBegin = getInt32(msg.data, 4);
            if (rxPieceIdx === pieceIdx) {
              const blockIdx = Math.floor(rxBegin / BLOCK_SIZE);
              if (blockIdx < numBlocks && !received[blockIdx]) {
                const blockData = msg.data.slice(8);
                piece.set(blockData, blockIdx * BLOCK_SIZE);
                received[blockIdx] = 1;
                remaining--;
                console.log(`[piece ${pieceIdx}] got block ${blockIdx}/${numBlocks} (${blockData.length}B) remaining=${remaining}`);
              }
            }
          } else if (msg.id === 0) {
            console.log(`[piece ${pieceIdx}] choked during download`);
          }
        }

        if (remaining === 0) {
          done = true;
          console.log(`[piece ${pieceIdx}] COMPLETE from ${peer.host}:${peer.port}`);
        } else {
          console.log(`[piece ${pieceIdx}] incomplete from ${peer.host}:${peer.port}, ${remaining}/${numBlocks} remaining`);
        }
      } finally {
        writer.releaseLock();
        reader.releaseLock();
        try { conn.close(); } catch {}
      }
    } catch (e) {
      console.log(`[piece ${pieceIdx}] error with ${peer.host}:${peer.port}: ${e.message}`);
    }
  }

  if (!done) {
    console.log(`[piece ${pieceIdx}] FAILED — all peers exhausted, will retry next poll`);
    return null; // Signal failure so caller doesn't save zeros
  }
  return piece;
}

// ── Piece-to-file mapping ──
function buildPieceMap(files, pieceLength, totalLength) {
  const map = [];
  let fileIdx = 0, fileOffset = 0;
  for (let p = 0; p * pieceLength < totalLength; p++) {
    const pStart = p * pieceLength;
    const pEnd = Math.min(pStart + pieceLength, totalLength);
    map.push({ start: pStart, end: pEnd, files: [] });

    while (fileIdx < files.length && fileOffset + files[fileIdx].size <= pStart) {
      fileOffset += files[fileIdx].size;
      fileIdx++;
    }

    let pos = pStart;
    let fi = fileIdx;
    let fo = fileOffset;
    while (pos < pEnd && fi < files.length) {
      const fileEnd = fo + files[fi].size;
      const segEnd = Math.min(pEnd, fileEnd);
      map[p].files.push({
        fileIndex: fi,
        offset: pos - pStart,
        length: segEnd - pos,
        fileOffset: pos - fo,
      });
      pos = segEnd;
      if (pos >= fileEnd) {
        fo = fileEnd;
        fi++;
      }
    }
  }
  return map;
}

// ── Assemble files from downloaded pieces ──
function assembleFiles(files, pieceData, pieceLength, totalLength) {
  const result = [];
  for (const file of files) {
    result.push({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      data: new Uint8Array(file.size),
    });
  }

  // Build file offset map
  let offsets = [0];
  for (let i = 0; i < files.length; i++) {
    offsets.push(offsets[i] + files[i].size);
  }

  for (const [pieceIdx, data] of pieceData) {
    const pStart = pieceIdx * pieceLength;
    for (let fi = 0; fi < files.length; fi++) {
      const fStart = offsets[fi];
      const fEnd = offsets[fi + 1];
      if (pStart >= fEnd) continue;
      if (pStart + data.length <= fStart) continue;

      const copyStart = Math.max(pStart, fStart);
      const copyEnd = Math.min(pStart + data.length, fEnd);
      const srcOff = copyStart - pStart;
      const dstOff = copyStart - fStart;
      const copyLen = copyEnd - copyStart;

      if (copyLen > 0) {
        result[fi].data.set(data.slice(srcOff, srcOff + copyLen), dstOff);
      }
    }
  }

  return result;
}

// ── TCP connect helper (Cloudflare Workers) ──
async function connectTCP(host, port) {
  const connectFn = nodeConnect || (typeof connect !== 'undefined' ? connect : null);
  
  if (!connectFn) {
    throw new Error(
      'TCP connect() not available. ' +
      'Cloudflare Workers require a Paid plan with TCP sockets enabled. ' +
      'Add "nodejs_compat_v2" to compatibility_flags in wrangler.toml and ensure ' +
      'your account has TCP socket access enabled in the Cloudflare Dashboard ' +
      '(Workers & Pages > your-worker > Settings > Variables > TCP Sockets).'
    );
  }

  // Cloudflare Workers only allow TCP connections to hostnames, not raw IPs.
  // Use nip.io to resolve IPs: 1.2.3.4.nip.io → 1.2.3.4
  const hostname = /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ? `${host}.nip.io`
    : host;

  // connect() returns immediately; wait for the connection to be established
  const socket = await new Promise((resolve, reject) => {
    const s = connectFn({ hostname, port });
    s.on('connect', () => resolve(s));
    s.on('error', (err) => reject(err));
    setTimeout(() => {
      try { s.destroy(); } catch {}
      reject(new Error(`Connection timeout to ${hostname}:${port}`));
    }, 10000);
  });

  if (!nodeStream) {
    throw new Error('node:stream not available — required for TCP stream conversion');
  }

  const readable = nodeStream.Readable.toWeb(socket);
  const writable = nodeStream.Writable.toWeb(socket);

  return {
    readable,
    writable,
    close: () => { try { socket.destroy(); } catch {} },
  };
}

// ── Buffered reader — reads large chunks, serves small requests from buffer ──
function createBufferedReader(reader) {
  let buffer = new Uint8Array(0);
  let bufferOffset = 0;

  return {
    async readExact(n) {
      if (buffer.length - bufferOffset >= n) {
        const result = buffer.slice(bufferOffset, bufferOffset + n);
        bufferOffset += n;
        return result;
      }
      if (bufferOffset > 0 && bufferOffset < buffer.length) {
        buffer = buffer.slice(bufferOffset);
        bufferOffset = 0;
      } else if (bufferOffset >= buffer.length) {
        buffer = new Uint8Array(0);
        bufferOffset = 0;
      }
      while (buffer.length < n) {
        const { value, done } = await reader.read();
        if (done) break;
        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer, 0);
        combined.set(value, buffer.length);
        buffer = combined;
      }
      if (buffer.length < n) {
        const result = buffer.slice(0);
        buffer = new Uint8Array(0);
        return result;
      }
      const result = buffer.slice(0, n);
      bufferOffset = n;
      return result;
    },

    async readPeerMessage() {
      const lenBuf = await this.readExact(4);
      if (lenBuf.length < 4) return null;
      const len = getInt32(lenBuf, 0);
      if (len === 0) return { id: 0, data: new Uint8Array(0) };
      const body = await this.readExact(len);
      if (body.length < len) return null;
      return { id: body[0], data: body.slice(1) };
    }
  };
}

// ── Pre-allocated message builders (avoid GC pressure in hot loop) ──
const MSG_INTERESTED = new Uint8Array([0, 0, 0, 1, 2]);

function buildRequestMsg(pieceIdx, begin, length) {
  const req = new Uint8Array(17);
  setInt32(req, 0, 13);
  req[4] = 6;
  setInt32(req, 5, pieceIdx);
  setInt32(req, 9, begin);
  setInt32(req, 13, length);
  return req;
}

function buildHandshake(infoHash, peerIdBin) {
  const hs = new Uint8Array(68);
  hs[0] = 19;
  const proto = new TextEncoder().encode('BitTorrent protocol');
  hs.set(proto, 1);
  hs.set(infoHash, 28);
  hs.set(peerIdBin, 48);
  return hs;
}

// ── Binary helpers ──
function setInt32(buf, off, val) {
  buf[off] = (val >> 24) & 0xff;
  buf[off + 1] = (val >> 16) & 0xff;
  buf[off + 2] = (val >> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function getInt32(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function setInt16(buf, off, val) {
  buf[off] = (val >> 8) & 0xff;
  buf[off + 1] = val & 0xff;
}

function setBigInt64(buf, off, val) {
  for (let i = 7; i >= 0; i--) {
    buf[off + i] = Number(val & 0xffn);
    val >>= 8n;
  }
}

function getBigInt64(buf, off) {
  let val = 0n;
  for (let i = 0; i < 8; i++) {
    val = (val << 8n) | BigInt(buf[off + i]);
  }
  return val;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function urlEncodeHash(hash) {
  let result = '';
  for (let i = 0; i < hash.length; i++) {
    const b = hash[i];
    if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
        b === 45 || b === 46 || b === 95 || b === 126) {
      result += String.fromCharCode(b);
    } else {
      result += '%' + b.toString(16).padStart(2, '0');
    }
  }
  return result;
}

function generatePeerId() {
  const prefix = '-g4f-'; // 5 bytes
  let id = prefix;
  for (let i = 0; i < 15; i++) {
    id += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)];
  }
  return id;
}

// ── Extract info hash from download metadata ──
function extractInfoHash(download) {
  // Check if we stored the info hash during resolution
  if (download._infoHash) return download._infoHash;

  // Try to extract from magnet link if stored
  if (download._magnet) {
    const match = download._magnet.match(/btih:([a-fA-F0-9]{40})/i) ||
                  download._magnet.match(/btih:([a-fA-F0-9]{32})/i);
    if (match) return match[1].toLowerCase();
  }

  // Try to extract from source URL
  if (download._source) {
    const match = download._source.match(/([a-fA-F0-9]{40})/i) ||
                  download._source.match(/([a-fA-F0-9]{32})/i);
    if (match) return match[1].toLowerCase();
  }

  return null;
}

// ── RAR Archive Extraction ──
// Scans downloaded files for .rar archives, extracts their contents,
// stores extracted files in R2, and updates the download's file list.
// Only extracted files (not the .rar itself) are uploaded to AnonDrop.
async function extractRarArchives(id, env) {
  const download = downloads.get(id);
  if (!download) return;

  const rarFiles = download.files.filter(f =>
    f.name && f.name.toLowerCase().endsWith('.rar')
  );

  if (rarFiles.length === 0) return;

  download.status = 'extracting';
  const extractedFiles = [];
  const rarFileNames = new Set(rarFiles.map(f => f.name));

  for (const rarFile of rarFiles) {
    try {
      const r2Key = `torrents/${id}/${rarFile.name}`;
      const object = await env.TORRENT_BUCKET.get(r2Key);
      if (!object) continue;

      const rarData = new Uint8Array(await object.arrayBuffer());
      const entries = parseRarArchive(rarData);

      for (const entry of entries) {
        try {
          const extractedData = extractRarEntry(rarData, entry);
          if (!extractedData) continue;

          const extKey = `torrents/${id}/${entry.name}`;
          await env.TORRENT_BUCKET.put(extKey, extractedData, {
            httpMetadata: { contentType: guessMimeType(entry.name) },
          });

          extractedFiles.push({
            name: entry.name,
            size: entry.size,
            mimeType: guessMimeType(entry.name),
            _extracted: true,
            _sourceRar: rarFile.name,
          });

        } catch (e) {
          console.error(`Failed to extract ${entry.name} from ${rarFile.name}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`Failed to parse RAR ${rarFile.name}:`, e.message);
    }
  }

  if (extractedFiles.length > 0) {
    // Replace .rar files with extracted files in the download's file list
    download.files = [
      ...download.files.filter(f => !rarFileNames.has(f.name)),
      ...extractedFiles,
    ];
    download._extractedFromRar = true;
    download._rarFileCount = rarFiles.length;
    download._extractedCount = extractedFiles.length;
  }

  download.status = 'completed';
}

// ── RAR Archive Parser (pure JS, handles RAR4 and RAR5) ──
// Parses RAR archive headers and returns file entries with offsets/sizes.
// Supports stored (method 0x30) and basic compressed files.
function parseRarArchive(data) {
  const entries = [];
  let pos = 0;

  // Check RAR signature
  if (data.length < 8) return entries;

  const isRar4 = data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 &&
                 data[3] === 0x21 && data[4] === 0x1A && data[5] === 0x07 &&
                 data[6] === 0x00;
  const isRar5 = data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 &&
                 data[3] === 0x21 && data[4] === 0x1A && data[5] === 0x07 &&
                 data[6] === 0x01 && data[7] === 0x00;

  if (!isRar4 && !isRar5) return entries;

  pos = isRar5 ? 8 : 7;

  while (pos < data.length - 4) {
    try {
      let block = parseRarBlock(data, pos, isRar5);
      if (!block) break;

      if (block.type === 'file' && block.name) {
        entries.push({
          name: block.name,
          size: block.dataSize || block.unpackedSize || 0,
          packedSize: block.packedSize || block.dataSize || 0,
          offset: block.dataOffset,
          method: block.method,
          isEncrypted: block.isEncrypted || false,
        });
      }

      if (block.type === 'end') break;

      pos = block.nextOffset;
      if (pos <= 0 || pos >= data.length) break;
    } catch (e) {
      break;
    }
  }

  return entries;
}

// ── Parse a single RAR block header ──
function parseRarBlock(data, pos, isRar5) {
  if (isRar5) {
    return parseRar5Block(data, pos);
  }
  return parseRar4Block(data, pos);
}

// ── RAR4 block parser ──
function parseRar4Block(data, pos) {
  if (pos + 7 > data.length) return null;

  const headCrc = data[pos] | (data[pos + 1] << 8);
  const headType = data[pos + 2];
  const headFlags = data[pos + 3] | (data[pos + 4] << 8);
  const headSize = data[pos + 5] | (data[pos + 6] << 8);

  if (headSize < 7 || pos + headSize > data.length) return null;

  const block = {
    type: 'unknown',
    nextOffset: pos + headSize,
    dataOffset: pos + headSize,
    method: null,
    name: null,
    dataSize: 0,
    unpackedSize: 0,
    packedSize: 0,
    isEncrypted: false,
  };

  // HEAD_TYPE: 0x72 = marker, 0x73 = archive, 0x74 = file, 0x7b = end
  switch (headType) {
    case 0x72: block.type = 'marker'; return block;
    case 0x73: block.type = 'archive'; return block;
    case 0x7b: block.type = 'end'; return block;
    case 0x74: block.type = 'file'; break;
    default: return block;
  }

  // File header: after the 7-byte base header
  let hpos = pos + 7;
  const hasAddSize = (headFlags & 0x8000) !== 0;

  // Packed size (4 bytes) and unpacked size (4 bytes)
  if (hpos + 8 > pos + headSize) return block;
  block.packedSize = data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24);
  hpos += 4;
  block.unpackedSize = data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24);
  hpos += 4;

  // Host OS + File CRC
  if (hpos + 5 > pos + headSize) return block;
  const hostOs = data[hpos]; hpos++;
  const fileCrc = data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24);
  hpos += 4;

  // File time (2 bytes DOS format)
  if (hpos + 2 > pos + headSize) return block;
  const fileTime = data[hpos] | (data[hpos + 1] << 8);
  hpos += 2;

  // RAR version
  if (hpos + 1 > pos + headSize) return block;
  const unpVer = data[hpos]; hpos++;
  block.method = data[hpos]; hpos++; // 0x30 = stored

  // Name size
  if (hpos + 2 > pos + headSize) return block;
  const nameSize = data[hpos] | (data[hpos + 1] << 8);
  hpos += 2;

  // File attributes
  if (hpos + 4 > pos + headSize) return block;
  const fileAttr = data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24);
  hpos += 4;

  // High pack size / high unpack size (if HEAD_FLAGS & 0x100)
  if (headFlags & 0x100) {
    if (hpos + 8 > pos + headSize) return block;
    block.packedSize += (data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24)) * 0x100000000;
    hpos += 4;
    block.unpackedSize += (data[hpos] | (data[hpos + 1] << 8) | (data[hpos + 2] << 16) | (data[hpos + 3] << 24)) * 0x100000000;
    hpos += 4;
  }

  // File name
  if (hpos + nameSize > pos + headSize) return block;
  const nameBytes = data.slice(hpos, hpos + nameSize);
  block.name = new TextDecoder().decode(nameBytes).replace(/\0.*$/, '');
  hpos += nameSize;

  // Check encryption flag (HEAD_FLAGS & 0x04)
  block.isEncrypted = (headFlags & 0x04) !== 0;

  // Data starts after the header
  block.dataOffset = pos + headSize;
  block.dataSize = block.packedSize;

  return block;
}

// ── RAR5 block parser ──
function parseRar5Block(data, pos) {
  if (pos + 4 > data.length) return null;

  // RAR5 uses variable-length integer encoding for header size
  const { value: headSize, nextPos: afterSize } = readRar5VInt(data, pos);
  if (headSize < 7 || pos + headSize > data.length) return null;

  const block = {
    type: 'unknown',
    nextOffset: pos + headSize,
    dataOffset: pos + headSize,
    method: null,
    name: null,
    dataSize: 0,
    unpackedSize: 0,
    packedSize: 0,
    isEncrypted: false,
  };

  let hpos = afterSize;
  if (hpos >= pos + headSize) return block;

  // Header type (vint)
  const { value: headType, nextPos: typeEnd } = readRar5VInt(data, hpos);
  hpos = typeEnd;

  // Header flags (vint)
  if (hpos >= pos + headSize) return block;
  const { value: headFlags, nextPos: flagsEnd } = readRar5VInt(data, hpos);
  hpos = flagsEnd;

  switch (headType) {
    case 1: block.type = 'archive'; return block;
    case 2: block.type = 'file'; break;
    case 5: block.type = 'end'; return block;
    default: return block;
  }

  // Extra area size + data size are vints
  if (hpos >= pos + headSize) return block;
  const extraAndData = readRar5VInt(data, hpos);
  hpos = extraAndData.nextPos;

  if (hpos >= pos + headSize) return block;
  const dataSizeV = readRar5VInt(data, hpos);
  block.packedSize = dataSizeV.value;
  hpos = dataSizeV.nextPos;

  // File flags (vint)
  if (hpos >= pos + headSize) return block;
  const fileFlagsV = readRar5VInt(data, hpos);
  const fileFlags = fileFlagsV.value;
  hpos = fileFlagsV.nextPos;

  // Unpacked size (vint)
  if (hpos >= pos + headSize) return block;
  const unpSizeV = readRar5VInt(data, hpos);
  block.unpackedSize = unpSizeV.value;
  hpos = unpSizeV.nextPos;

  // Attributes (vint)
  if (hpos >= pos + headSize) return block;
  const attrV = readRar5VInt(data, hpos);
  hpos = attrV.nextPos;

  // Modification time (uint32 LE) if flag 0x0002
  if (fileFlags & 0x0002) {
    if (hpos + 4 > pos + headSize) return block;
    hpos += 4;
  }

  // CRC32 (uint32 LE) if flag 0x0004
  if (fileFlags & 0x0004) {
    if (hpos + 4 > pos + headSize) return block;
    hpos += 4;
  }

  // Compression info (vint version, vint solid flags, vint method)
  if (hpos >= pos + headSize) return block;
  const compVersion = readRar5VInt(data, hpos);
  hpos = compVersion.nextPos;

  if (hpos >= pos + headSize) return block;
  const solidFlags = readRar5VInt(data, hpos);
  hpos = solidFlags.nextPos;

  if (hpos >= pos + headSize) return block;
  const methodV = readRar5VInt(data, hpos);
  block.method = methodV.value; // 0 = stored
  hpos = methodV.nextPos;

  // Name length + name
  if (hpos >= pos + headSize) return block;
  const nameLenV = readRar5VInt(data, hpos);
  const nameLen = nameLenV.value;
  hpos = nameLenV.nextPos;

  if (nameLen > 0 && hpos + nameLen <= pos + headSize) {
    block.name = new TextDecoder().decode(data.slice(hpos, hpos + nameLen));
    hpos += nameLen;
  }

  block.isEncrypted = (fileFlags & 0x0001) !== 0;
  block.dataOffset = pos + headSize;
  block.dataSize = block.packedSize;

  return block;
}

// ── Read RAR5 variable-length integer ──
function readRar5VInt(data, pos) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (pos + i >= data.length) return { value: 0, nextPos: pos };
    const b = data[pos + i];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value, nextPos: pos + i + 1 };
    }
    shift += 7;
  }
  return { value: 0, nextPos: pos };
}

// ── Extract a single file from a RAR archive ──
function extractRarEntry(data, entry) {
  if (entry.isEncrypted) {
    throw new Error(`File "${entry.name}" is encrypted — password required`);
  }

  if (entry.offset === undefined || entry.offset >= data.length) {
    throw new Error(`Invalid offset for "${entry.name}"`);
  }

  // Method 0x30 (RAR4) or 0 (RAR5) = stored (no compression)
  if (entry.method === 0x30 || entry.method === 0) {
    const end = Math.min(entry.offset + entry.size, data.length);
    return data.slice(entry.offset, end);
  }

  // For compressed files, we attempt a simple extraction
  // RAR uses LZSS + Huffman/range coding — full decompression is complex.
  // We try to decompress using a minimal LZSS approach for common cases.
  try {
    return decompressRarLZSS(data, entry);
  } catch (e) {
    throw new Error(
      `Cannot decompress "${entry.name}" (method ${entry.method}). ` +
      `Only stored files can be extracted in this environment.`
    );
  }
}

// ── Minimal RAR LZSS decompressor ──
// Handles the most common RAR compression (method 0x31-0x35 for RAR4)
function decompressRarLZSS(data, entry) {
  const src = data.slice(entry.offset, entry.offset + entry.packedSize);
  const dst = new Uint8Array(entry.size);
  let srcPos = 0, dstPos = 0;

  // RAR compressed data starts with a 2-byte "PPM" flag check
  // For LZSS: the first byte indicates the compression method variant
  if (src.length < 2) throw new Error('Compressed data too short');

  const methodByte = src[srcPos++];
  const methodFlags = src[srcPos++];

  // Check if it's a valid LZSS stream
  if (methodByte > 0x35 || methodByte < 0x30) {
    throw new Error(`Unsupported compression method: 0x${methodByte.toString(16)}`);
  }

  // RAR uses a 64KB sliding window with minimum match length of 2-3
  const DICT_SIZE = 65536;
  const dict = new Uint8Array(DICT_SIZE);
  let dictPos = 0;

  try {
    while (dstPos < entry.size && srcPos < src.length) {
      // Read flag bits
      let flags = 0;
      let bitCount = 0;

      for (let i = 0; i < 8 && dstPos < entry.size && srcPos < src.length; i++) {
        if (bitCount === 0) {
          flags = src[srcPos++];
          bitCount = 8;
        }

        if (flags & 0x80) {
          // Literal byte
          if (srcPos >= src.length) break;
          const b = src[srcPos++];
          dst[dstPos] = b;
          dict[dictPos % DICT_SIZE] = b;
          dstPos++;
          dictPos++;
        } else {
          // Match: distance + length
          if (srcPos + 1 >= src.length) break;
          const lo = src[srcPos++];
          const hi = src[srcPos++];
          const dist = lo | ((hi & 0x3f) << 8);
          let len = (hi >> 6) + 2;

          // Minimum match length adjustment
          if (len === 2) {
            if (srcPos >= src.length) break;
            len += src[srcPos++];
          }

          if (dist === 0 || dist > dstPos) break;

          for (let j = 0; j < len && dstPos < entry.size; j++) {
            const b = dst[dstPos - dist - 1];
            dst[dstPos] = b;
            dict[dictPos % DICT_SIZE] = b;
            dstPos++;
            dictPos++;
          }
        }

        flags <<= 1;
      }
    }
  } catch (e) {
    // If decompression fails, throw
    throw new Error(`Decompression error: ${e.message}`);
  }

  if (dstPos < entry.size) {
    throw new Error(`Decompression incomplete: got ${dstPos} of ${entry.size} bytes`);
  }

  return dst;
}

// ── GET /status/:id ──
async function handleStatus(id, env, ctx) {
  let download = downloads.get(id);
  
  // If not in memory, try to reconstruct from R2 state (cold start recovery)
  if (!download) {
    const stateKey = `torrents/${id}/__state__`;
    const stateObj = await env.TORRENT_BUCKET.get(stateKey);
    if (stateObj) {
      const state = await stateObj.json();
      download = {
        id,
        status: 'downloading',
        progress: Math.round((state.downloadedPieces / state.numPieces) * 100),
        downloadSpeed: 0,
        uploadSpeed: 0,
        peers: state.peers.length,
        name: state.filesToDownload?.[0]?.name || id,
        size: state.totalLength,
        files: state.filesToDownload || [],
        anondropKey: null,
        autoUpload: false,
        anondropUrls: [],
        error: null,
        startedAt: Date.now(),
        completedAt: null,
        currentFile: `Piece ${state.downloadedPieces + 1}/${state.numPieces}`,
      };
      downloads.set(id, download);

    } else {
      return errorResponse('Download not found', 404);
    }
  }

  // If download is in progress, try to advance it (poll-driven resume)
  if (download.status === 'downloading' && !download._resuming) {
    download._resuming = true;
    try {
      const completed = await resumeDownload(id, env, download);
      if (completed === true) {
        download.status = 'completed';
        download.completedAt = Date.now();
        await extractRarArchives(id, env);
        if (download.autoUpload && download.anondropKey) {
          await uploadAllToAnonDrop(id, env);
        }
      } else if (completed === null) {
        // No state found — download was never started or state was lost
        download.status = 'error';
        download.error = 'Download state lost. Please restart the download.';
      }
      // completed === false: more pieces to download, client should poll again
    } catch (e) {
      console.error(`[handleStatus] resume failed: ${e.message}`);
      download.status = 'error';
      download.error = e.message;
    } finally {
      download._resuming = false;
    }
  }

  return jsonResponse({
    id: download.id,
    status: download.status,
    progress: download.progress,
    name: download.name,
    size: download.size,
    files: download.files,
    currentFile: download.currentFile,
    downloadSpeed: download.downloadSpeed,
    peers: download.peers,
    anondropUrls: download.anondropUrls,
    error: download.error,
    startedAt: download.startedAt,
    completedAt: download.completedAt,
    extractedFromRar: download._extractedFromRar || false,
    rarFileCount: download._rarFileCount || 0,
    extractedCount: download._extractedCount || 0,
  });
}

// ── POST /upload — Upload completed download to AnonDrop ──
async function handleUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, anondropKey } = body;
  if (!id) {
    return errorResponse('"id" is required', 400);
  }

  const download = downloads.get(id);
  if (!download) {
    return errorResponse('Download not found', 404);
  }

  if (download.status !== 'completed') {
    return errorResponse('Download not yet completed', 400);
  }

  if (anondropKey) {
    download.anondropKey = anondropKey;
  }

  try {
    const urls = await uploadAllToAnonDrop(id, env);
    return jsonResponse({ id, status: 'uploaded', urls });
  } catch (err) {
    return errorResponse(`Upload failed: ${err.message}`, 500);
  }
}

// ── Upload all files to AnonDrop ──
async function uploadAllToAnonDrop(id, env) {
  const download = downloads.get(id);
  if (!download) throw new Error('Download not found');

  const urls = [];
  download.status = 'uploading';
  download.progress = 0;

  // Count uploadable files (skip .rar)
  const uploadable = download.files.filter(f => !(f.name && f.name.toLowerCase().endsWith('.rar')));
  let uploaded = 0;

  for (const file of uploadable) {
    download.currentFile = file.name;
    download.progress = Math.round((uploaded / uploadable.length) * 100);

    const r2Key = `torrents/${id}/${file.name}`;
    const object = await env.TORRENT_BUCKET.get(r2Key);
    if (!object) {
      uploaded++;
      continue;
    }

    const fileData = await object.arrayBuffer();
    const blob = new Blob([fileData]);

    const anondropUrl = await uploadToAnonDrop(blob, file.name, download.anondropKey, download, uploaded, uploadable.length);
    urls.push({ file: file.name, url: anondropUrl });

    uploaded++;
    download.progress = Math.round((uploaded / uploadable.length) * 100);
  }

  download.anondropUrls = urls;
  download.status = 'completed';
  download.currentFile = null;
  download.progress = 100;
  return urls;
}

// ── Upload single file to AnonDrop ──
async function uploadToAnonDrop(blob, filename, key, download, fileIndex, totalFiles) {
  if (!key) {
    // Auto-register
    key = await registerAnonDrop();
  }

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

  if (blob.size <= CHUNK_SIZE) {
    // Single upload
    const formData = new FormData();
    formData.append('file', blob, filename);
    const response = await fetch(`${ANONDROP_HOST}/upload?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`AnonDrop upload failed (${response.status})`);
    }
    const text = await response.text();
    const urlMatch = text.match(/https?:\/\/[^"'<>\s]+/);
    if (!urlMatch) throw new Error('No URL in AnonDrop response');
    return urlMatch[0];
  }

  // Chunked upload
  const initResp = await fetch(
    `${ANONDROP_HOST}/initiateupload?key=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename)}`
  );
  if (!initResp.ok) throw new Error(`Initiate upload failed (${initResp.status})`);
  const sessionHash = await initResp.json();

  const totalChunks = Math.ceil(blob.size / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, blob.size);
    const chunk = blob.slice(start, end);
    const chunkForm = new FormData();
    chunkForm.append('file', chunk);
    chunkForm.append('chunk_index', i.toString());
    const chunkResp = await fetch(
      `${ANONDROP_HOST}/uploadchunk?session_hash=${encodeURIComponent(sessionHash)}`,
      { method: 'POST', body: chunkForm }
    );
    if (!chunkResp.ok) throw new Error(`Chunk ${i} upload failed (${chunkResp.status})`);

    // Update per-chunk progress
    if (download) {
      const fileProgress = Math.round(((i + 1) / totalChunks) * 100);
      const overallProgress = Math.round(((fileIndex + (i + 1) / totalChunks) / totalFiles) * 100);
      download.progress = overallProgress;
      download.currentFile = `${filename} (chunk ${i + 1}/${totalChunks})`;
    }
  }

  const endResp = await fetch(
    `${ANONDROP_HOST}/endupload?session_hash=${encodeURIComponent(sessionHash)}`
  );
  if (!endResp.ok) throw new Error(`Finalize upload failed (${endResp.status})`);
  const endText = await endResp.text();
  
  // Parse response
  try {
    const data = JSON.parse(endText);
    if (data.file_url) return data.file_url;
  } catch {}
  
  const urlMatch = endText.match(/https?:\/\/[^\s<>"']+/);
  if (urlMatch) return urlMatch[0];
  
  throw new Error('No file URL in AnonDrop response');
}

async function registerAnonDrop() {
  const response = await fetch(`${ANONDROP_HOST}/register`);
  if (!response.ok) throw new Error('AnonDrop registration failed');
  const html = await response.text();
  const patterns = [
    /key\s*[=:]\s*([A-Za-z0-9_-]{16,})/i,
    /YOUR KEY\s*[:\-]?\s*([A-Za-z0-9_-]{16,})/i,
    /([A-Za-z0-9_-]{24,})/,
    /([A-Za-z0-9]{16,})/,
  ];
  for (const pat of patterns) {
    const match = html.match(pat);
    if (match && match[1]) return match[1];
  }
  throw new Error('Could not extract AnonDrop key');
}

// ── GET /files/:id — Stream file from R2 ──
async function handleGetFile(id, env) {
  // id can be "downloadId/filename" or just downloadId (first file)
  const parts = id.split('/');
  const downloadId = parts[0];
  const fileName = parts.slice(1).join('/');

  const download = downloads.get(downloadId);
  if (!download) {
    return errorResponse('Download not found', 404);
  }

  let r2Key;
  if (fileName) {
    r2Key = `torrents/${downloadId}/${fileName}`;
  } else if (download.files.length > 0) {
    r2Key = `torrents/${downloadId}/${download.files[0].name}`;
  } else {
    return errorResponse('No files available', 404);
  }

  const object = await env.TORRENT_BUCKET.get(r2Key);
  if (!object) {
    return errorResponse('File not found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
}

// ── GET /list ──
function handleList() {
  const list = [];
  for (const [id, dl] of downloads) {
    list.push({
      id: dl.id,
      status: dl.status,
      progress: dl.progress,
      name: dl.name,
      size: dl.size,
      files: dl.files?.length || 0,
      anondropUrls: dl.anondropUrls,
      error: dl.error,
      startedAt: dl.startedAt,
    });
  }
  return jsonResponse({ downloads: list, total: list.length });
}

// ── DELETE /delete/:id ──
async function handleDelete(id, env) {
  const download = downloads.get(id);
  if (!download) {
    return errorResponse('Download not found', 404);
  }

  // Delete from R2
  const prefix = `torrents/${id}/`;
  const objects = await env.TORRENT_BUCKET.list({ prefix });
  for (const obj of objects.objects) {
    await env.TORRENT_BUCKET.delete(obj.key);
  }

  downloads.delete(id);
  return jsonResponse({ id, status: 'deleted' });
}

// ── Cleanup old downloads ──
async function scheduleCleanup(id, env) {
  // Wait for cleanup age, then delete
  await new Promise(resolve => setTimeout(resolve, CLEANUP_AGE));
  const download = downloads.get(id);
  if (download) {
    const prefix = `torrents/${id}/`;
    const objects = await env.TORRENT_BUCKET.list({ prefix });
    for (const obj of objects.objects) {
      await env.TORRENT_BUCKET.delete(obj.key);
    }
    downloads.delete(id);
  }
}

// ── Web UI (served at GET /) ──
function getWebUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Torrent Downloader — g4f.dev</title>
<style>
:root {
  --bg: #0f0f0f; --surface: #1a1a1a; --border: #333; --text: #e0e0e0;
  --muted: #9aa0b4; --accent: #7c6af7; --accent-glow: rgba(124,106,247,0.25);
  --success: #4ade80; --warn: #fbbf24; --error: #f87171; --info: #60a5fa; --radius: 14px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--text);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
}
.container { width: 100%; max-width: 720px; }
h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 6px; letter-spacing: -0.3px; }
.subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 28px; }
.input-section {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; margin-bottom: 20px;
}
.input-group { margin-bottom: 14px; }
.input-group:last-child { margin-bottom: 0; }
.input-group label { display: block; font-size: 0.82rem; font-weight: 500; color: var(--muted); margin-bottom: 6px; }
.input-row { display: flex; gap: 8px; }
.input-row input {
  flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text); font-size: 0.9rem; font-family: inherit;
  outline: none; transition: border-color 0.2s;
}
.input-row input:focus { border-color: var(--accent); }
.input-row input::placeholder { color: #555; }
.toggle-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.toggle-row label { margin-bottom: 0; cursor: pointer; }
.toggle-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: var(--border); border-radius: 24px; transition: 0.3s; }
.toggle-slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: var(--text); border-radius: 50%; transition: 0.3s; }
.toggle-switch input:checked + .toggle-slider { background: var(--accent); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }
button {
  padding: 10px 20px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--text); cursor: pointer;
  font-size: 0.85rem; font-weight: 500; transition: border-color 0.2s, background 0.2s, opacity 0.2s; white-space: nowrap;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:hover:not(:disabled) { background: #6a58e8; border-color: #6a58e8; }
button.small { padding: 5px 10px; font-size: 0.75rem; }
button.danger { border-color: var(--error); color: var(--error); }
button.danger:hover:not(:disabled) { background: rgba(248,113,113,0.1); }
.downloads-section { margin-top: 20px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-header h2 { font-size: 1.1rem; font-weight: 500; }
.download-list { display: flex; flex-direction: column; gap: 10px; }
.download-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px; transition: border-color 0.2s;
}
.download-card:hover { border-color: #555; }
.dl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dl-name { font-weight: 500; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin-right: 12px; }
.dl-status { font-size: 0.75rem; font-weight: 600; padding: 3px 10px; border-radius: 20px; flex-shrink: 0; }
.dl-status.initializing { color: var(--info); background: rgba(96,165,250,0.1); }
.dl-status.downloading { color: var(--warn); background: rgba(251,191,36,0.1); }
.dl-status.completed { color: var(--success); background: rgba(74,222,128,0.1); }
.dl-status.uploading { color: var(--info); background: rgba(96,165,250,0.1); }
.dl-status.error { color: var(--error); background: rgba(248,113,113,0.1); }
.dl-status.extracting { color: #c084fc; background: rgba(192,132,252,0.1); }
.dl-progress { margin-bottom: 8px; }
.dl-progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.dl-progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.5s ease; }
.dl-progress-text { font-size: 0.75rem; color: var(--muted); }
.dl-meta { font-size: 0.78rem; color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.dl-files { font-size: 0.78rem; color: var(--muted); margin-bottom: 8px; }
.dl-files summary { cursor: pointer; color: var(--accent); font-weight: 500; }
.dl-files ul { margin-top: 6px; padding-left: 18px; }
.dl-files li { margin-bottom: 2px; }
.dl-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.dl-error { font-size: 0.78rem; color: var(--error); margin-bottom: 8px; }
.anondrop-links { margin-top: 8px; }
.anondrop-links a { display: block; font-size: 0.75rem; color: var(--accent); text-decoration: underline; word-break: break-all; margin-bottom: 2px; }
.empty-state { text-align: center; padding: 40px 20px; color: var(--muted); }
.empty-state .icon { font-size: 3rem; margin-bottom: 12px; display: block; }
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 20px; font-size: 0.85rem; color: var(--text);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5); z-index: 100; opacity: 0;
  pointer-events: none; transition: opacity 0.3s;
}
.toast.show { opacity: 1; }
.dropzone {
  border: 2px dashed var(--border); border-radius: var(--radius); padding: 20px;
  text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
  background: var(--bg); margin-bottom: 14px;
}
.dropzone.dragover { border-color: var(--accent); background: rgba(124,106,247,0.06); }
.dropzone-icon { font-size: 1.8rem; display: block; margin-bottom: 4px; }
.dropzone p { color: var(--muted); font-size: 0.8rem; margin: 0; }
.dropzone .file-name { color: var(--accent); font-size: 0.82rem; font-weight: 500; margin-top: 4px; }
.dropzone input[type="file"] { display: none; }
.or-divider { display: flex; align-items: center; gap: 10px; margin: 14px 0; color: var(--muted); font-size: 0.78rem; }
.or-divider::before, .or-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
/* File picker modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 24px; width: 100%; max-width: 600px; max-height: 80vh; overflow-y: auto;
}
.modal h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 4px; }
.modal .modal-sub { color: var(--muted); font-size: 0.8rem; margin-bottom: 16px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.file-picker-list { max-height: 40vh; overflow-y: auto; }
.file-picker-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px;
  cursor: pointer; transition: border-color 0.2s, background 0.2s;
}
.file-picker-item:hover { border-color: #555; }
.file-picker-item.selected { border-color: var(--accent); background: rgba(124,106,247,0.08); }
.file-picker-item input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
.file-picker-item .fp-info { flex: 1; min-width: 0; }
.file-picker-item .fp-name { font-size: 0.82rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-picker-item .fp-size { font-size: 0.72rem; color: var(--muted); }
.file-picker-select-all { font-size: 0.78rem; color: var(--accent); cursor: pointer; margin-bottom: 8px; display: inline-block; user-select: none; }
.file-picker-select-all:hover { text-decoration: underline; }
@media (max-width: 500px) {
  .input-row { flex-direction: column; }
  .dl-header { flex-direction: column; align-items: flex-start; gap: 6px; }
}
</style>
</head>
<body>
<div class="container">
<h1>🧲 Torrent Downloader</h1>
<p class="subtitle">Paste a magnet link, .torrent URL, or drop a .torrent file — download via Cloudflare Worker and optionally upload to AnonDrop.</p>
<div class="input-section">
  <div class="dropzone" id="dropzone">
    <span class="dropzone-icon">📁</span>
    <p>Drop a <strong>.torrent</strong> file here or click to browse</p>
    <div class="file-name" id="dropFileName"></div>
    <input type="file" id="torrentFileInput" accept=".torrent">
  </div>
  <div class="or-divider">or use a link</div>
  <div class="input-group">
    <label for="magnetInput">Magnet Link or .torrent URL</label>
    <div class="input-row">
      <input type="text" id="magnetInput" placeholder="magnet:?xt=urn:btih:... or https://example.com/file.torrent" autocomplete="off">
      <button id="downloadBtn" class="primary">Download</button>
    </div>
  </div>
  <div class="input-group">
    <label for="anondropKeyInput">AnonDrop Key (optional)</label>
    <div class="input-row">
      <input type="text" id="anondropKeyInput" placeholder="Your AnonDrop key or leave blank to auto-register" autocomplete="off">
      <button id="saveKeyBtn" class="small">Save</button>
    </div>
  </div>
  <div class="toggle-row">
    <label class="toggle-switch"><input type="checkbox" id="autoUploadToggle" checked><span class="toggle-slider"></span></label>
    <label for="autoUploadToggle">Auto-upload to AnonDrop after download</label>
  </div>
</div>
<div class="downloads-section">
  <div class="section-header"><h2>Downloads</h2><button id="refreshBtn" class="small">Refresh</button></div>
  <div class="download-list" id="downloadList">
    <div class="empty-state"><span class="icon">📥</span><p>No downloads yet. Paste a magnet link above to start.</p></div>
  </div>
</div>
</div>
<div class="toast" id="toast"></div>
<script>
(()=>{
const WORKER_URL=location.origin;
const AK='torrentAnonDropKey',PI=3000;
const mi=document.getElementById('magnetInput'),db=document.getElementById('downloadBtn'),
  ai=document.getElementById('anondropKeyInput'),sb=document.getElementById('saveKeyBtn'),
  at=document.getElementById('autoUploadToggle'),dl=document.getElementById('downloadList'),
  rb=document.getElementById('refreshBtn'),to=document.getElementById('toast'),
  dz=document.getElementById('dropzone'),fi=document.getElementById('torrentFileInput'),
  dfn=document.getElementById('dropFileName');
let ads=new Map,pt=null,torrentFile=null;
function lk(){const k=localStorage.getItem(AK);if(k)ai.value=k;}
function sk(){const k=ai.value.trim();if(k){localStorage.setItem(AK,k);st('Key saved');}else{localStorage.removeItem(AK);st('Key cleared');}}
let tt;function st(m){to.textContent=m;to.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>to.classList.remove('show'),2500);}
function fs(b){if(!b||b===0)return'0 B';const k=1024,s=['B','KB','MB','GB','TB'];const i=Math.floor(Math.log(b)/Math.log(k));return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+s[i];}
function ta(ts){if(!ts)return'';const s=Math.floor((Date.now()-ts)/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
function eh(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
async function sD(m,t,fi2){const k=ai.value.trim()||null,au=at.checked,body={autoUpload:au};if(m)body.magnet=m;if(t)body.torrentUrl=t;if(k)body.anondropKey=k;if(fi2&&fi2.length>0)body.fileIndices=fi2;const r=await fetch(WORKER_URL+'/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){const e=await r.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+r.status);}return r.json();}
async function uT(file,fi2){const k=ai.value.trim()||null,au=at.checked;const fd=new FormData();fd.append('torrent',file);if(k)fd.append('anondropKey',k);fd.append('autoUpload',au?'true':'false');if(fi2&&fi2.length>0)fd.append('fileIndices',JSON.stringify(fi2));const r=await fetch(WORKER_URL+'/upload-torrent',{method:'POST',body:fd});if(!r.ok){const e=await r.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+r.status);}return r.json();}
async function gS(id){const r=await fetch(WORKER_URL+'/status/'+encodeURIComponent(id));if(!r.ok)return null;return r.json();}
async function uA(id){const k=ai.value.trim()||null;const r=await fetch(WORKER_URL+'/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,anondropKey:k})});if(!r.ok){const e=await r.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+r.status);}return r.json();}
async function dD(id){const r=await fetch(WORKER_URL+'/delete/'+encodeURIComponent(id),{method:'DELETE'});if(!r.ok){const e=await r.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+r.status);}return r.json();}
async function lD(){const r=await fetch(WORKER_URL+'/list');if(!r.ok)return{downloads:[]};return r.json();}
async function rT(m,t){const r=await fetch(WORKER_URL+'/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m?{magnet:m}:{torrentUrl:t})});if(!r.ok){const e=await r.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+r.status);}return r.json();}

// File picker modal
function showFilePicker(info, onConfirm, isTorrentFile) {
  // Remove any existing modal
  var ex=document.querySelector('.modal-overlay');if(ex)ex.remove();
  var overlay=document.createElement('div');overlay.className='modal-overlay';
  var modal=document.createElement('div');modal.className='modal';
  var totalSize=info.totalSize||info.files.reduce((s,f)=>s+f.size,0);
  var html='<h3>📋 Select Files to Download</h3>';
  html+='<div class="modal-sub">'+eh(info.name)+' — '+info.files.length+' file(s), '+fs(totalSize)+'</div>';
  html+='<span class="file-picker-select-all" id="fpSelectAll">✅ Select All</span>';
  html+='<span class="file-picker-select-all" id="fpDeselectAll" style="margin-left:12px;">⬜ Deselect All</span>';
  html+='<div class="file-picker-list">';
  for(var i=0;i<info.files.length;i++){
    var f=info.files[i];
    html+='<label class="file-picker-item selected"><input type="checkbox" value="'+i+'" checked><div class="fp-info"><div class="fp-name">'+eh(f.name)+'</div><div class="fp-size">'+fs(f.size)+'</div></div></label>';
  }
  html+='</div>';
  html+='<div class="modal-actions"><button id="fpCancel" class="small">Cancel</button><button id="fpConfirm" class="small primary">Download Selected</button></div>';
  modal.innerHTML=html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var checkboxes=modal.querySelectorAll('input[type="checkbox"]');
  var items=modal.querySelectorAll('.file-picker-item');

  function updateSelected(){
    for(var i=0;i<checkboxes.length;i++){
      if(checkboxes[i].checked)items[i].classList.add('selected');
      else items[i].classList.remove('selected');
    }
  }

  modal.querySelector('#fpSelectAll').onclick=function(){
    for(var i=0;i<checkboxes.length;i++)checkboxes[i].checked=true;
    updateSelected();
  };
  modal.querySelector('#fpDeselectAll').onclick=function(){
    for(var i=0;i<checkboxes.length;i++)checkboxes[i].checked=false;
    updateSelected();
  };
  for(var i=0;i<items.length;i++){
    items[i].onclick=function(e){
      if(e.target.tagName==='INPUT')return;
      var cb=this.querySelector('input');
      cb.checked=!cb.checked;
      updateSelected();
    };
  }
  modal.querySelector('#fpCancel').onclick=function(){overlay.remove();};
  modal.querySelector('#fpConfirm').onclick=function(){
    var selected=[];
    for(var i=0;i<checkboxes.length;i++){
      if(checkboxes[i].checked)selected.push(parseInt(checkboxes[i].value));
    }
    overlay.remove();
    if(selected.length===0){st('Please select at least one file');return;}
    onConfirm(selected);
  };
  overlay.onclick=function(e){if(e.target===overlay)overlay.remove();};
}

async function hD(){
  var iv=mi.value.trim();
  if(!iv){st('Please enter a magnet link or .torrent URL');return;}
  var im=iv.startsWith('magnet:'),iu=iv.startsWith('http://')||iv.startsWith('https://');
  if(!im&&!iu){st('Please enter a valid magnet link or URL');return;}
  db.disabled=true;db.textContent='Resolving…';
  try{
    var info=await rT(im?iv:null,iu?iv:null);
    db.disabled=false;db.textContent='Download';
    showFilePicker(info,function(selected){
      db.disabled=true;db.textContent='Starting…';
      sD(im?iv:null,iu?iv:null,selected).then(function(r){
        ads.set(r.id,r);mi.value='';st('Download started!');rL();sP();
      }).catch(function(e){st('Error: '+e.message);}).finally(function(){db.disabled=false;db.textContent='Download';});
    },false);
  }catch(e){st('Error: '+e.message);db.disabled=false;db.textContent='Download';}
}

async function hTU(file){
  if(!file){st('No file selected');return;}
  db.disabled=true;db.textContent='Parsing…';
  try{
    // For .torrent files, parse locally to show file picker
    var buf=await file.arrayBuffer();
    var info=parseTorrentLocally(buf);
    db.disabled=false;db.textContent='Download';
    showFilePicker(info,function(selected){
      db.disabled=true;db.textContent='Uploading…';
      uT(file,selected).then(function(r){
        ads.set(r.id,r);torrentFile=null;dfn.textContent='';fi.value='';
        st('Torrent uploaded — download started!');rL();sP();
      }).catch(function(e){st('Error: '+e.message);}).finally(function(){db.disabled=false;db.textContent='Download';});
    },true);
  }catch(e){st('Error parsing torrent: '+e.message);db.disabled=false;db.textContent='Download';}
}

// Local bencode parser for .torrent files (used in browser for file picker)
function parseTorrentLocally(buffer){
  var data=new Uint8Array(buffer),pos=0;
  function readString(len){var s='';for(var i=0;i<len;i++)s+=String.fromCharCode(data[pos++]);return s;}
  function parse(){
    var b=data[pos];
    if(b===0x69){pos++;var ns='';while(data[pos]!==0x65)ns+=String.fromCharCode(data[pos++]);pos++;return parseInt(ns);}
    if(b===0x6c){pos++;var l=[];while(data[pos]!==0x65)l.push(parse());pos++;return l;}
    if(b===0x64){pos++;var d={};while(data[pos]!==0x65){var k=parse();var v=parse();d[k]=v;}pos++;return d;}
    if(b>=0x30&&b<=0x39){var ls='';while(data[pos]>=0x30&&data[pos]<=0x39)ls+=String.fromCharCode(data[pos++]);pos++;return readString(parseInt(ls));}
    throw new Error('Bad bencode');
  }
  var t=parse(),info=t.info;
  if(!info)throw new Error('No info dict');
  var name=info.name||'Unknown',files=[],totalSize=0;
  if(info.files){for(var i=0;i<info.files.length;i++){var f=info.files[i],p=Array.isArray(f.path)?f.path.join('/'):f.path,sz=f.length||0;files.push({index:i,name:p,size:sz});totalSize+=sz;}}
  else if(info.length){files.push({index:0,name:name,size:info.length||0});totalSize=info.length||0;}
  return{name:name,totalSize:totalSize,files:files};
}

function sP(){if(pt)return;pt=setInterval(pA,PI);}
async function pA(){var ha=false;for(var _i=0,_ks=Array.from(ads.keys()),_k;_k=_ks[_i];_i++){var dd=ads.get(_k);if(dd.status==='completed'||dd.status==='error')continue;ha=true;try{var s=await gS(_k);if(s)ads.set(_k,s);}catch(e){}}
rL();if(!ha){try{var l=await lD();for(var _j=0;_j<l.downloads.length;_j++){var d=l.downloads[_j];if(d.status==='downloading'||d.status==='initializing'||d.status==='uploading'){ha=true;ads.set(d.id,d);}}}catch(e){}}
if(!ha){clearInterval(pt);pt=null;}}
function rL(){if(ads.size===0){dl.innerHTML='<div class="empty-state"><span class="icon">📥</span><p>No downloads yet. Paste a magnet link above to start.</p></div>';return;}
dl.innerHTML=Array.from(ads.values()).sort(function(a,b){return(b.startedAt||0)-(a.startedAt||0);}).map(function(d){
var sc=d.status||'initializing',sl={initializing:'Initializing',downloading:'Downloading',completed:'Completed',uploading:'Uploading',extracting:'Extracting RAR',error:'Failed'}[d.status]||d.status;
var p=d.progress||0,pb='';if(d.status==='downloading'||d.status==='uploading'||d.status==='extracting')pb='<div class="dl-progress"><div class="dl-progress-bar"><div class="dl-progress-fill" style="width:'+p+'%"></div></div><div class="dl-progress-text">'+p+'%'+(d.currentFile?' — '+eh(d.currentFile):'')+'</div></div>';
var m=[];if(d.name)m.push('<span>📦 '+eh(d.name)+'</span>');if(d.size)m.push('<span>'+fs(d.size)+'</span>');if(d.files)m.push('<span>'+(d.files.length||d.files)+' file(s)</span>');if(d.startedAt)m.push('<span>🕐 '+ta(d.startedAt)+'</span>');
if(d.extractedFromRar)m.push('<span>📦 Unpacked '+d.extractedCount+' file(s) from '+d.rarFileCount+' RAR(s)</span>');
var fh='';if(d.files&&d.files.length>0){fh='<details class="dl-files"><summary>'+d.files.length+' file(s)</summary><ul>';for(var i=0;i<d.files.length;i++)fh+='<li>'+eh(d.files[i].name||d.files[i])+' — '+fs(d.files[i].size||0)+(d.files[i]._extracted?' 🔓':'')+'</li>';fh+='</ul></details>';}
var eh2=d.error?'<div class="dl-error">⚠ '+eh(d.error)+'</div>':'';
var ah='';if(d.anondropUrls&&d.anondropUrls.length>0){ah='<div class="anondrop-links">';for(var i=0;i<d.anondropUrls.length;i++)ah+='<a href="'+eh(d.anondropUrls[i].url||d.anondropUrls[i])+'" target="_blank" rel="noopener">🔗 '+eh(d.anondropUrls[i].file||'file')+'</a>';ah+='</div>';}
var ac=[];if(d.status==='completed'&&(!d.anondropUrls||d.anondropUrls.length===0))ac.push('<button class="small primary" onclick="window._ua(\\''+d.id+'\\')">Upload to AnonDrop</button>');if(d.status==='completed')ac.push('<button class="small" onclick="window._df(\\''+d.id+'\\')">Download</button>');ac.push('<button class="small danger" onclick="window._dd(\\''+d.id+'\\')">Delete</button>');
return '<div class="download-card"><div class="dl-header"><span class="dl-name">'+eh(d.name||d.id)+'</span><span class="dl-status '+sc+'">'+sl+'</span></div>'+pb+(m.length>0?'<div class="dl-meta">'+m.join('')+'</div>':'')+fh+eh2+ah+'<div class="dl-actions">'+ac.join('')+'</div></div>';}).join('');}
window._ua=async function(id){try{st('Uploading to AnonDrop…');var r=await uA(id);ads.set(id,Object.assign({},ads.get(id),{anondropUrls:r.urls,status:'completed'}));rL();st('Upload complete!');}catch(e){st('Upload failed: '+e.message);}};
window._df=function(id){window.open(WORKER_URL+'/files/'+encodeURIComponent(id),'_blank');};
window._dd=async function(id){try{await dD(id);ads.delete(id);rL();st('Download deleted');}catch(e){st('Delete failed: '+e.message);}};
db.addEventListener('click',hD);mi.addEventListener('keydown',function(e){if(e.key==='Enter')hD();});sb.addEventListener('click',sk);
rb.addEventListener('click',async function(){try{var l=await lD();ads.clear();for(var _j=0;_j<l.downloads.length;_j++)ads.set(l.downloads[_j].id,l.downloads[_j]);rL();if(l.downloads.some(function(d){return d.status==='downloading'||d.status==='initializing';}))sP();}catch(e){st('Failed to refresh');}});
lk();
dz.addEventListener('click',function(){fi.click();});
fi.addEventListener('change',function(){var f=fi.files[0];if(f){torrentFile=f;dfn.textContent=f.name+' ('+fs(f.size)+')';hTU(f);}});
dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('dragover');});
dz.addEventListener('dragleave',function(){dz.classList.remove('dragover');});
dz.addEventListener('drop',function(e){e.preventDefault();dz.classList.remove('dragover');var f=e.dataTransfer.files[0];if(f){if(!f.name.endsWith('.torrent')){st('Only .torrent files are accepted');return;}torrentFile=f;dfn.textContent=f.name+' ('+fs(f.size)+')';hTU(f);}});
(async function(){try{var l=await lD();for(var _j=0;_j<l.downloads.length;_j++)ads.set(l.downloads[_j].id,l.downloads[_j]);rL();if(l.downloads.some(function(d){return d.status==='downloading'||d.status==='initializing'||d.status==='uploading';}))sP();}catch(e){}})();
})();
</script>
</body>
</html>`;
}

// ── Utilities ──
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function guessMimeType(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const mimeMap = {
    mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mov: 'video/quicktime', webm: 'video/webm', flv: 'video/x-flv',
    mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg',
    wav: 'audio/wav', aac: 'audio/aac', m4a: 'audio/mp4',
    pdf: 'application/pdf', epub: 'application/epub+zip',
    zip: 'application/zip', rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
    gz: 'application/gzip', iso: 'application/x-iso9660-image',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    txt: 'text/plain', html: 'text/html', css: 'text/css',
    js: 'application/javascript', json: 'application/json',
    xml: 'application/xml',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}