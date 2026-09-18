/* ===== 提示词库交互层 =====
   数据分层：data/index.js（window.PIDX 轻索引：列表/筛选/搜索用）
             data/cats.js（window.PCATS 分类→分片码）
             data/p/<码>.js（window.PCHUNK 正文：详情、复制、做同款时按需注入）
   生图：PP_API 代理，密钥在服务端，前端只发 {prompt}
   页面：#view-prompts 列表 / #view-same 做同款页；hash #p<id> 详情、#same<id> 做同款 */
(function () {
  var IDX = window.PIDX || [];
  var PP_API = "https://zzmeq5c4.qwenwork.host";
  var GZH = "马银成企业咨询";
  var FAV_KEY = "zhifu_fav_prompts", COOL_KEY = "zhifu_pp_next", WORK_KEY = "zhifu_works";
  var COOL_SEC = 60, CHUNK = 60;
  var body = {}, loaded = {}, genCache = {}, coolTimer = null;

  var SRC_NAME = { gpt: "GPT Image 2 精选", nb: "Nano Banana 玩法", g4o: "GPT-4o 图像提示词集", bq: "Banana Quicker", evo: "EvoLink GPT Image 2" };
  var SYN = { "海报": ["poster", "传单", "banner"], "信息图": ["infographic", "图表", "图解"], "头像": ["portrait", "肖像"], "电商": ["shop", "产品", "主图"], "漫画": ["comic", "动漫", "anime"], "界面": ["ui", "app", "网页"] };
  var st = { q: "", src: "", cat: "", style: "", scene: "", feat: false, fav: false, sort: "rank", shown: CHUNK };

  var grid = document.getElementById("pp-grid"), filters = document.getElementById("pp-filters");
  var bar = document.getElementById("pp-count"), input = document.getElementById("pp-q");
  var mask = document.getElementById("detail-mask"), box = document.getElementById("detail-box");
  var toastEl = document.getElementById("pp-toast");
  var favs;
  try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch (e) { favs = new Set(); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m) {
    if (!toastEl) return;
    toastEl.textContent = m; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }
  function byId(id) { for (var i = 0; i < IDX.length; i++) if (IDX[i].id === id) return IDX[i]; return null; }
  window.ppImgFallback = function (img) { var f = img.dataset.fb; if (!f) return; img.dataset.fb = ""; img.src = f; };

  /* 埋点：搜索词 / 复制 / 做同款。失败静默，绝不影响主流程 */
  function logEvent(e, v) {
    try {
      var u = PP_API + "/log?e=" + encodeURIComponent(e) + "&v=" + encodeURIComponent(v || "");
      if (navigator.sendBeacon) navigator.sendBeacon(u); else new Image().src = u;
    } catch (x) { }
  }

  /* 按需注入正文分片 */
  function ensureBody(rec, cb) {
    if (!rec) return cb(null);
    if (body[rec.id]) return cb(body[rec.id]);
    function take() {
      (window.PCHUNK || []).forEach(function (b) { body[b.id] = b; });
      window.PCHUNK = null;
      cb(body[rec.id] || null);
    }
    if (loaded[rec.c]) return take();
    var s = document.createElement("script");
    s.src = "data/p/" + rec.c + ".js";
    s.onload = function () { loaded[rec.c] = 1; take(); };
    s.onerror = function () { toast("正文加载失败，请重试"); cb(null); };
    document.head.appendChild(s);
  }

  /* 搜索：中文二元切分 + 同义词扩展 + 标题三倍权重 */
  function tokens(s) {
    s = String(s).toLowerCase();
    var out = [], lat = s.match(/[a-z0-9]+/g) || [], cjk = s.match(/[一-龥]+/g) || [];
    lat.forEach(function (w) { out.push(w); });
    cjk.forEach(function (run) {
      out.push(run);
      for (var i = 0; i + 1 < run.length; i++) out.push(run.substr(i, 2));
    });
    return out;
  }
  function expand(q) {
    var out = tokens(q);
    Object.keys(SYN).forEach(function (k) {
      if (q.indexOf(k) >= 0) SYN[k].forEach(function (x) { out.push(x.toLowerCase()); });
    });
    return out;
  }
  function score(r, toks) {
    if (!toks.length) return 1;
    var t = r.t.toLowerCase(), d = (r.dp || "").toLowerCase(), hit = 0;
    for (var i = 0; i < toks.length; i++) {
      var k = toks[i];
      if (t.indexOf(k) >= 0) hit += 3;
      else if (d.indexOf(k) >= 0) hit += 1;
    }
    return hit / (toks.length * 3);
  }

  /* 分面计数：每个候选值统计「除该维度外其余条件都满足」的条数 */
  function match(r, skip) {
    if (skip !== "src" && st.src && r.src !== st.src) return false;
    if (skip !== "cat" && st.cat && r.cn !== st.cat) return false;
    if (skip !== "style" && st.style && (r.s || []).indexOf(st.style) < 0) return false;
    if (skip !== "scene" && st.scene && (r.sc || []).indexOf(st.scene) < 0) return false;
    if (skip !== "feat" && st.feat && !r.f) return false;
    if (skip !== "fav" && st.fav && !favs.has(r.id)) return false;
    return true;
  }
  function filtered() {
    var toks = expand(st.q), out = [];
    IDX.forEach(function (r) {
      if (!match(r, null)) return;
      var s = score(r, toks);
      if (toks.length && s <= 0) return;
      r._s = s; out.push(r);
    });
    if (st.sort === "new") out.sort(function (a, b) { return b.id - a.id; });
    else if (st.sort === "title") out.sort(function (a, b) { return a.t.localeCompare(b.t, "zh"); });
    else out.sort(function (a, b) { return (b.f - a.f) || (toks.length ? b._s - a._s : a.id - b.id); });
    return out;
  }
  function facet(field, key, isList) {
    var m = {};
    IDX.forEach(function (r) {
      if (!match(r, field)) return;
      (isList ? (r[key] || []) : [r[key]]).forEach(function (x) { if (x) m[x] = (m[x] || 0) + 1; });
    });
    return m;
  }
  function frow(label, field, map) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
    if (!keys.length) return "";
    var all = IDX.filter(function (r) { return match(r, field); }).length;
    var h = '<div class="pp-frow"><span class="pp-flabel">' + label + '</span><div class="pp-fchips">' +
      '<button class="pp-chip' + (st[field] ? "" : " on") + '" data-f="' + field + '" data-v="">全部 <i>' + all + "</i></button>";
    keys.forEach(function (k) {
      h += '<button class="pp-chip' + (st[field] === k ? " on" : "") + '" data-f="' + field + '" data-v="' + esc(k) + '">' +
        esc(field === "src" ? (SRC_NAME[k] || k) : k) + " <i>" + map[k] + "</i></button>";
    });
    return h + "</div></div>";
  }
  function renderFilters() {
    var base = filtered().length;
    filters.innerHTML = frow("来源库", "src", facet("src", "src")) + frow("使用场景", "cat", facet("cat", "cn")) +
      frow("视觉风格", "style", facet("style", "s", true)) + frow("题材", "scene", facet("scene", "sc", true)) +
      '<div class="pp-frow"><span class="pp-flabel">快捷</span><div class="pp-fchips">' +
      '<button class="pp-chip' + (st.feat ? " on" : "") + '" data-t="feat">&#11088; 只看精选</button>' +
      '<button class="pp-chip' + (st.fav ? " on fav" : "") + '" data-t="fav">&#9829; 我的收藏 ' + favs.size + "</button>" +
      '<span class="pp-sortwrap">排序</span>' +
      ["rank:推荐", "new:最新", "title:标题"].map(function (s) {
        var p = s.split(":");
        return '<button class="pp-chip' + (st.sort === p[0] ? " on" : "") + '" data-sort="' + p[0] + '">' + p[1] + "</button>";
      }).join("") + "</div></div>";
    bar.innerHTML = "当前 <b>" + base + "</b> 条 / 全库 " + IDX.length + " 条" +
      (base !== IDX.length ? ' <button class="pp-clear" data-clear>清空筛选</button>' : "");
  }
  function renderGrid() {
    var rows = filtered();
    st.shown = Math.max(CHUNK, Math.min(st.shown, rows.length));
    var slice = rows.slice(0, st.shown), frag = document.createDocumentFragment();
    slice.forEach(function (r) {
      var d = document.createElement("div");
      d.className = "pp-card glass"; d.dataset.id = r.id;
      d.innerHTML = (r.f ? '<span class="pp-flag">精选</span>' : "") +
        '<button class="pp-same" data-same="' + r.id + '" title="一键做同款">&#9889;</button>' +
        '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" data-fav="' + r.id + '" title="收藏">&#9733;</button>' +
        '<img class="pp-thumb" loading="lazy" decoding="async" src="img/' + esc(r.im) + '" alt="' + esc(r.t) + '">' +
        '<div class="pp-body"><div class="pp-title">' + esc(r.t) + '</div><div class="pp-desc">' + esc(r.dp) + "…</div>" +
        '<div class="pp-tags"><i class="src">' + esc(SRC_NAME[r.src] || r.src) + "</i>" +
        (r.s || []).slice(0, 2).map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") +
        (r.sc || []).slice(0, 1).map(function (x) { return '<i class="scene">' + esc(x) + "</i>"; }).join("") +
        "</div></div>";
      frag.appendChild(d);
    });
    grid.innerHTML = "";
    grid.appendChild(frag);
    if (!slice.length) grid.innerHTML = '<div class="pp-empty">没有匹配的提示词，换个关键词或清空筛选试试。</div>';
    requestAnimationFrame(function () {
      grid.querySelectorAll(".pp-card:not(.vis)").forEach(function (el, i) {
        el.style.transitionDelay = (i % 8) * 0.04 + "s"; el.classList.add("vis");
      });
    });
    var more = document.getElementById("pp-more");
    if (more) more.style.display = rows.length > st.shown ? "block" : "none";
    if (st.q) logEvent("search", st.q);
  }
  function refresh() { renderFilters(); renderGrid(); }

  function showPage(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("show", v.id === "view-" + name); });
    document.querySelectorAll(".nav-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name || (name === "same" && t.dataset.view === "prompts"));
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function markVars(s) { return esc(s).replace(/\[([A-Z][A-Z \/][^\]\n]{0,28})\]/g, '<span class="pp-var">[$1]</span>'); }
  function leadHtml() {
    return '<div class="pp-lead">想要整理好的分类提示词包？关注公众号 <b>' + GZH + '</b>，回复「提示词」拿离线版 + 每周新增</div>';
  }

  /* ---- 详情弹层 ---- */
  function openDetail(id) {
    var r = byId(id); if (!r) return;
    ensureBody(r, function (b) {
      if (!b) return;
      box.innerHTML = '<button class="detail-close" data-close>&#10005;</button>' +
        '<span class="d-tag">' + esc(r.cn) + "</span>" +
        '<div class="pp-d-head"><h2>' + esc(r.t) + "</h2>" +
        '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" style="position:static;opacity:1;border:1px solid rgba(0,0,0,.08)" data-fav="' + r.id + '">&#9733; 收藏</button></div>' +
        '<div class="pp-d-grid"><div><img class="pp-d-img" src="' + esc(b.img) + '" data-fb="' + esc(b.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '" loading="lazy">' +
        (b.in ? '<img class="pp-d-img pp-d-in" src="' + esc(b.in) + '" alt="输入图" loading="lazy"><div class="pp-d-meta">↑ 图生图玩法：原效果是拿这张输入图做的；只做文生图会更接近风格而非同一主体</div>' : "") +
        '<div class="pp-d-meta">编号 #' + r.id + " · " + esc(SRC_NAME[r.src] || r.src) +
        (b.su ? ' · 出处 <a href="' + esc(b.su) + '" target="_blank" rel="noopener nofollow">' + esc(b.sl || "原帖") + "</a>" : "") + "</div></div>" +
        '<div><div class="pp-plabel">提示词（' + b.p.length + ' 字符）</div><div class="pp-prompt">' + markVars(b.p) + "</div>" +
        '<div class="pp-actions"><button class="pp-btn pri" data-copy="' + r.id + '">&#128203; 复制提示词</button>' +
        '<button class="pp-btn gho" data-goto="' + r.id + '">&#9889; 做同款看对比</button></div></div></div>' + leadHtml();
      mask.classList.add("show");
      document.body.style.overflow = "hidden";
      if (history.replaceState) history.replaceState(null, "", "#p" + r.id);
    });
  }
  function closeDetail() {
    mask.classList.remove("show");
    document.body.style.overflow = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  }
  function copyPrompt(id) {
    var r = byId(id); if (!r) return;
    ensureBody(r, function (b) {
      if (!b) return;
      logEvent("copy", r.id);
      var done = function () { toast("提示词已复制，直接粘到即梦 / 可灵 / GPT Image 就能用"); };
      function fb() {
        var ta = document.createElement("textarea");
        ta.value = b.p; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中"); }
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.p).then(done, fb); else fb();
    });
  }
  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favs)));
    document.querySelectorAll('[data-fav="' + id + '"]').forEach(function (n) { n.classList.toggle("on", favs.has(id)); });
    renderFilters(); renderGrid();
    if (favs.size === 5) toast("已收藏 5 条：收藏只存在本机浏览器，换设备会丢 —— 关注公众号 " + GZH + " 可拿离线包");
  }

  /* ---- 冷却与作品 ---- */
  function remain() { return Math.max(0, Math.ceil(((+localStorage.getItem(COOL_KEY) || 0) - Date.now()) / 1000)); }
  function startCooldown(sec) { localStorage.setItem(COOL_KEY, String(Date.now() + sec * 1000)); tickCool(); }
  function tickCool() {
    var left = remain();
    document.querySelectorAll("[data-gen]").forEach(function (n) {
      n.disabled = left > 0;
      n.innerHTML = left > 0 ? "&#9203; " + left + " 秒后可再做" : "&#9889; 重新生成一张";
    });
    if (left > 0 && !coolTimer) coolTimer = setInterval(function () { tickCool(); if (remain() <= 0) { clearInterval(coolTimer); coolTimer = null; } }, 1000);
  }
  function works() { try { return JSON.parse(localStorage.getItem(WORK_KEY) || "[]"); } catch (e) { return []; } }
  function saveWork(r, url, via) {
    var w = works().filter(function (x) { return x.id !== r.id; });
    w.unshift({ id: r.id, t: r.t, url: url, via: via, ts: Date.now() });
    localStorage.setItem(WORK_KEY, JSON.stringify(w.slice(0, 50)));
  }
  function worksHtml() {
    var w = works();
    if (!w.length) return "";
    return '<div class="ps-works"><div class="pp-plabel">我的生成记录（最近 ' + w.length + ' 张 · 上游直链约 7 天后失效）</div><div class="ps-works-grid">' +
      w.slice(0, 12).map(function (x) {
        return '<a class="ps-work" href="' + esc(x.url) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(x.url) + '" alt="' + esc(x.t) + '"><span>' + esc(x.t.slice(0, 14)) + "</span></a>";
      }).join("") + "</div></div>";
  }

  /* ---- 对比 ---- */
  function cmpHtml(r, b, url, via) {
    return '<div class="ps-cmp"><div class="ps-track" style="--pos:50%">' +
      '<img class="ps-base" src="' + esc(b.img) + '" data-fb="' + esc(b.oj) + '" onerror="ppImgFallback(this)" alt="原图">' +
      '<div class="ps-top"><img src="' + esc(url) + '" alt="AI 同款"></div>' +
      '<div class="ps-handle"></div><span class="ps-tag l">原图</span><span class="ps-tag r">AI 同款</span></div>' +
      '<div class="ps-foot">按住中间竖线左右拖动对比 · <a href="' + esc(url) + '" target="_blank" rel="noopener">下载 / 查看大图</a>' +
      (via ? " · 由 <b>" + esc(via) + "</b> 生成" : "") + "</div></div>";
  }
  function bindCmp(root) {
    (root || document).querySelectorAll(".ps-track").forEach(function (track) {
      var base = track.querySelector(".ps-base");
      if (base) {
        var fit = function () { if (base.naturalWidth) track.style.aspectRatio = base.naturalWidth + " / " + base.naturalHeight; };
        if (base.complete && base.naturalWidth) fit(); else base.addEventListener("load", fit);
      }
      function set(x) {
        var rect = track.getBoundingClientRect();
        track.style.setProperty("--pos", Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)) + "%");
      }
      track.addEventListener("pointerdown", function (e) {
        e.preventDefault(); set(e.clientX);
        var mv = function (ev) { set(ev.clientX); };
        var up = function () { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
      });
    });
  }

  function gen(r, force) {
    var out = document.getElementById("ps-out");
    if (!out) return;
    ensureBody(r, function (b) {
      if (!b) return;
      var g = genCache[r.id];
      if (g && !force) { out.innerHTML = cmpHtml(r, b, g.url, g.via) + worksHtml(); bindCmp(out); tickCool(); return; }
      if (remain() > 0) {
        out.innerHTML = '<div class="ps-note">免费通道每分钟只跑一张，<b>' + remain() + "</b> 秒后自动继续…</div>";
        setTimeout(function () { gen(r, true); }, Math.min(remain() * 1000 + 400, 61000));
        return;
      }
      out.innerHTML = '<div class="ps-note"><span class="ps-spin"></span>正在让智谱 CogView 出图，通常 10-40 秒…</div>';
      startCooldown(COOL_SEC);
      logEvent("same", r.id);
      fetch(PP_API + "/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: b.p }) })
        .then(function (res) { return res.json().catch(function () { return { error: "代理返回异常 HTTP " + res.status }; }); })
        .then(function (d) {
          if (d.url) {
            genCache[r.id] = { url: d.url, via: d.via };
            saveWork(r, d.url, d.via);
            out.innerHTML = cmpHtml(r, b, d.url, d.via) + worksHtml();
            bindCmp(out);
            var cmp = out.querySelector(".ps-cmp");
            if (cmp && cmp.scrollIntoView) cmp.scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (d.retryAfter) {
            startCooldown(d.retryAfter);
            out.innerHTML = '<div class="ps-note">免费通道每分钟只跑一张，<b>' + d.retryAfter + "</b> 秒后自动继续…</div>";
            setTimeout(function () { gen(r, true); }, d.retryAfter * 1000 + 400);
          } else {
            out.innerHTML = '<div class="ps-note ps-bad">失败：' + esc(d.error || "未知错误") +
              (d.tried && d.tried.length ? "<br>通道轨迹：" + esc(d.tried.join(" | ")) : "") + "</div>";
          }
          tickCool();
        })
        .catch(function (e) { out.innerHTML = '<div class="ps-note ps-bad">连不上生图服务：' + esc(e.message) + "</div>"; tickCool(); });
    });
  }

  function openSame(id) {
    var r = byId(id); if (!r) return;
    closeDetail(); showPage("same");
    if (history.replaceState) history.replaceState(null, "", "#same" + r.id);
    ensureBody(r, function (b) {
      if (!b) return;
      document.getElementById("ps-body").innerHTML =
        '<button class="ps-back" id="ps-back">&#8592; 返回提示词库</button>' +
        '<h1 class="ps-h1">' + esc(r.t) + "</h1>" +
        '<div class="ps-meta">' + esc(r.cn) + " · " + esc(SRC_NAME[r.src] || r.src) +
        (b.su ? ' · 出处 <a href="' + esc(b.su) + '" target="_blank" rel="noopener nofollow">' + esc(b.sl || "原帖") + "</a>" : "") + "</div>" +
        '<div class="ps-prompt">' + markVars(b.p) + "</div>" +
        '<div class="ps-acts"><button class="pp-btn pri" data-copy="' + r.id + '">&#128203; 复制提示词</button>' +
        '<button class="pp-btn gho" data-gen="' + r.id + '">&#9889; 重新生成一张</button></div>' +
        '<div id="ps-out"></div>' + leadHtml() + worksHtml();
      document.getElementById("ps-back").onclick = function () {
        showPage("prompts");
        if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
      };
      gen(r);
    });
  }

  /* ---- 事件绑定 ---- */
  filters.addEventListener("click", function (e) {
    var c = e.target.closest(".pp-chip"); if (!c) return;
    if (c.dataset.f) st[c.dataset.f] = st[c.dataset.f] === c.dataset.v ? "" : c.dataset.v;
    else if (c.dataset.t) st[c.dataset.t] = !st[c.dataset.t];
    else if (c.dataset.sort) st.sort = c.dataset.sort;
    else return;
    st.shown = CHUNK; refresh();
  });
  bar.addEventListener("click", function (e) {
    if (!e.target.closest("[data-clear]")) return;
    st.q = ""; input.value = ""; st.src = st.cat = st.style = st.scene = ""; st.feat = st.fav = false; st.shown = CHUNK;
    refresh();
  });
  input.addEventListener("input", function () { st.q = input.value; st.shown = CHUNK; refresh(); });
  grid.addEventListener("click", function (e) {
    var f = e.target.closest("[data-fav]");
    if (f) { e.stopPropagation(); toggleFav(+f.dataset.fav); return; }
    var s = e.target.closest("[data-same]");
    if (s) { e.stopPropagation(); openSame(+s.dataset.same); return; }
    var c = e.target.closest(".pp-card");
    if (c) openDetail(+c.dataset.id);
  });
  function anywhere(e) {
    var cp = e.target.closest("[data-copy]"); if (cp) { copyPrompt(+cp.dataset.copy); return true; }
    var gt = e.target.closest("[data-goto]"); if (gt) { openSame(+gt.dataset.goto); return true; }
    var gn = e.target.closest("[data-gen]"); if (gn) { gen(byId(+gn.dataset.gen), true); return true; }
    var fv = e.target.closest("[data-fav]"); if (fv) { toggleFav(+fv.dataset.fav); return true; }
    return false;
  }
  mask.addEventListener("click", function (e) {
    if (e.target === mask || e.target.closest("[data-close]")) { closeDetail(); return; }
    anywhere(e);
  });
  document.getElementById("view-same").addEventListener("click", anywhere);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && mask.classList.contains("show")) closeDetail(); });
  document.getElementById("pp-more").onclick = function () { st.shown += CHUNK; renderGrid(); };

  /* ---- 启动 ---- */
  document.querySelectorAll("[data-total]").forEach(function (el) { el.textContent = IDX.length; });
  refresh();
  tickCool();

  var m = location.hash.match(/^#p(\d+)$/);
  if (m) openDetail(+m[1]);
  else {
    var s2 = location.hash.match(/^#same(\d+)$/);
    if (s2) openSame(+s2[1]);
    else {
      var obs = new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; }) && st.shown < filtered().length) { st.shown += CHUNK; renderGrid(); }
      }, { rootMargin: "700px" });
      obs.observe(document.getElementById("pp-sentinel"));
    }
  }
})();
