/* ============================================================
 * Origami Helper — Meeting form (section 07 implementation)
 * ============================================================ */

const MEETING_CFG = {
  addressField:    "fld_1162",
  subtypeField:    "fld_1368",
  sub2Field:       "fld_1369",
  meetingForField: "fld_1331",
  leadField:       "fld_1069",
  clientField:     "fld_1089",
  employeeField:   "fld_1767",
  pensionAddress:  "מושב מאור",
  pensionSubtypes: ["כניסה לפנסיון שהות", "יציאה מפנסיון שהות"],
  pensionSub2:     "בפנסיון",
  entityAddressMap: {
    fld_1069: { entityName: "leads",   addressField: "full_address",        nameField: "fld_1647" },
    fld_1089: { entityName: "clients", addressField: "client_full_address", nameField: "fld_1470" },
    fld_1767: { entityName: "e_92",    addressField: null,                  nameField: "fld_1567" },
  },
  namePickerMap: {
    fld_1619: { entityName: "e_92",    nameField: "fld_1567" },
    fld_1767: { entityName: "e_92",    nameField: "fld_1567" },
    fld_1069: { entityName: "leads",   nameField: "fld_1647" },
    fld_1089: { entityName: "clients", nameField: "fld_1470" },
  },
  lookupUrl:       "https://hook.eu2.make.com/8mevgbj7owvu6sjj2dt4if6o9jenfpfj",
  pensionEntityId: "e_97",
  pensionRecordId: "6a16ff19c5f1b2ddda0d2aa2",
  pensionAddrFld:  "fld_1786",
  select2WriteMode: "jsonArray",
  waitTimeoutMs:   8000,
  waitPollMs:      200,
  applyDebounceMs: 200,
  scanDebounceMs:  80,
};

const OH = (() => {
  const MEETING_PREFIX = "🏠 MEETING";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log   = (...a) => console.log("🦄 Origami Helper:", ...a);
  const warn  = (...a) => console.warn("🦄 Origami Helper:", ...a);
  const mlog  = (...a) => console.log(MEETING_PREFIX + ":", ...a);
  const mwarn = (...a) => console.warn(MEETING_PREFIX + ":", ...a);

  function safeJsonParse(value, fallback = null) {
    try {
      if (value === undefined || value === null) return fallback;
      if (typeof value === "object") return value;
      const s = String(value).trim();
      if (!s || s === "undefined" || s === "null") return fallback;
      return JSON.parse(s);
    } catch (e) { return fallback; }
  }
  function sanitizeValue(v, { empty = "" } = {}) {
    if (v === undefined || v === null) return empty;
    if (typeof v === "string") { const t = v.trim(); if (t === "undefined" || t === "null") return empty; return v; }
    return v;
  }
  const sel = (name) => `[name="${name}"]`;
  const $el = (name) => document.querySelector(sel(name));
  const hasJQ = () => typeof window.$ === "function";
  const isSelect2El = (el) => !!(el && el.classList && el.classList.contains("select2-hidden-accessible"));

  function getDomValue(fieldName, { preferSelect2Text = true } = {}) {
    const el = $el(fieldName);
    if (!el) return { found: false, raw: "", norm: "" };
    let raw = "";
    const tag = (el.tagName || "").toLowerCase();
    if (hasJQ() && isSelect2El(el)) {
      try {
        const $e = window.$(el);
        const data = $e.select2("data") || [];
        if (preferSelect2Text && data.length) { const d0 = data[0] || {}; raw = sanitizeValue(d0.text || d0.id, { empty: "" }); }
        else { raw = sanitizeValue($e.val(), { empty: "" }); }
      } catch (e) { raw = sanitizeValue(el.value, { empty: "" }); }
    } else if (tag === "input" || tag === "select" || tag === "textarea") { raw = sanitizeValue(el.value, { empty: "" }); }
    else { raw = sanitizeValue(el.value || el.textContent || "", { empty: "" }); }
    return { found: true, raw, norm: String(raw || "").trim(), el };
  }
  function setBasicValue(fieldName, value) {
    const el = $el(fieldName);
    if (!el) return false;
    el.value = sanitizeValue(value, { empty: "" });
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function setSelect2Value(fieldName, { id, text }, { mode = "jsonArray", allowEmpty = false } = {}) {
    const el = $el(fieldName);
    if (!el) return false;
    const safeId = sanitizeValue(id, { empty: "" });
    const safeText = sanitizeValue(text, { empty: "" });
    if (!safeId && !safeText) { if (!allowEmpty) return setBasicValue(fieldName, mode === "jsonArray" ? "[]" : ""); }
    let payload = "";
    if (mode === "jsonArray") { payload = JSON.stringify([safeId, safeText].filter(x => x !== "")); if (!payload) payload = "[]"; }
    else { payload = safeId || safeText || ""; }
    el.value = payload;
    if (hasJQ() && isSelect2El(el)) { try { window.$(el).trigger("change"); } catch (e) { el.dispatchEvent(new Event("change", { bubbles: true })); } }
    else { el.dispatchEvent(new Event("change", { bubbles: true })); }
    return true;
  }
  function debounce(fn, delayMs = 250) { let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delayMs); }; }
  function parseUrlPrefill() {
    const map = {};
    try {
      const u = new URL(window.location.href);
      const f = u.searchParams.get("fields");
      if (!f) return map;
      for (const pair of f.split(",")) { const i = pair.indexOf(":"); if (i < 0) continue; const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1); if (k) map[k] = v; }
    } catch (e) { warn("parseUrlPrefill error:", e); }
    return map;
  }
  async function simpleLookup(entityId, recordId, lookupUrl) {
    try {
      const res = await fetch(lookupUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "simple_lookup", entity_id: entityId, record_id: recordId }) });
      return await res.json();
    } catch (e) { warn("simpleLookup error:", e); return null; }
  }

  const Meeting = (() => {
    const C = MEETING_CFG;
    let urlPrefill = {};
    let lastAutoWritten = null;
    let pensionAddressCache = null;
    let lastLinkedAddress = null;
    const prefilledFields = new Set();
    const processedLinkedRecords = new Set();

    function extractFieldValue(rec, fieldDataName) {
      if (!rec || !fieldDataName) return "";
      for (const k of Object.keys(rec)) { const v = rec[k]; if (v && typeof v === "object" && !Array.isArray(v) && v[fieldDataName] !== undefined) return sanitizeValue(v[fieldDataName], { empty: "" }); }
      if (rec[fieldDataName] !== undefined) return sanitizeValue(rec[fieldDataName], { empty: "" });
      for (const g of rec.field_groups || []) for (const row of g?.fields_data || []) for (const f of row || []) if (f?.field_data_name === fieldDataName) return sanitizeValue(f.value, { empty: "" });
      return "";
    }
    async function fetchPensionAddress() {
      if (pensionAddressCache !== null) return pensionAddressCache;
      const r = await simpleLookup(C.pensionEntityId, C.pensionRecordId, C.lookupUrl);
      const rec = r?.data?.[0] || r?.data || r;
      let addr = String(extractFieldValue(rec, C.pensionAddrFld) || "").trim();
      if (!addr) { mwarn("⚠️ pension lookup empty, using fallback"); addr = C.pensionAddress; }
      pensionAddressCache = addr;
      mlog("📍 pension address resolved:", addr);
      return addr;
    }
    function norm(s) { return String(s || "").normalize("NFC").trim().replace(/\s+/g, " "); }
    function isPensionContext() {
      const subtype = norm(getDomValue(C.subtypeField).norm);
      const sub2 = norm(getDomValue(C.sub2Field).norm);
      const meetingFor = norm(getDomValue(C.meetingForField).norm);
      if (meetingFor === norm("עובד")) return true;
      if (C.pensionSubtypes.some(s => norm(s) === subtype)) return true;
      if (norm(C.pensionSub2) === sub2) {
        const sub2El = document.querySelector('[name="' + C.sub2Field + '"]');
        const wrap = sub2El ? sub2El.closest(".form_data_element_wrap") : null;
        const visible = wrap ? (!wrap.classList.contains("hidden") && !wrap.classList.contains("ng-hide") && wrap.offsetParent !== null) : false;
        if (visible) return true;
      }
      return false;
    }
    function shouldOverwriteAddress() {
      const cur = norm(getDomValue(C.addressField).norm);
      if (!cur) return true;
      if (lastAutoWritten && cur === norm(lastAutoWritten)) return true;
      if (urlPrefill[C.addressField] && cur === norm(urlPrefill[C.addressField])) return true;
      return false;
    }
    async function applyAddressForContext() {
      if (isPensionContext()) {
        if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving (pension)"); return; }
        const addr = await fetchPensionAddress();
        if (addr) { setBasicValue(C.addressField, addr); lastAutoWritten = addr; mlog("🏠 forced pension address on subtype change:", addr); }
        return;
      }
      if (lastLinkedAddress) {
        if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
        mlog("📍 restoring linked-record address:", lastLinkedAddress);
        setBasicValue(C.addressField, lastLinkedAddress);
        lastAutoWritten = lastLinkedAddress;
      }
    }
    async function applyAddressFromLinkedRecord(pickerFieldName, rawValue) {
      const map = C.entityAddressMap[pickerFieldName];
      if (!map) return;
      if (isPensionContext()) return;
      if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
      if (!map.addressField) { const addr = await fetchPensionAddress(); if (!addr) return; mlog("📍 employee meeting → pension:", addr); setBasicValue(C.addressField, addr); lastAutoWritten = addr; return; }
      let recordId = "";
      const v = String(rawValue || "").trim();
      if (!v) return;
      if (v.startsWith("[")) { const arr = safeJsonParse(v, null); if (Array.isArray(arr) && arr[0]) recordId = String(arr[0]); } else recordId = v;
      if (!recordId) return;
      const dedupeKey = pickerFieldName + "|" + recordId;
      if (processedLinkedRecords.has(dedupeKey)) return;
      processedLinkedRecords.add(dedupeKey);
      mlog("🔎 lookup", map.entityName, recordId);
      const r = await simpleLookup(map.entityName, recordId, C.lookupUrl);
      const rec = r?.data?.[0] || r?.data || r;
      if (map.nameField) { const displayName = String(extractFieldValue(rec, map.nameField) || "").trim(); if (displayName) { setSelect2Value(pickerFieldName, { id: recordId, text: displayName }, { mode: C.select2WriteMode }); mlog("👤 picker display →", pickerFieldName, "=", displayName); } }
      const addr = String(extractFieldValue(rec, map.addressField) || "").trim();
      if (!addr) { mwarn("⚠️ no address on record", recordId); return; }
      lastLinkedAddress = addr;
      if (isPensionContext()) { mlog("🏠 pension context active — caching linked addr but not writing"); return; }
      if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
      mlog("📍 writing linked-record address:", addr);
      setBasicValue(C.addressField, addr);
      lastAutoWritten = addr;
    }
    const resolvedNamePickers = new Set();
    async function resolveNamePicker(pickerField, rawValue) {
      const map = C.namePickerMap[pickerField];
      if (!map) return;
      let id = "";
      const v = String(rawValue || "").trim();
      if (!v) return;
      if (v.startsWith("[")) { const a = safeJsonParse(v, null); if (Array.isArray(a) && a[0]) id = String(a[0]); } else id = v;
      if (!id) return;
      const key = pickerField + "|" + id;
      if (resolvedNamePickers.has(key)) return;
      resolvedNamePickers.add(key);
      const r = await simpleLookup(map.entityName, id, C.lookupUrl);
      const rec = r?.data?.[0] || r?.data || r;
      const name = String(extractFieldValue(rec, map.nameField) || "").trim();
      if (name) { setSelect2Value(pickerField, { id, text: name }, { mode: C.select2WriteMode }); mlog("👤 name-picker", pickerField, "→", name); }
    }
    function fillFromUrlIfPossible(name) {
      if (prefilledFields.has(name)) return;
      const val = urlPrefill[name];
      if (val === undefined || val === "") return;
      const cur = getDomValue(name);
      if (!cur.found) return;
      if (cur.norm) { prefilledFields.add(name); return; }
      const isLookup = !!C.entityAddressMap[name] || !!C.namePickerMap[name] || isSelect2El(cur.el);
      if (isLookup) setSelect2Value(name, { id: val, text: val }, { mode: C.select2WriteMode });
      else setBasicValue(name, val);
      prefilledFields.add(name);
      mlog("⤵️ prefilled", name, "=", val);
      if (C.namePickerMap[name]) resolveNamePicker(name, val);
    }
    function watchDynamicFields() {
      const scan = () => { const inputs = document.querySelectorAll('input[name^="fld_"], select[name^="fld_"], textarea[name^="fld_"]'); for (const el of inputs) if (el.name) fillFromUrlIfPossible(el.name); };
      scan();
      const mo = new MutationObserver(debounce(scan, C.scanDebounceMs));
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      return mo;
    }

    function bindMeetingListeners() {
      urlPrefill = parseUrlPrefill();
      mlog("🔧 URL prefill:", urlPrefill);

      const debouncedApply = debounce(applyAddressForContext, C.applyDebounceMs);
      const debouncedLinked = debounce((name, val) => applyAddressFromLinkedRecord(name, val), C.applyDebounceMs);

      const handler = (e) => {
        const t = e.target;
        if (!t || !t.name || !t.name.startsWith("fld_")) return;
        if (t.name === C.subtypeField || t.name === C.sub2Field || t.name === C.meetingForField) debouncedApply();
        if (C.entityAddressMap[t.name]) debouncedLinked(t.name, t.value);
      };
      document.addEventListener("change", handler, true);
      document.addEventListener("input",  handler, true);

      if (typeof window.$ === "function") {
        try { window.$(document).on("change", "select[name^='fld_']", function(e) { handler({ target: this }); }); mlog("✅ jQuery change listener attached (Select2 compat)"); }
        catch (e) { mwarn("could not attach jQuery listener:", e); }
      }

      watchDynamicFields();
      fetchPensionAddress().catch(e => warn("pension fetch warm-up error:", e));
      setTimeout(applyAddressForContext, 300);

      // ★ DIAGNOSTIC PASS for fld_1771 — dumps EVERY tick exactly what we see, no silent returns
      let diagTicks = 0;
      const diagInterval = setInterval(() => {
        diagTicks++;
        try {
          const el = document.querySelector('[name="fld_1771"]');
          if (!el) { mlog("🔍 t" + diagTicks + " fld_1771: NO ELEMENT"); return; }
          const ng = window.angular;
          if (!ng || typeof ng.element !== "function") { mlog("🔍 t" + diagTicks + " angular missing"); return; }
          const $e = ng.element(el);
          const scope = $e.scope();
          const iso = $e.isolateScope ? $e.isolateScope() : null;
          const elValue = el.value;
          const elTag = el.tagName;
          const scopeKeys = scope ? Object.keys(scope).filter(k => !k.startsWith("$")).slice(0,10) : null;
          const sdVal = scope && scope.scopeData ? scope.scopeData.value : undefined;
          const sdValType = typeof sdVal;
          mlog("🔍 t" + diagTicks + " fld_1771:",
            "elTag=" + elTag,
            "elValue=" + JSON.stringify(elValue).slice(0,80),
            "scope?=" + !!scope, "iso?=" + !!iso,
            "scopeKeys=" + JSON.stringify(scopeKeys),
            "scopeData?=" + (scope && !!scope.scopeData),
            "sdValType=" + sdValType,
            "sdVal=" + JSON.stringify(sdVal).slice(0,120));
          if (scope && scope.scopeData && sdValType !== "object" && elValue) {
            scope.scopeData.value = elValue;
            (scope.$apply ? scope.$apply.bind(scope) : (scope.$root && scope.$root.$apply ? scope.$root.$apply.bind(scope.$root) : ()=>{}))();
            mlog("🎯 t" + diagTicks + " injected '" + elValue + "' into scopeData.value + $apply()");
            clearInterval(diagInterval);
          }
        } catch (e) { mwarn("🔍 t" + diagTicks + " err:", e.message); }
        if (diagTicks >= 8) { mlog("🔍 stopping after 8 ticks"); clearInterval(diagInterval); }
      }, 800);
    }

    return { bindMeetingListeners };
  })();

  return { log, warn, safeJsonParse, sanitizeValue, getDomValue, setBasicValue, setSelect2Value, debounce, parseUrlPrefill, simpleLookup, Meeting };
})();

OH.Meeting.bindMeetingListeners();

function applyContact(id, text) { OH.setSelect2Value(MEETING_CFG.clientField, { id, text }, { mode: MEETING_CFG.select2WriteMode }); }
function applyCustomerType(valueTextOrId) { OH.setBasicValue(MEETING_CFG.meetingForField, valueTextOrId); }
