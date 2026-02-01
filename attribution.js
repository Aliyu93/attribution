(function() {
  'use strict';

  var ENDPOINT = 'https://darlena.shop/recordTouchpointV2';

  var CLICK_KEYS = {
    ScCid:  { key: 'snap_ScCid',    keyTs: 'snap_ScCid_ts',    urlParam: 'ScCid',  maxAgeDays: 28 },
    ttclid: { key: 'tiktok_ttclid', keyTs: 'tiktok_ttclid_ts', urlParam: 'ttclid', maxAgeDays: 28 },
    fbclid: { key: 'darlena_fbclid', keyTs: 'darlena_fbclid_ts', urlParam: 'fbclid', maxAgeDays: 90 },
    gclid:  { key: 'google_gclid',  keyTs: 'google_gclid_ts',  urlParam: 'gclid',  maxAgeDays: 90 }
  };

  var COOKIE_KEYS = {
    scid: { cookieName: '_scid', urlParam: 'scid', storeKey: 'snap_scid' },
    ttp:  { cookieName: '_ttp',  urlParam: 'ttp',  storeKey: 'tiktok_ttp' },
    fbc:  { cookieName: '_fbc',  urlParam: 'fbc',  storeKey: 'meta_fbc' },
    fbp:  { cookieName: '_fbp',  urlParam: 'fbp',  storeKey: 'meta_fbp' }
  };

  var UTM_FIELDS = [
    { key: 'utm_source',            out: 'source',           aliases: ['utm_source', 'utmSource'],            utmKey: 'source' },
    { key: 'utm_medium',            out: 'medium',           aliases: ['utm_medium', 'utmMedium'],            utmKey: 'medium' },
    { key: 'utm_campaign',          out: 'campaign',         aliases: ['utm_campaign', 'utmCampaign'],        utmKey: 'campaign' },
    { key: 'utm_term',              out: 'term',             aliases: ['utm_term', 'utmTerm'],                utmKey: 'term' },
    { key: 'utm_content',           out: 'content',          aliases: ['utm_content', 'utmContent'],          utmKey: 'content' },
    { key: 'utm_id',                out: 'id',               aliases: ['utm_id', 'utmId'],                    utmKey: 'id' },
    { key: 'utm_source_platform',   out: 'source_platform',  aliases: ['utm_source_platform', 'utmSourcePlatform'], utmKey: 'source_platform' },
    { key: 'utm_creative_format',   out: 'creative_format',  aliases: ['utm_creative_format', 'utmCreativeFormat'], utmKey: 'creative_format' },
    { key: 'utm_marketing_tactic',  out: 'marketing_tactic', aliases: ['utm_marketing_tactic', 'utmMarketingTactic'], utmKey: 'marketing_tactic' },
    { key: 'ad_id',                 out: 'ad_id',            aliases: ['ad_id', 'Ad-ID', 'adId'] }
  ];

  var TOUCHPOINT_SESSION_KEY = 'xdevice_attr_sig';
  var TOUCHPOINT_SIG_KEY = 'xdevice_attr_sig_p';
  var TOUCHPOINT_SIG_TS_KEY = 'xdevice_attr_sig_ts';
  var TOUCHPOINT_TTL_MS = 24 * 60 * 60 * 1000;

  var STORAGE_DAYS_UTM = 30;
  var STORAGE_DAYS_REFERRER = 30;
  var STORAGE_DAYS_BROWSER = 30;
  var STORAGE_DAYS_HASHED = 30;

  var WRITE_CUSTOM_COOKIES = false;

  var SALLA_STORAGE_KEYS = {
    link: 'salla_page_link',
    referrer: 'salla_page_referrer',
    fingerprint: 'salla_page_fingerprint',
    eventId: 'salla_event_id'
  };
  var SALLA_CUSTOMER_STORAGE_KEY = 'salla_customer_v2';

  var IP_V4_URL = 'https://api.ipify.org?format=json';
  var IP_V6_URL = 'https://api6.ipify.org?format=json';
  var IP_TIMEOUT_MS = 4000;
  var IP_RETRY_DELAY_MS = 3000;
  var IP_MAX_ATTEMPTS = 2;

  var hasLoaded = false;
  var sendScheduled = false;
  var pendingSend = false;

  var dataLayerWrapActive = false;
  var recordPhoneWrapActive = false;

  var cachedHashedPhone = null;
  var hashedPhonePromise = null;

  function normalizeValue(value) {
    if (value === null || value === undefined) return null;
    var str = String(value);
    if (!str) return null;
    if (str === 'undefined' || str === 'null') return null;
    return str;
  }

  function setCookie(name, value, days) {
    try {
      if (!name) return;
      var v = normalizeValue(value);
      if (!v) return;
      var expires = '';
      if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = '; expires=' + date.toUTCString();
      }
      document.cookie = name + '=' + encodeURIComponent(v) + expires + '; path=/; SameSite=Lax';
    } catch (e) {}
  }

  function getCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[2]) : null;
    } catch (e) { return null; }
  }

  function getFromStorage(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key);
    } catch (e) { return null; }
  }

  function storeInStorage(key, value) {
    var v = normalizeValue(value);
    if (!v) return;
    try { sessionStorage.setItem(key, v); } catch (e) {}
    try { localStorage.setItem(key, v); } catch (e) {}
  }

  function storePersistent(key, value, days) {
    var v = normalizeValue(value);
    if (!v) return;
    storeInStorage(key, v);
    if (WRITE_CUSTOM_COOKIES) setCookie(key, v, days);
  }

  function getUrlParam(name) {
    try {
      var match = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) { return null; }
  }

  function normalizeUrlString(url) {
    var v = normalizeValue(url);
    if (!v) return null;
    return v.replace(/&amp;/g, '&');
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getParamFromUrlString(url, name) {
    var clean = normalizeUrlString(url);
    if (!clean || !name) return null;
    var qIndex = clean.indexOf('?');
    if (qIndex === -1) return null;
    var query = clean.slice(qIndex + 1);
    var hashIndex = query.indexOf('#');
    if (hashIndex !== -1) query = query.slice(0, hashIndex);
    var regex = new RegExp('(?:^|&)' + escapeRegExp(name) + '=([^&]*)');
    var match = query.match(regex);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (e) {
      return match[1];
    }
  }

  function getParamFromLinks(names, links) {
    if (!names || !names.length || !links || !links.length) return null;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      for (var j = 0; j < names.length; j++) {
        var value = getParamFromUrlString(link, names[j]);
        if (value) return value;
      }
    }
    return null;
  }

  function getPath(obj, path) {
    if (!obj || !path) return null;
    if (path.indexOf('.') === -1) return obj[path];
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
      if (!current || typeof current !== 'object' || !(parts[i] in current)) return null;
      current = current[parts[i]];
    }
    return current;
  }

  function getDataLayerValue(paths) {
    try {
      if (!window.dataLayer || !window.dataLayer.length) return null;
      for (var i = window.dataLayer.length - 1; i >= 0; i--) {
        var entry = window.dataLayer[i];
        if (!entry || typeof entry !== 'object') continue;
        for (var j = 0; j < paths.length; j++) {
          var value = getPath(entry, paths[j]);
          if (value !== undefined && value !== null && value !== '') return value;
        }
      }
    } catch (e) {}
    return null;
  }

  function pushUnique(list, value) {
    var v = normalizeUrlString(value);
    if (!v) return;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === v) return;
    }
    list.push(v);
  }

  function getSallaContext() {
    var link = getDataLayerValue([
      'page.link',
      'page.view.link',
      'page.view.url',
      'page.url',
      'page.location',
      'page_location',
      'page.url_full',
      'page.urlFull',
      'link',
      'url'
    ]);

    var referrer = getDataLayerValue([
      'page.referrer',
      'page.referer',
      'referrer',
      'referer'
    ]);

    var fingerprint = getDataLayerValue([
      'page.fingerprint',
      'page.view.fingerprint',
      'fingerprint'
    ]);

    var eventId = getDataLayerValue([
      'ecommerce.event_id',
      'ecommerce.eventId',
      'event_id',
      'eventId'
    ]);

    return {
      pageLink: normalizeValue(link) || normalizeValue(getFromStorage(SALLA_STORAGE_KEYS.link)),
      pageReferrer: normalizeValue(referrer) || normalizeValue(getFromStorage(SALLA_STORAGE_KEYS.referrer)),
      pageFingerprint: normalizeValue(fingerprint) || normalizeValue(getFromStorage(SALLA_STORAGE_KEYS.fingerprint)),
      eventId: normalizeValue(eventId) || normalizeValue(getFromStorage(SALLA_STORAGE_KEYS.eventId))
    };
  }

  function getSallaLinkCandidates(ctx) {
    var links = [];
    pushUnique(links, ctx && ctx.pageLink);
    pushUnique(links, ctx && ctx.pageReferrer);
    pushUnique(links, getFromStorage(SALLA_STORAGE_KEYS.link));
    pushUnique(links, getFromStorage(SALLA_STORAGE_KEYS.referrer));
    pushUnique(links, document.referrer);
    pushUnique(links, window.location.href);
    return links;
  }

  function storeSallaContextFromEntry(entry) {
    if (!entry || typeof entry !== 'object') return;
    var link = normalizeValue(
      getPath(entry, 'page.link') ||
      getPath(entry, 'page.view.link') ||
      getPath(entry, 'page.view.url') ||
      getPath(entry, 'page.url') ||
      entry.link ||
      entry.url
    );
    if (link) storeInStorage(SALLA_STORAGE_KEYS.link, link);

    var referrer = normalizeValue(
      getPath(entry, 'page.referrer') ||
      getPath(entry, 'page.referer') ||
      entry.referrer ||
      entry.referer
    );
    if (referrer) storeInStorage(SALLA_STORAGE_KEYS.referrer, referrer);

    var fingerprint = normalizeValue(
      getPath(entry, 'page.fingerprint') ||
      getPath(entry, 'page.view.fingerprint') ||
      entry.fingerprint
    );
    if (fingerprint) storeInStorage(SALLA_STORAGE_KEYS.fingerprint, fingerprint);

    var eventId = normalizeValue(
      getPath(entry, 'ecommerce.event_id') ||
      getPath(entry, 'ecommerce.eventId') ||
      entry.event_id ||
      entry.eventId
    );
    if (eventId) storeInStorage(SALLA_STORAGE_KEYS.eventId, eventId);
  }

  function readValueFromEntry(entry, keys) {
    if (!entry || typeof entry !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var directValue = getPath(entry, k);
      if (directValue) return directValue;
    }
    var containers = ['data', 'page', 'context', 'customer', 'user', 'ecommerce'];
    for (var j = 0; j < containers.length; j++) {
      var obj = entry[containers[j]];
      if (obj && typeof obj === 'object') {
        for (var n = 0; n < keys.length; n++) {
          var kk = keys[n];
          var nestedValue = getPath(obj, kk);
          if (nestedValue) return nestedValue;
        }
      }
    }
    return null;
  }

  function getFromDataLayer(keys) {
    try {
      if (!window.dataLayer || !window.dataLayer.length) return null;
      for (var i = window.dataLayer.length - 1; i >= 0; i--) {
        var entry = window.dataLayer[i];
        var v = readValueFromEntry(entry, keys);
        if (v) return v;
      }
    } catch (e) {}
    return null;
  }

  function getUtmFromDataLayer(field) {
    try {
      if (!window.dataLayer || !window.dataLayer.length) return null;
      for (var i = window.dataLayer.length - 1; i >= 0; i--) {
        var entry = window.dataLayer[i];
        var v = readValueFromEntry(entry, field.aliases);
        if (v) return v;
        if (field.utmKey && entry && entry.utm && typeof entry.utm === 'object' && entry.utm[field.utmKey]) {
          return entry.utm[field.utmKey];
        }
      }
    } catch (e) {}
    return null;
  }

  function getUtmFromUrl(field) {
    for (var i = 0; i < field.aliases.length; i++) {
      var v = getUrlParam(field.aliases[i]);
      if (v) return v;
    }
    return null;
  }

  function collectUtmValues(linkCandidates) {
    var utm = {};
    var sources = {};
    var links = linkCandidates || [];

    for (var i = 0; i < UTM_FIELDS.length; i++) {
      var field = UTM_FIELDS[i];
      var value = null;
      var source = null;

      var fromDl = getUtmFromDataLayer(field);
      if (fromDl) {
        value = fromDl;
        source = 'dataLayer';
      }

      if (!value) {
        var fromLink = getParamFromLinks(field.aliases, links);
        if (fromLink) {
          value = fromLink;
          source = 'salla_link';
        }
      }

      if (!value) {
        var fromStorage = getFromStorage(field.key);
        if (fromStorage) {
          value = fromStorage;
          source = 'storage';
        }
      }

      if (!value) {
        var fromCookie = getCookie(field.key);
        if (fromCookie) {
          value = fromCookie;
          source = 'cookie';
        }
      }

      if (!value) {
        var fromUrl = getUtmFromUrl(field);
        if (fromUrl) {
          value = fromUrl;
          source = 'url';
        }
      }

      value = normalizeValue(value);
      if (value) {
        utm[field.out] = value;
        sources[field.out] = source || 'unknown';
        storePersistent(field.key, value, STORAGE_DAYS_UTM);
      }
    }
    return { values: utm, sources: sources };
  }

  function storeClickId(cfg, value) {
    var v = normalizeValue(value);
    if (!v) return;
    try { sessionStorage.setItem(cfg.key, v); } catch (e) {}
    try {
      localStorage.setItem(cfg.key, v);
      localStorage.setItem(cfg.keyTs, String(Date.now()));
    } catch (e) {}
  }

  function storeCookieId(cfg, value) {
    var v = normalizeValue(value);
    if (!v) return;
    storeInStorage(cfg.storeKey, v);
  }

  function getClickId(cfg) {
    try {
      var v = sessionStorage.getItem(cfg.key) || localStorage.getItem(cfg.key);
      if (v) {
        var ts = parseInt(localStorage.getItem(cfg.keyTs) || '', 10);
        if (!ts || (Date.now() - ts) <= cfg.maxAgeDays * 86400000) return v;
      }
      return null;
    } catch (e) { return null; }
  }

  function collectClickIds(linkCandidates) {
    var links = linkCandidates || [];

    var scid = getCookie(COOKIE_KEYS.scid.cookieName) ||
               getParamFromLinks([COOKIE_KEYS.scid.urlParam, '_scid'], links) ||
               getFromStorage(COOKIE_KEYS.scid.storeKey);
    if (scid) storeCookieId(COOKIE_KEYS.scid, scid);

    var ttp = getCookie(COOKIE_KEYS.ttp.cookieName) ||
              getParamFromLinks([COOKIE_KEYS.ttp.urlParam, '_ttp'], links) ||
              getFromStorage(COOKIE_KEYS.ttp.storeKey);
    if (ttp) storeCookieId(COOKIE_KEYS.ttp, ttp);

    var fbc = getCookie(COOKIE_KEYS.fbc.cookieName) ||
              getParamFromLinks([COOKIE_KEYS.fbc.urlParam, '_fbc'], links) ||
              getFromStorage(COOKIE_KEYS.fbc.storeKey);
    if (fbc) storeCookieId(COOKIE_KEYS.fbc, fbc);

    var fbp = getCookie(COOKIE_KEYS.fbp.cookieName) ||
              getParamFromLinks([COOKIE_KEYS.fbp.urlParam, '_fbp'], links) ||
              getFromStorage(COOKIE_KEYS.fbp.storeKey);
    if (fbp) storeCookieId(COOKIE_KEYS.fbp, fbp);

    var scClickId = getParamFromLinks(['ScCid', '_ScCid', 'sccid'], links) ||
      getClickId(CLICK_KEYS.ScCid) ||
      getUrlParam('ScCid') ||
      getUrlParam('_ScCid') ||
      getUrlParam('sccid');
    if (scClickId) storeClickId(CLICK_KEYS.ScCid, scClickId);

    var ttClickId = getParamFromLinks(['ttclid'], links) ||
      getClickId(CLICK_KEYS.ttclid) ||
      getUrlParam('ttclid');
    if (ttClickId) storeClickId(CLICK_KEYS.ttclid, ttClickId);

    var fbclid = getParamFromLinks(['fbclid'], links) ||
      getClickId(CLICK_KEYS.fbclid) ||
      getUrlParam('fbclid');
    if (fbclid) storeClickId(CLICK_KEYS.fbclid, fbclid);

    var gclid = getParamFromLinks(['gclid'], links) ||
      getClickId(CLICK_KEYS.gclid) ||
      getUrlParam('gclid');
    if (gclid) storeClickId(CLICK_KEYS.gclid, gclid);

    return {
      scClickId: scClickId || null,
      ttClickId: ttClickId || null,
      fbclid: fbclid || null,
      gclid: gclid || null,

      sc_cookie1: scid || null,
      ttp: ttp || null,
      fbc: fbc || null,
      fbp: fbp || null
    };
  }

  function getHostFromUrl(url) {
    try {
      if (!url) return null;
      var a = document.createElement('a');
      a.href = url;
      return a.hostname || null;
    } catch (e) { return null; }
  }

  function getOriginFromUrl(url) {
    try {
      if (!url) return null;
      var a = document.createElement('a');
      a.href = url;
      if (!a.protocol || !a.host) return null;
      return a.protocol + '//' + a.host;
    } catch (e) { return null; }
  }

  function collectReferrerInfo(sallaContext) {
    var storedFirst = normalizeValue(
      getFromStorage('first_referer') ||
      getFromStorage('first_referrer') ||
      getCookie('first_referer') ||
      getCookie('first_referrer')
    );

    var current = normalizeValue(
      (sallaContext && sallaContext.pageReferrer) ||
      document.referrer ||
      ''
    );

    var first = storedFirst;
    if (!first && current) {
      first = current;
      storePersistent('first_referer', first, STORAGE_DAYS_REFERRER);
      storeInStorage('first_referrer', first);
    } else if (first) {
      storeInStorage('first_referer', first);
      storeInStorage('first_referrer', first);
    }

    return {
      first: first || null,
      current: current || null,
      firstHost: getHostFromUrl(first),
      currentHost: getHostFromUrl(current)
    };
  }

  function detectBrowserName(ua) {
    var u = (ua || '').toLowerCase();
    if (!u) return null;
    if (u.indexOf('snapchat') !== -1) return 'snapchat';
    if (u.indexOf('instagram') !== -1) return 'instagram';
    if (u.indexOf('facebook') !== -1) return 'facebook';
    if (u.indexOf('tiktok') !== -1) return 'tiktok';
    if (u.indexOf('bytedance') !== -1) return 'tiktok';
    if (u.indexOf('tabby') !== -1) return 'tabby';
    if (u.indexOf('tamara') !== -1) return 'tamara';
    if (u.indexOf('gsa') !== -1) return 'google';
    if (u.indexOf('edg') !== -1) return 'edge';
    if (u.indexOf('firefox') !== -1) return 'firefox';
    if (u.indexOf('crios') !== -1 || u.indexOf('chrome') !== -1) return 'chrome';
    if (u.indexOf('safari') !== -1) return 'safari';
    return null;
  }

  function getFirstBrowserName() {
    var stored = normalizeValue(getFromStorage('first_browser') || getCookie('first_browser'));
    if (stored) return stored;
    var detected = detectBrowserName(navigator.userAgent || '');
    if (detected) storePersistent('first_browser', detected, STORAGE_DAYS_BROWSER);
    return detected || null;
  }

  function collectDeviceMeta() {
    var screenObj = window.screen || {};
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    var timezone = null;
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      }
    } catch (e) {}

    return {
      platform: 'web',
      screenWidth: screenObj.width || null,
      screenHeight: screenObj.height || null,
      viewportWidth: window.innerWidth || null,
      viewportHeight: window.innerHeight || null,
      devicePixelRatio: window.devicePixelRatio || 1,
      colorDepth: screenObj.colorDepth || null,
      language: (navigator.language || '').split('-')[0] || null,
      timezone: timezone,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      touchPoints: navigator.maxTouchPoints || null,
      connection: connection ? {
        effectiveType: connection.effectiveType || null,
        downlink: connection.downlink || null,
        rtt: connection.rtt || null,
        saveData: connection.saveData || null
      } : null
    };
  }

  function collectUserAgentInfo() {
    var uaRaw = navigator.userAgent || '';
    var browserName = getFirstBrowserName() || detectBrowserName(uaRaw);
    var info = { uaRaw: uaRaw || null, browserName: browserName || null };
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        return navigator.userAgentData.getHighEntropyValues([
          'brands',
          'platform',
          'platformVersion',
          'mobile',
          'model',
          'architecture',
          'bitness'
        ]).then(function(data) {
          info.uaData = data || null;
          return info;
        }).catch(function() { return info; });
      }
    } catch (e) {}
    return Promise.resolve(info);
  }

  function normalizePhone(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;

    if (digits.indexOf('00') === 0) digits = digits.slice(2);

    if (digits.indexOf('966') === 0) return digits;

    if (digits.charAt(0) === '0') digits = digits.slice(1);
    if (digits.indexOf('966') === 0) return digits;

    if (digits.length < 8) return null;

    return '966' + digits;
  }

  function sha256Fallback(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }

    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;

    var result = '';

    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;

    var hash = sha256Fallback.h = sha256Fallback.h || [];
    var k = sha256Fallback.k = sha256Fallback.k || [];
    var primeCounter = k[lengthProperty];

    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
      }
    }

    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
    words[words[lengthProperty]] = asciiBitLength;

    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];

        var a = hash[0];
        var e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function sha256Hex(input) {
    var str = normalizeValue(input);
    if (!str) return Promise.resolve(null);

    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      try {
        var encoder = new TextEncoder();
        return window.crypto.subtle.digest('SHA-256', encoder.encode(str)).then(function(buf) {
          var hex = '';
          var view = new DataView(buf);
          for (var i = 0; i < view.byteLength; i += 4) {
            var value = view.getUint32(i);
            var hexVal = value.toString(16);
            while (hexVal.length < 8) hexVal = '0' + hexVal;
            hex += hexVal;
          }
          return hex;
        }).catch(function() {
          return sha256Fallback(str);
        });
      } catch (e) {
        return Promise.resolve(sha256Fallback(str));
      }
    }
    return Promise.resolve(sha256Fallback(str));
  }

  function storeHashedPhoneValue(hash) {
    var v = normalizeValue(hash);
    if (!v) return;
    cachedHashedPhone = v;
    storeInStorage('hashed_phone', v);
    if (WRITE_CUSTOM_COOKIES) setCookie('hashed_phone', v, STORAGE_DAYS_HASHED);
  }

  function hashPhone(phone) {
    var normalized = normalizePhone(phone);
    if (!normalized) return Promise.resolve(null);
    return sha256Hex(normalized).then(function(hash) {
      if (hash) storeHashedPhoneValue(hash);
      return hash || null;
    });
  }

  function ensureHashedPhoneReady() {
    if (cachedHashedPhone) return Promise.resolve(cachedHashedPhone);
    var stored = normalizeValue(getFromStorage('hashed_phone') || getCookie('hashed_phone'));
    if (stored) {
      cachedHashedPhone = stored;
      return Promise.resolve(stored);
    }
    if (hashedPhonePromise) return hashedPhonePromise;
    return Promise.resolve(null);
  }

  function capturePhone(phone) {
    var normalized = normalizeValue(phone);
    if (!normalized) return;
    if (hashedPhonePromise) return;
    hashedPhonePromise = hashPhone(normalized).then(function(hash) {
      hashedPhonePromise = null;
      if (hash) scheduleSend(0);
      return hash;
    });
  }

  function extractPhoneFromValue(value) {
    if (!value) return null;
    if (typeof value === 'object') {
      var code = value.code || value.country_code || value.countryCode || '';
      var number = value.number || value.national_number || value.nationalNumber || value.phone || value.mobile || value.value || null;
      if (number) {
        var prefix = String(code || '').replace(/^\+/, '');
        return (prefix ? prefix : '') + String(number);
      }
    }
    return value;
  }

  function extractPhoneFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var candidates = ['phone', 'mobile', 'phone_number', 'phoneNumber'];
    for (var i = 0; i < candidates.length; i++) {
      var value = extractPhoneFromValue(obj[candidates[i]]);
      if (value) return value;
    }
    return null;
  }

  function extractPhone(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var fromCustomer = extractPhoneFromObject(entry.customer);
    if (fromCustomer) return fromCustomer;
    var fromData = extractPhoneFromObject(entry.data);
    if (fromData) return fromData;
    var fromUser = extractPhoneFromObject(entry.user);
    if (fromUser) return fromUser;
    var direct = extractPhoneFromObject(entry);
    if (direct) return direct;
    return null;
  }

  function extractHashedPhone(entry) {
    var hashed = readValueFromEntry(entry, [
      'phone_hashed',
      'phoneHashed',
      'hashed_phone',
      'hashedPhone',
      'customer.phone_hashed',
      'customer.phoneHashed'
    ]);
    return normalizeValue(hashed);
  }

  function collectHashedPhoneFromDataLayerEntry(entry) {
    var phone = extractPhone(entry);
    if (phone) {
      capturePhone(phone);
      return;
    }
    if (cachedHashedPhone) return;
    var hashed = extractHashedPhone(entry);
    if (hashed) storeHashedPhoneValue(hashed);
  }

  function readSallaCustomerFromStorage() {
    try {
      var raw = localStorage.getItem(SALLA_CUSTOMER_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.customer) return parsed.customer;
    } catch (e) {}
    return null;
  }

  function captureSallaCustomerSources() {
    var storedCustomer = readSallaCustomerFromStorage();
    if (storedCustomer) {
      var storedPhone = extractPhoneFromObject(storedCustomer);
      if (storedPhone) {
        capturePhone(storedPhone);
      } else if (!cachedHashedPhone) {
        var storedHash = normalizeValue(storedCustomer.phone_hashed || storedCustomer.phoneHashed);
        if (storedHash) storeHashedPhoneValue(storedHash);
      }
    }

    try {
      var sallaUser = (window.salla && window.salla.user) || (window.Salla && window.Salla.user);
      if (sallaUser) {
        var userPhone = extractPhoneFromObject(sallaUser);
        if (userPhone) capturePhone(userPhone);
      }
    } catch (e) {}
  }

  function initSallaCustomerCapture() {
    captureSallaCustomerSources();
    try {
      if (window.Salla && typeof window.Salla.onReady === 'function') {
        window.Salla.onReady(function() {
          captureSallaCustomerSources();
        });
      }
    } catch (e) {}
    try {
      window.addEventListener('salla::created', function() {
        captureSallaCustomerSources();
      }, { once: true });
    } catch (e) {}
    setTimeout(captureSallaCustomerSources, 5000);
  }

  function collectPlatformCookies(clickIds) {
    var platformCookies = {};
    var timestamp = new Date().toISOString();

    if (clickIds.sc_cookie1) {
      platformCookies.snapchat = { id: clickIds.sc_cookie1, timestamp: timestamp };
    }
    if (clickIds.ttp) {
      platformCookies.tiktok = { id: clickIds.ttp, timestamp: timestamp };
    }
    var metaId = clickIds.fbc || clickIds.fbp || null;
    if (metaId) {
      platformCookies.instagram = { id: metaId, timestamp: timestamp };
    }
    if (clickIds.gclid) {
      platformCookies.google = { id: clickIds.gclid, timestamp: timestamp };
    }

    var existing = null;
    try { existing = JSON.parse(localStorage.getItem('platform_cookies') || 'null'); } catch (e) {}

    if (existing && typeof existing === 'object') {
      var keys = ['snapchat', 'tiktok', 'instagram', 'google'];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (platformCookies[k]) {
          existing[k] = platformCookies[k];
        }
      }
      platformCookies = Object.keys(platformCookies).length ? existing : existing;
    }

    try {
      if (platformCookies && Object.keys(platformCookies).length > 0) {
        localStorage.setItem('platform_cookies', JSON.stringify(platformCookies));
      }
    } catch (e) {}

    return platformCookies;
  }

  function signatureFor(base, ipStatus) {
    var parts = [];
    function add(key, value) {
      var v = normalizeValue(value);
      if (v) parts.push(key + '=' + v);
    }

    var clickIds = base.clickIds || {};
    add('scClickId', clickIds.scClickId);
    add('ttClickId', clickIds.ttClickId);
    add('fbclid', clickIds.fbclid);
    add('gclid', clickIds.gclid);
    add('sc_cookie1', clickIds.sc_cookie1);
    add('ttp', clickIds.ttp);
    add('fbc', clickIds.fbc);
    add('fbp', clickIds.fbp);

    var utm = base.utm || {};
    add('utm_source', utm.source);
    add('utm_medium', utm.medium);
    add('utm_campaign', utm.campaign);
    add('utm_term', utm.term);
    add('utm_content', utm.content);
    add('utm_id', utm.id);
    add('utm_source_platform', utm.source_platform);
    add('utm_creative_format', utm.creative_format);
    add('utm_marketing_tactic', utm.marketing_tactic);
    add('ad_id', utm.ad_id);

    var ref = base.referrer || {};
    add('ref', ref.firstHost || ref.currentHost);

    add('browser', (base.userAgent || {}).browserName);
    add('hp', base.hashedPhone || null);

    add('ip_status', ipStatus);

    if (!parts.length) return null;
    return parts.join('&');
  }

  function shouldSkipSignature(sig) {
    var now = Date.now();
    try {
      if (sessionStorage.getItem(TOUCHPOINT_SESSION_KEY) === sig) return true;
    } catch (e) {}

    try {
      var lastSig = localStorage.getItem(TOUCHPOINT_SIG_KEY);
      var lastTs = parseInt(localStorage.getItem(TOUCHPOINT_SIG_TS_KEY) || '', 10);
      if (lastSig === sig && lastTs && (now - lastTs) < TOUCHPOINT_TTL_MS) {
        try { sessionStorage.setItem(TOUCHPOINT_SESSION_KEY, sig); } catch (e) {}
        return true;
      }
    } catch (e) {}

    try { sessionStorage.setItem(TOUCHPOINT_SESSION_KEY, sig); } catch (e) {}
    try {
      localStorage.setItem(TOUCHPOINT_SIG_KEY, sig);
      localStorage.setItem(TOUCHPOINT_SIG_TS_KEY, String(now));
    } catch (e) {}
    return false;
  }

  function fetchIp(url, timeoutMs) {
    return new Promise(function(resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;

      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200) {
          var res = xhr.responseText;
          var ip = res;
          try {
            var parsed = JSON.parse(res);
            if (parsed && parsed.ip) ip = parsed.ip;
          } catch (e) {}
          ip = normalizeValue(ip);
          resolve(ip || null);
        } else {
          resolve(null);
        }
      };

      xhr.onerror = function() { resolve(null); };
      xhr.ontimeout = function() { resolve(null); };
      xhr.send();
    });
  }

  function getIpAddresses(attemptsLeft, existing) {
    var ipData = existing || { ipv4: null, ipv6: null };
    var promises = [];

    if (!ipData.ipv4) {
      promises.push(fetchIp(IP_V4_URL, IP_TIMEOUT_MS).then(function(ip) {
        if (ip) ipData.ipv4 = ip;
      }));
    }
    if (!ipData.ipv6) {
      promises.push(fetchIp(IP_V6_URL, IP_TIMEOUT_MS).then(function(ip) {
        if (ip) ipData.ipv6 = ip;
      }));
    }

    return Promise.all(promises).then(function() {
      if (ipData.ipv4 && ipData.ipv6) return ipData;
      if (attemptsLeft > 1) {
        return new Promise(function(resolve) {
          setTimeout(resolve, IP_RETRY_DELAY_MS);
        }).then(function() {
          return getIpAddresses(attemptsLeft - 1, ipData);
        });
      }
      return ipData;
    });
  }

  function sendRequest(payload) {
    try {
      var body = JSON.stringify(payload);
      var endpointOrigin = getOriginFromUrl(ENDPOINT);
      var pageOrigin = window.location.protocol + '//' + window.location.host;
      var isCrossOrigin = endpointOrigin && endpointOrigin !== pageOrigin;

      if (!isCrossOrigin && navigator.sendBeacon) {
        try {
          var blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(ENDPOINT, blob);
          return;
        } catch (e) {}
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      }).catch(function() {});
    } catch (e) {}
  }

  function buildBasePayload() {
    var sallaContext = getSallaContext();
    var linkCandidates = getSallaLinkCandidates(sallaContext);

    var clickIds = collectClickIds(linkCandidates);
    var utmInfo = collectUtmValues(linkCandidates);
    var referrer = collectReferrerInfo(sallaContext);
    var deviceMeta = collectDeviceMeta();
    var platformCookies = collectPlatformCookies(clickIds);
    var hashedPhone = normalizeValue(getFromStorage('hashed_phone') || getCookie('hashed_phone'));

    if (sallaContext.pageFingerprint) deviceMeta.sallaFingerprint = sallaContext.pageFingerprint;

    return {
      source: 'web',
      timestamp: new Date().toISOString(),
      clickIds: clickIds,
      utm: utmInfo.values,
      utmSources: utmInfo.sources,
      referrer: referrer,
      userAgent: {
        uaRaw: navigator.userAgent || null,
        browserName: getFirstBrowserName() || null
      },
      deviceMeta: deviceMeta,
      platformCookies: platformCookies,
      hashedPhone: hashedPhone || null,
      salla: {
        pageLink: sallaContext.pageLink || null,
        pageReferrer: sallaContext.pageReferrer || null,
        pageFingerprint: sallaContext.pageFingerprint || null,
        eventId: sallaContext.eventId || null
      }
    };
  }

  function sendTouchpoint() {
    var base = buildBasePayload();
    if (!base) return;

    Promise.all([
      collectUserAgentInfo(),
      getIpAddresses(IP_MAX_ATTEMPTS),
      ensureHashedPhoneReady()
    ]).then(function(results) {
      var uaInfo = results[0] || {};
      var ipData = results[1] || {};
      var hashedPhone = results[2] || base.hashedPhone || null;

      if (uaInfo.uaRaw) base.userAgent.uaRaw = uaInfo.uaRaw;
      if (uaInfo.browserName) base.userAgent.browserName = uaInfo.browserName;
      if (uaInfo.uaData) base.userAgent.uaData = uaInfo.uaData;

      base.clientIp = {
        ipv4: ipData.ipv4 || null,
        ipv6: ipData.ipv6 || null
      };

      if (hashedPhone) base.hashedPhone = hashedPhone;

      var ipStatus = 0;
      if (base.clientIp.ipv4) ipStatus += 1;
      if (base.clientIp.ipv6) ipStatus += 2;

      var sig = signatureFor(base, String(ipStatus));
      if (!sig) return;
      if (shouldSkipSignature(sig)) return;

      sendRequest(base);
    }).catch(function() {
      var sig = signatureFor(base, '0');
      if (!sig) return;
      if (shouldSkipSignature(sig)) return;
      sendRequest(base);
    });
  }

  function runAfterLoad(fn) {
    if (document.readyState === 'complete') {
      fn();
      return;
    }
    window.addEventListener('load', function() {
      fn();
    });
  }

  function runWhenIdle(fn, delayMs) {
    var delay = delayMs || 0;
    var run = function() {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(function() { fn(); }, { timeout: 3000 });
      } else {
        setTimeout(fn, 2000);
      }
    };
    if (delay > 0) {
      setTimeout(run, delay);
    } else {
      run();
    }
  }

  function scheduleSend(delayMs) {
    if (!hasLoaded) {
      pendingSend = true;
      return;
    }
    if (sendScheduled) return;
    sendScheduled = true;
    runWhenIdle(function() {
      sendScheduled = false;
      sendTouchpoint();
    }, delayMs || 0);
  }

  function captureFromDataLayerEntry(entry) {
    if (!entry || typeof entry !== 'object') return;

    storeSallaContextFromEntry(entry);
    collectHashedPhoneFromDataLayerEntry(entry);

    for (var i = 0; i < UTM_FIELDS.length; i++) {
      var field = UTM_FIELDS[i];
      var v = readValueFromEntry(entry, field.aliases);
      if (!v && field.utmKey && entry.utm && typeof entry.utm === 'object') {
        v = entry.utm[field.utmKey];
      }
      v = normalizeValue(v);
      if (v) storePersistent(field.key, v, STORAGE_DAYS_UTM);
    }
  }

  function checkExistingDataLayer() {
    if (!window.dataLayer) return;
    for (var i = window.dataLayer.length - 1; i >= 0; i--) {
      captureFromDataLayerEntry(window.dataLayer[i]);
    }
  }

  function interceptDataLayerPush() {
    if (!window.dataLayer) window.dataLayer = [];
    var currentPush = window.dataLayer.push;
    if (currentPush && currentPush.__darlena_wrapped) return;
    if (typeof currentPush !== 'function') return;

    var originalPush = currentPush.bind(window.dataLayer);
    var wrapped = function() {
      var result = originalPush.apply(null, arguments);
      for (var i = 0; i < arguments.length; i++) {
        captureFromDataLayerEntry(arguments[i]);
      }
      scheduleSend(0);
      return result;
    };

    wrapped.__darlena_wrapped = true;
    try {
      for (var key in currentPush) {
        wrapped[key] = currentPush[key];
      }
    } catch (e) {}

    window.dataLayer.push = wrapped;
  }

  function ensureDataLayerWrapped() {
    if (dataLayerWrapActive) return;
    dataLayerWrapActive = true;
    var start = Date.now();
    var timer = setInterval(function() {
      interceptDataLayerPush();
      if (Date.now() - start > 15000) {
        clearInterval(timer);
        dataLayerWrapActive = false;
      }
    }, 250);
  }

  function initAfterLoad() {
    runAfterLoad(function() {
      hasLoaded = true;
      if (pendingSend) {
        pendingSend = false;
        scheduleSend(0);
      }
      ensureDataLayerWrapped();
      ensureRecordPhoneWrapped();
      initSallaCustomerCapture();
      scheduleSend(0);
      scheduleSend(8000);
    });
  }

  function wrapRecordPhoneAttribution() {
    var current = window.darlenaRecordPhoneAttribution;
    if (current && current.__darlena_wrapped) return;
    var existing = (typeof current === 'function') ? current : null;
    var wrapped = function(phone) {
      if (existing && existing !== wrapped) {
        try { existing(phone); } catch (e) {}
      }
      capturePhone(phone);
    };
    wrapped.__darlena_wrapped = true;
    window.darlenaRecordPhoneAttribution = wrapped;
  }

  function ensureRecordPhoneWrapped() {
    if (recordPhoneWrapActive) return;
    recordPhoneWrapActive = true;
    wrapRecordPhoneAttribution();
    var start = Date.now();
    var timer = setInterval(function() {
      wrapRecordPhoneAttribution();
      if (Date.now() - start > 15000) {
        clearInterval(timer);
        recordPhoneWrapActive = false;
      }
    }, 250);
  }

  checkExistingDataLayer();
  interceptDataLayerPush();
  ensureDataLayerWrapped();
  wrapRecordPhoneAttribution();
  initAfterLoad();
})();
