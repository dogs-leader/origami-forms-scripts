/* Origami Helper — Meeting form */

const MEETING_CFG = {
  addressField: "fld_1162", subtypeField: "fld_1368", sub2Field: "fld_1369", meetingForField: "fld_1331",
  leadField: "fld_1069", clientField: "fld_1089", employeeField: "fld_1767",
  pensionAddress: "מושב מאור", pensionSubtypes: ["כניסה לפנסיון שהות", "יציאה מפנסיון שהות"], pensionSub2: "בפנסיון",
  entityAddressMap: {
    fld_1069: { entityName: "leads", addressField: "full_address", nameField: "fld_1647" },
    fld_1089: { entityName: "clients", addressField: "client_full_address", nameField: "fld_1470" },
    fld_1767: { entityName: "e_92", addressField: null, nameField: "fld_1567" },
  },
  namePickerMap: {
    fld_1619: { entityName: "e_92", nameField: "fld_1567" }, fld_1767: { entityName: "e_92", nameField: "fld_1567" },
    fld_1069: { entityName: "leads", nameField: "fld_1647" }, fld_1089: { entityName: "clients", nameField: "fld_1470" },
  },
  multiSelectNameMap: { "fld_1771": { entityName: "e_92", nameField: "fld_1567" } },
  lookupUrl: "https://hook.eu2.make.com/8mevgbj7owvu6sjj2dt4if6o9jenfpfj",
  pensionEntityId: "e_97", pensionRecordId: "6a16ff19c5f1b2ddda0d2aa2", pensionAddrFld: "fld_1786",
  applyDebounceMs: 200, scanDebounceMs: 80,
};

const OH = (() => {
  const P = "🏠 MEETING";
  const log = (...a) => console.log("🦄 Origami Helper:", ...a);
  const warn = (...a) => console.warn("🦄 Origami Helper:", ...a);
  const mlog = (...a) => console.log(P + ":", ...a);
  const mwarn = (...a) => console.warn(P + ":", ...a);
  function safeJsonParse(v, f = null) { try { if (v == null) return f; if (typeof v === "object") return v; const s = String(v).trim(); if (!s || s === "undefined" || s === "null") return f; return JSON.parse(s); } catch (e) { return f; } }
  function sanitizeValue(v, { empty = "" } = {}) { if (v == null) return empty; if (typeof v === "string") { const t = v.trim(); if (t === "undefined" || t === "null") return empty; return v; } return v; }
  const $el = (n) => document.querySelector(`[name="${n}"]`);
  const hasJQ = () => typeof window.$ === "function";
  const isSelect2El = (el) => !!(el && el.classList && el.classList.contains("select2-hidden-accessible"));
  function getDomValue(n) {
    const el = $el(n); if (!el) return { found: false, raw: "", norm: "" };
    let raw = "";
    if (hasJQ() && isSelect2El(el)) { try { const $e = window.$(el); const d = $e.select2("data") || []; raw = d.length ? sanitizeValue(d[0].text || d[0].id, { empty: "" }) : sanitizeValue($e.val(), { empty: "" }); } catch (e) { raw = sanitizeValue(el.value, { empty: "" }); } }
    else raw = sanitizeValue(el.value, { empty: "" });
    return { found: true, raw, norm: String(raw || "").trim(), el };
  }
  function setBasicValue(n, v) { const el = $el(n); if (!el) return false; el.value = sanitizeValue(v, { empty: "" }); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
  function setSelect2Value(n, { id, text }) {
    const el = $el(n); if (!el) return false;
    const sid = sanitizeValue(id, { empty: "" }), stx = sanitizeValue(text, { empty: "" });
    if (!sid && !stx) return setBasicValue(n, "[]");
    el.value = JSON.stringify([sid, stx].filter(x => x !== "")) || "[]";
    if (hasJQ() && isSelect2El(el)) { try { window.$(el).trigger("change"); } catch (e) { el.dispatchEvent(new Event("change", { bubbles: true })); } }
    else el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function debounce(fn, ms = 250) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function parseUrlPrefill() {
    const m = {};
    try { const u = new URL(window.location.href); const f = u.searchParams.get("fields"); if (!f) return m; for (const p of f.split(",")) { const i = p.indexOf(":"); if (i < 0) continue; const k = p.slice(0, i).trim(); const v = p.slice(i + 1); if (k) m[k] = v; } } catch (e) { warn("parseUrlPrefill error:", e); }
    return m;
  }
  async function simpleLookup(eId, rId, url) { try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "simple_lookup", entity_id: eId, record_id: rId }) }); return await r.json(); } catch (e) { warn("simpleLookup error:", e); return null; } }

  const Meeting = (() => {
    const C = MEETING_CFG;
    let urlPrefill = {}, lastAutoWritten = null, pensionAddressCache = null, lastLinkedAddress = null;
    const prefilledFields = new Set(), processedLinkedRecords = new Set();
    function extractFieldValue(rec, fn) { if (!rec || !fn) return ""; for (const k of Object.keys(rec)) { const v = rec[k]; if (v && typeof v === "object" && !Array.isArray(v) && v[fn] !== undefined) return sanitizeValue(v[fn], { empty: "" }); } if (rec[fn] !== undefined) return sanitizeValue(rec[fn], { empty: "" }); for (const g of rec.field_groups || []) for (const row of g?.fields_data || []) for (const f of row || []) if (f?.field_data_name === fn) return sanitizeValue(f.value, { empty: "" }); return ""; }
    async function fetchPensionAddress() {
      if (pensionAddressCache !== null) return pensionAddressCache;
      const r = await simpleLookup(C.pensionEntityId, C.pensionRecordId, C.lookupUrl);
      const rec = r?.data?.[0] || r?.data || r;
      let a = String(extractFieldValue(rec, C.pensionAddrFld) || "").trim();
      if (!a) { mwarn("⚠️ pension lookup empty, using fallback"); a = C.pensionAddress; }
      pensionAddressCache = a; mlog("📍 pension address resolved:", a); return a;
    }
    function norm(s) { return String(s || "").normalize("NFC").trim().replace(/\s+/g, " "); }
    function isPensionContext() {
      const st = norm(getDomValue(C.subtypeField).norm), s2 = norm(getDomValue(C.sub2Field).norm), mf = norm(getDomValue(C.meetingForField).norm);
      if (mf === norm("עובד")) return true;
      if (C.pensionSubtypes.some(s => norm(s) === st)) return true;
      if (norm(C.pensionSub2) === s2) {
        const el = document.querySelector('[name="' + C.sub2Field + '"]'); const w = el ? el.closest(".form_data_element_wrap") : null;
        const v = w ? (!w.classList.contains("hidden") && !w.classList.contains("ng-hide") && w.offsetParent !== null) : false;
        if (v) return true;
      }
      return false;
    }
    function shouldOverwriteAddress() {
      const cur = norm(getDomValue(C.addressField).norm); if (!cur) return true;
      if (lastAutoWritten && cur === norm(lastAutoWritten)) return true;
      if (urlPrefill[C.addressField] && cur === norm(urlPrefill[C.addressField])) return true;
      return false;
    }
    async function applyAddressForContext() {
      if (isPensionContext()) {
        if (!shouldOverwriteAddress()) { mlog("✋ address looks manual — preserving (pension)"); return; }
        const a = await fetchPensionAddress();
        if (a) { setBasicValue(C.addressField, a); lastAutoWritten = a; mlog("🏠 forced pension address on subtype change:", a); }
        return;
      }
      if (lastLinkedAddress) { if (!shouldOverwriteAddress()) return; setBasicValue(C.addressField, lastLinkedAddress); lastAutoWritten = lastLinkedAddress; }
    }
    async function applyAddressFromLinkedRecord(pfn, rv) {
      const map = C.entityAddressMap[pfn]; if (!map) return;
      if (isPensionContext()) return; if (!shouldOverwriteAddress()) return;
      if (!map.addressField) { const a = await fetchPensionAddress(); if (!a) return; setBasicValue(C.addressField, a); lastAutoWritten = a; return; }
      let rid = ""; const v = String(rv || "").trim(); if (!v) return;
      if (v.startsWith("[")) { const a = safeJsonParse(v, null); if (Array.isArray(a) && a[0]) rid = String(a[0]); } else rid = v;
      if (!rid) return;
      const k = pfn + "|" + rid; if (processedLinkedRecords.has(k)) return; processedLinkedRecords.add(k);
      const r = await simpleLookup(map.entityName, rid, C.lookupUrl); const rec = r?.data?.[0] || r?.data || r;
      if (map.nameField) { const dn = String(extractFieldValue(rec, map.nameField) || "").trim(); if (dn) setSelect2Value(pfn, { id: rid, text: dn }); }
      const ad = String(extractFieldValue(rec, map.addressField) || "").trim(); if (!ad) return;
      lastLinkedAddress = ad;
      if (isPensionContext()) return; if (!shouldOverwriteAddress()) return;
      setBasicValue(C.addressField, ad); lastAutoWritten = ad;
    }
    const resolvedNamePickers = new Set();
    async function resolveNamePicker(pf, rv) {
      const map = C.namePickerMap[pf]; if (!map) return;
      let id = ""; const v = String(rv || "").trim(); if (!v) return;
      if (v.startsWith("[")) { const a = safeJsonParse(v, null); if (Array.isArray(a) && a[0]) id = String(a[0]); } else id = v;
      if (!id) return;
      const k = pf + "|" + id; if (resolvedNamePickers.has(k)) return; resolvedNamePickers.add(k);
      const r = await simpleLookup(map.entityName, id, C.lookupUrl); const rec = r?.data?.[0] || r?.data || r;
      const n = String(extractFieldValue(rec, map.nameField) || "").trim();
      if (n) setSelect2Value(pf, { id, text: n });
    }
    function fillFromUrlIfPossible(n) {
      if (prefilledFields.has(n)) return;
      const val = urlPrefill[n]; if (val === undefined || val === "") return;
      const cur = getDomValue(n); if (!cur.found) return;
      if (cur.norm) { prefilledFields.add(n); return; }
      const isLookup = !!C.entityAddressMap[n] || !!C.namePickerMap[n] || isSelect2El(cur.el);
      if (isLookup) setSelect2Value(n, { id: val, text: val }); else setBasicValue(n, val);
      prefilledFields.add(n); mlog("⤵️ prefilled", n, "=", val);
      if (C.namePickerMap[n]) resolveNamePicker(n, val);
    }
    function watchDynamicFields() {
      const scan = () => { for (const el of document.querySelectorAll('input[name^="fld_"], select[name^="fld_"], textarea[name^="fld_"]')) if (el.name) fillFromUrlIfPossible(el.name); };
      scan();
      new MutationObserver(debounce(scan, C.scanDebounceMs)).observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    const resolvedMultiChips = new Set();
    async function waitForElement(sel, maxMs = 10000, intervalMs = 400) {
      const start = Date.now();
      while (Date.now() - start < maxMs) { const el = document.querySelector(sel); if (el) return el; await new Promise(r => setTimeout(r, intervalMs)); }
      return null;
    }
    async function resolveMultiSelectChip(target) {
      const map = C.multiSelectNameMap[target]; if (!map) return;
      const id = urlPrefill[target]; if (!id) return;
      const k = target + "|" + id; if (resolvedMultiChips.has(k)) return; resolvedMultiChips.add(k);
      const sel = `select[name="${target}[]"]`;
      const select = await waitForElement(sel, 10000, 400);
      if (!select) { mwarn("⚠️ " + target + ": select never appeared"); return; }
      mlog("👀 " + target + " select found");
      const r = await simpleLookup(map.entityName, id, C.lookupUrl); const rec = r?.data?.[0] || r?.data || r;
      const name = String(extractFieldValue(rec, map.nameField) || "").trim() || id;
      // 1. Ensure <option> exists in <select>
      if (!select.querySelector('option[value="' + id + '"]')) {
        const opt = document.createElement("option"); opt.value = id; opt.textContent = name; opt.selected = true;
        select.appendChild(opt);
      }
      // 2. Update scopeData via Angular if available (so Origami's submit logic picks up the value)
      try {
        const wrapper = select.closest("div.fld_1771") || select.closest("[scope-data]") || select.parentElement;
        if (window.angular && wrapper) {
          const scHolder = wrapper.querySelector('[scope-data="scopeData"]') || wrapper;
          const sc = window.angular.element(scHolder).isolateScope() || window.angular.element(scHolder).scope();
          if (sc && sc.scopeData) {
            sc.scopeData.value = [{ instance_id: id, text: name }];
            if (sc.$apply) sc.$apply();
            mlog("📝 scopeData.value updated for " + target);
          }
        }
      } catch (e) { mwarn("scope update failed:", e.message); }
      // 3. Inject the visual chip <li> directly into select2's choices ul
      // Standard Select2 v3 multi-chip HTML structure
      const container = select.parentElement.querySelector(".select2-container.select2-container-multi");
      if (container) {
        const ul = container.querySelector("ul.select2-choices");
        const searchLi = ul ? ul.querySelector("li.select2-search-field") : null;
        if (ul && searchLi && !ul.querySelector(`li.select2-search-choice[data-instance-id="${id}"]`)) {
          const chip = document.createElement("li");
          chip.className = "select2-search-choice";
          chip.setAttribute("data-instance-id", id);
          chip.innerHTML = `<div>${name.replace(/[<>&"']/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c]))}</div><a href="#" class="select2-search-choice-close" tabindex="-1"></a>`;
          ul.insertBefore(chip, searchLi);
          mlog("🎯 chip <li> injected into select2 choices ul");
        }
      } else {
        mwarn("no select2-container found near select");
      }
      // 4. Also fire change so any watcher cleans up
      if (typeof window.$ === "function") { try { window.$(select).trigger("change"); } catch (e) {} }
      mlog("👥 " + target + " chip resolved:", id, "→", name);
    }

    function bindMeetingListeners() {
      urlPrefill = parseUrlPrefill(); mlog("🔧 URL prefill:", urlPrefill);
      const debouncedApply = debounce(applyAddressForContext, C.applyDebounceMs);
      const debouncedLinked = debounce((n, v) => applyAddressFromLinkedRecord(n, v), C.applyDebounceMs);
      const handler = (e) => {
        const t = e.target; if (!t || !t.name || !t.name.startsWith("fld_")) return;
        if (t.name === C.subtypeField || t.name === C.sub2Field || t.name === C.meetingForField) debouncedApply();
        if (C.entityAddressMap[t.name]) debouncedLinked(t.name, t.value);
      };
      document.addEventListener("change", handler, true); document.addEventListener("input", handler, true);
      if (typeof window.$ === "function") {
        try { window.$(document).on("change", "select[name^='fld_']", function () { handler({ target: this }); }); mlog("✅ jQuery change listener attached (Select2 compat)"); }
        catch (e) { mwarn("could not attach jQuery listener:", e); }
      }
      watchDynamicFields();
      fetchPensionAddress().catch(e => warn("pension fetch warm-up error:", e));
      setTimeout(applyAddressForContext, 300);
      for (const fld of Object.keys(C.multiSelectNameMap)) {
        resolveMultiSelectChip(fld).catch(e => mwarn("resolveMultiSelectChip err:", e.message));
      }
    }
    return { bindMeetingListeners };
  })();
  return { log, warn, safeJsonParse, sanitizeValue, getDomValue, setBasicValue, setSelect2Value, debounce, parseUrlPrefill, simpleLookup, Meeting };
})();

OH.Meeting.bindMeetingListeners();
function applyContact(id, text) { OH.setSelect2Value(MEETING_CFG.clientField, { id, text }); }
function applyCustomerType(v) { OH.setBasicValue(MEETING_CFG.meetingForField, v); }
