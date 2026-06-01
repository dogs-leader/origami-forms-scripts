/* ============================================================
 * Origami Helper — Meeting form (section 07 implementation)
 * Updated 2026-05-27 (Naftali).
 *
 * Responsibilities:
 *  1. URL prefill: Origami fills fields visible at load. We extend this to
 *     fields that appear DYNAMICALLY (e.g. fld_1069 after fld_1331=ליד).
 *  2. Pension address override: when "סוג פגישה" is one of the pension
 *     subtypes (or fld_1369 = "בפנסיון"), force fld_1162 to pension address.
 *  3. Preserve manual edits to fld_1162.
 *  4. Backwards-compat: OH.* utilities + applyContact / applyCustomerType
 *     globals from prior version.
 * ============================================================ */

/* ────────────────────────────────────────────────────────────
 *  CONFIG — edit values here. Field IDs, addresses, endpoints.
 * ──────────────────────────────────────────────────────────── */
const MEETING_CFG = {
  // Target field — meeting address
  addressField:    "fld_1162",   // כתובת הפגישה

  // Drivers — controllers + subtype
  subtypeField:    "fld_1368",   // סוג פגישה (16 values — see SUBTYPES below)
  sub2Field:       "fld_1369",   // appears conditionally on subtype=אבחון ("בפנסיון"/"בבית הלקוח")
  meetingForField: "fld_1331",   // controller: ליד / לקוח / עובד

  // Linked-record select2 fields (appear dynamically per meetingForField)
  leadField:       "fld_1069",
  clientField:     "fld_1089",
  employeeField:   "fld_1767",

  // Pension config (from settings entity e_97 / record 6a16ff19c5f1b2ddda0d2aa2 / fld_1786)
  pensionAddress:  "מושב מאור",
  pensionSubtypes: ["כניסה לפנסיון שהות", "יציאה מפנסיון שהות"],
  pensionSub2:     "בפנסיון",

  // Per-entity address-field mapping (used when picker holds a record).
  // `addressField` = null means "always use pension address" (employees).
  // `nameField` = field on the linked record used as the picker's display label.
  entityAddressMap: {
    fld_1069: { entityName: "leads",   addressField: "full_address",        nameField: "fld_1647" },
    fld_1089: { entityName: "clients", addressField: "client_full_address", nameField: "fld_1470" },
    fld_1767: { entityName: "e_92",    addressField: null,                  nameField: "fld_1567" },
  },

  // Lookup pickers that only need name-resolution on prefill (NO address logic).
  // נציג אחראי (fld_1619) → employee entity 92, display name field fld_1567.
  namePickerMap: {
    fld_1619: { entityName: "e_92",    nameField: "fld_1567" },
    fld_1767: { entityName: "e_92",    nameField: "fld_1567" },
    fld_1069: { entityName: "leads",   nameField: "fld_1647" },
    fld_1089: { entityName: "clients", nameField: "fld_1470" },
  },

  // Lookup endpoint (the simple_lookup route of scenario 8060598)
  lookupUrl:       "https://hook.eu2.make.com/8mevgbj7owvu6sjj2dt4if6o9jenfpfj",
  pensionEntityId: "e_97",
  pensionRecordId: "6a16ff19c5f1b2ddda0d2aa2",
  pensionAddrFld:  "fld_1786",

  // select2 write format — Origami stores some lookups as JSON [id, text]
  select2WriteMode: "jsonArray",

  // Timings
  waitTimeoutMs:   8000,
  waitPollMs:      200,
  applyDebounceMs: 200,
  scanDebounceMs:  80,
};

/* ────────────────────────────────────────────────────────────
 *  OH — utilities (DOM, select2, debounce, URL parsing, lookups)
 * ──────────────────────────────────────────────────────────── */
const OH = (() => {
  const LOG_PREFIX     = "🦄 Origami Helper";
  const MEETING_PREFIX = "🏠 MEETING";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log   = (...a) => console.log(LOG_PREFIX + ":", ...a);
  const warn  = (...a) => console.warn(LOG_PREFIX + ":", ...a);
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
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "undefined" || t === "null") return empty;
      return v;
    }
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
        if (preferSelect2Text && data.length) {
          const d0 = data[0] || {};
          raw = sanitizeValue(d0.text || d0.id, { empty: "" });
        } else {
          raw = sanitizeValue($e.val(), { empty: "" });
        }
      } catch (e) { raw = sanitizeValue(el.value, { empty: "" }); }
    } else if (tag === "input" || tag === "select" || tag === "textarea") {
      raw = sanitizeValue(el.value, { empty: "" });
    } else {
      raw = sanitizeValue(el.value || el.textContent || "", { empty: "" });
    }
    return { found: true, raw, norm: String(raw || "").trim(), el };
  }

  async function waitForField(fieldName, { timeoutMs = 7000, pollMs = 200, requireValue = false } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const r = getDomValue(fieldName);
      if (r.found && (!requireValue || r.norm)) return r;
      await sleep(pollMs);
    }
    return { found: false, raw: "", norm: "", el: null, timeout: true };
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
    const safeId   = sanitizeValue(id,   { empty: "" });
    const safeText = sanitizeValue(text, { empty: "" });
    if (!safeId && !safeText) {
      if (!allowEmpty) return setBasicValue(fieldName, mode === "jsonArray" ? "[]" : "");
    }
    let payload = "";
    if (mode === "jsonArray") {
      payload = JSON.stringify([safeId, safeText].filter(x => x !== ""));
      if (!payload) payload = "[]";
    } else {
      payload = safeId || safeText || "";
    }
    el.value = payload;
    if (hasJQ() && isSelect2El(el)) {
      try { window.$(el).trigger("change"); }
      catch (e) { el.dispatchEvent(new Event("change", { bubbles: true })); }
    } else {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function debounce(fn, delayMs = 250) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delayMs); };
  }

  // URL prefill parser — format `?fields=fld_X:val,fld_Y:val` (values URL-encoded).
  function parseUrlPrefill() {
    const map = {};
    try {
      const u = new URL(window.location.href);
      const f = u.searchParams.get("fields");
      if (!f) return map;
      for (const pair of f.split(",")) {
        const i = pair.indexOf(":");
        if (i < 0) continue;
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1);
        if (k) map[k] = v;
      }
    } catch (e) { warn("parseUrlPrefill error:", e); }
    return map;
  }

  // simple_lookup — calls the simple_lookup branch of scenario 8060598 to fetch a record
  async function simpleLookup(entityId, recordId, lookupUrl) {
    try {
      const res = await fetch(lookupUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: "simple_lookup", entity_id: entityId, record_id: recordId }),
      });
      return await res.json();
    } catch (e) { warn("simpleLookup error:", e); return null; }
  }

  /** =========================
   *  Meeting logic — section 07
   *  ========================= */
  const Meeting = (() => {
    const C = MEETING_CFG;

    let urlPrefill = {};
    let lastAutoWritten = null;
    let pensionAddressCache = null;  // resolved once per form load via simpleLookup
    let lastLinkedAddress = null;    // cached address of the currently-linked lead/client (for re-apply on fld_1369 switch)
    const prefilledFields = new Set(); // fields we've already auto-filled from URL
    const processedLinkedRecords = new Set();  // pickerField|recordId pairs we already resolved — prevents loop

    function extractFieldValue(rec, fieldDataName) {
      if (!rec || !fieldDataName) return "";
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        if (v && typeof v === "object" && !Array.isArray(v) && v[fieldDataName] !== undefined) {
          return sanitizeValue(v[fieldDataName], { empty: "" });
        }
      }
      if (rec[fieldDataName] !== undefined) return sanitizeValue(rec[fieldDataName], { empty: "" });
      for (const g of rec.field_groups || []) {
        for (const row of g?.fields_data || []) {
          for (const f of row || []) {
            if (f?.field_data_name === fieldDataName) return sanitizeValue(f.value, { empty: "" });
          }
        }
      }
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

    function norm(s) {
      return String(s || "").normalize("NFC").trim().replace(/\s+/g, " ");
    }

    function isPensionContext() {
      const subtype = norm(getDomValue(C.subtypeField).norm);
      const sub2    = norm(getDomValue(C.sub2Field).norm);
      const meetingFor = norm(getDomValue(C.meetingForField).norm);
      if (meetingFor === norm("עובד")) return true;
      if (C.pensionSubtypes.some(s => norm(s) === subtype)) return true;
      if (norm(C.pensionSub2) === sub2) {
        const sub2El = document.querySelector('[name="' + C.sub2Field + '"]');
        const wrap   = sub2El ? sub2El.closest(".form_data_element_wrap") : null;
        const visible = wrap
          ? (!wrap.classList.contains("hidden") && !wrap.classList.contains("ng-hide") && wrap.offsetParent !== null)
          : false;
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

    async function applyAddressIfPension() {
      if (!isPensionContext()) return;
      if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
      const addr = await fetchPensionAddress();
      if (!addr) { mwarn("⚠️ pension address resolved empty — skipping"); return; }
      mlog("📍 writing pension address:", addr);
      setBasicValue(C.addressField, addr);
      lastAutoWritten = addr;
    }

    async function applyAddressFromLinkedRecord(pickerFieldName, rawValue) {
      const map = C.entityAddressMap[pickerFieldName];
      if (!map) return;
      if (isPensionContext()) return;
      if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
      if (!map.addressField) {
        const addr = await fetchPensionAddress();
        if (!addr) return;
        mlog("📍 employee meeting → pension:", addr);
        setBasicValue(C.addressField, addr);
        lastAutoWritten = addr;
        return;
      }
      let recordId = "";
      const v = String(rawValue || "").trim();
      if (!v) return;
      if (v.startsWith("[")) {
        const arr = safeJsonParse(v, null);
        if (Array.isArray(arr) && arr[0]) recordId = String(arr[0]);
      } else {
        recordId = v;
      }
      if (!recordId) return;
      const dedupeKey = pickerFieldName + "|" + recordId;
      if (processedLinkedRecords.has(dedupeKey)) return;
      processedLinkedRecords.add(dedupeKey);
      mlog("🔎 lookup", map.entityName, recordId);
      const r = await simpleLookup(map.entityName, recordId, C.lookupUrl);
      const rec = r?.data?.[0] || r?.data || r;
      if (map.nameField) {
        const displayName = String(extractFieldValue(rec, map.nameField) || "").trim();
        if (displayName) {
          setSelect2Value(pickerFieldName, { id: recordId, text: displayName }, { mode: C.select2WriteMode });
          mlog("👤 picker display →", pickerFieldName, "=", displayName);
        }
      }
      const addr = String(extractFieldValue(rec, map.addressField) || "").trim();
      if (!addr) { mwarn("⚠️ no address on record", recordId); return; }
      lastLinkedAddress = addr;
      if (isPensionContext()) { mlog("🏠 pension context active — caching linked addr but not writing"); return; }
      if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving"); return; }
      mlog("📍 writing linked-record address:", addr);
      setBasicValue(C.addressField, addr);
      lastAutoWritten = addr;
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

    const resolvedNamePickers = new Set();
    async function resolveNamePicker(pickerField, rawValue) {
      const map = C.namePickerMap[pickerField];
      if (!map) return;
      let id = "";
      const v = String(rawValue || "").trim();
      if (!v) return;
      if (v.startsWith("[")) { const a = safeJsonParse(v, null); if (Array.isArray(a) && a[0]) id = String(a[0]); }
      else id = v;
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
      if (isLookup) {
        setSelect2Value(name, { id: val, text: val }, { mode: C.select2WriteMode });
      } else {
        setBasicValue(name, val);
      }
      prefilledFields.add(name);
      mlog("⤵️ prefilled", name, "=", val);
      if (C.namePickerMap[name]) resolveNamePicker(name, val);
    }

    function watchDynamicFields() {
      const scan = () => {
        const inputs = document.querySelectorAll('input[name^="fld_"], select[name^="fld_"], textarea[name^="fld_"]');
        for (const el of inputs) if (el.name) fillFromUrlIfPossible(el.name);
      };
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

      const TEAM_SUBTYPES_FILL_INVITED = new Set(["פורום צוות", "שיחת שימוע", "שיחה אישית"]);
      function tryFillInvitedEmployees() {
        const subtypeEl = document.querySelector('[name="' + C.subtypeField + '"]');
        const subtype = norm(subtypeEl ? subtypeEl.value : "");
        if (!TEAM_SUBTYPES_FILL_INVITED.has(subtype)) return;
        const empEl = document.querySelector('[name="' + C.employeeField + '"]');
        const empRaw = empEl ? empEl.value : "";
        if (!empRaw) return;
        let id = "", text = "";
        const v = String(empRaw).trim();
        if (v.startsWith("[")) { const arr = safeJsonParse(v, null); if (Array.isArray(arr)) { id = arr[0] || ""; text = arr[1] || ""; } }
        else { id = v; }
        if (!id) return;
        const curEl = document.querySelector('[name="fld_1771"]');
        const curStr = String((curEl ? curEl.value : "") || "").trim();
        const curIds = curStr ? curStr.split(",").map(s => s.trim()).filter(Boolean) : [];
        if (curIds.includes(id)) return;
        curIds.push(id);
        const payload = curIds.join(",");
        const el = curEl;
        if (!el) return;
        el.value = payload;
        if (typeof window.$ === "function") {
          try { window.$(el).trigger("change"); } catch (e) { el.dispatchEvent(new Event("change", {bubbles:true})); }
        } else {
          el.dispatchEvent(new Event("change", {bubbles:true}));
        }
        mlog("👥 auto-filled fld_1771 (עובדים להזמנה) with trigger employee:", id);
      }
      const debouncedFillInvited = debounce(tryFillInvitedEmployees, C.applyDebounceMs);

      const handler = (e) => {
        const t = e.target;
        if (!t || !t.name || !t.name.startsWith("fld_")) return;
        if (t.name === C.subtypeField || t.name === C.sub2Field || t.name === C.meetingForField) debouncedApply();
        if (C.entityAddressMap[t.name]) debouncedLinked(t.name, t.value);
        if (t.name === C.subtypeField || t.name === C.employeeField) debouncedFillInvited();
      };
      document.addEventListener("change", handler, true);
      document.addEventListener("input",  handler, true);

      if (typeof window.$ === "function") {
        try {
          window.$(document).on("change", "select[name^='fld_']", function(e) {
            handler({ target: this });
          });
          mlog("✅ jQuery change listener attached (Select2 compat)");
        } catch (e) { mwarn("could not attach jQuery listener:", e); }
      }

      watchDynamicFields();
      fetchPensionAddress().catch(e => warn("pension fetch warm-up error:", e));
      setTimeout(applyAddressForContext, 300);
      setTimeout(tryFillInvitedEmployees, 1500);

      // BUG FIX 2026-06-01 (fifth pass — NATIVE TRIGGER): Origami's bundle (lines 25184-25190)
      // already contains the lookup+chip logic — it calls userService.emitCaptchaLookup() when
      // scope.scopeData.value is a STRING (bare id). URL prefill writes only to el.value (DOM),
      // not to the Angular scope, so the native init code sees scopeData.value = [] and skips.
      // Solution: write the bare id to scopeData.value + $apply() → native handler kicks in.
      function triggerNativeMultiSelectFill(fieldName) {
        try {
          const el = document.querySelector('[name="' + fieldName + '"]');
          if (!el || typeof window.angular !== "function") return false;
          const $el = window.angular.element(el);
          const scope = $el.scope() || $el.isolateScope();
          if (!scope || !scope.scopeData) return false;
          const raw = String(el.value || "").trim();
          if (!raw) return false;
          if (typeof scope.scopeData.value === "object" && scope.scopeData.value && scope.scopeData.value.length > 0) return false;
          scope.scopeData.value = raw;
          const apply = (scope.$apply ? scope.$apply.bind(scope) : (scope.$root && scope.$root.$apply ? scope.$root.$apply.bind(scope.$root) : null)) || (() => {});
          apply();
          mlog("🎯 native multi-fill triggered for", fieldName, "with", raw);
          return true;
        } catch (e) { mwarn("triggerNativeMultiSelectFill error for " + fieldName + ":", e.message); return false; }
      }
      let nativeAttempts = 0;
      const nativeInterval = setInterval(() => {
        nativeAttempts++;
        const ok = triggerNativeMultiSelectFill("fld_1771");
        if (ok || nativeAttempts >= 6) clearInterval(nativeInterval);
      }, 800);
    }

    return { bindMeetingListeners, applyAddressIfPension };
  })();

  return {
    log, warn, safeJsonParse, sanitizeValue,
    getDomValue, waitForField, setBasicValue, setSelect2Value, debounce,
    parseUrlPrefill, simpleLookup,
    Meeting,
  };
})();

// ── Bootstrap ──
OH.Meeting.bindMeetingListeners();

// ── Backwards-compat globals — used by inline scripts in some Origami forms ──
function applyContact(id, text) {
  OH.setSelect2Value(MEETING_CFG.clientField, { id, text }, { mode: MEETING_CFG.select2WriteMode });
}
function applyCustomerType(valueTextOrId) {
  OH.setBasicValue(MEETING_CFG.meetingForField, valueTextOrId);
}
