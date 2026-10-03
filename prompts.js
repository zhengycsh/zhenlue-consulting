/* ===== 提示词库交互层 =====
   数据分层：data/index.js（window.PIDX 轻索引：列表/筛选/搜索用）
             data/cats.js（window.PCATS 分类→分片码）
             data/p/<码>.js（window.PCHUNK 正文：详情、复制、做同款时按需注入）
   生图：PP_API 代理，密钥在服务端，前端只发 {prompt}
   页面：#view-prompts 列表 / #view-same 做同款页；hash #p<id> 详情、#same<id> 做同款 */
(function () {
  var IDX = window.PIDX || [];
  var PP_APIS = [
    "https://flashing-interviews-vessel-varieties.trycloudflare.com",
    "https://zzmeq5c4.qwenwork.host"
  ];
  var PP_ACTIVE = 0;
  // 生成走 PP_APIS 降级链；/match /leaderboard /log 这类稳定接口固定用链尾的 QW Pages 域名（隧道地址会变）
  var PP_API = PP_APIS[PP_APIS.length - 1];
  // 页面由合并服务自己托管时（QW 镜像/本地预览）走同源；只有纯静态的 jackcats.xyz 才打远端代理
  var API_BASE = location.hostname === "jackcats.xyz" ? PP_API : "";
  var GATEWAY = API_BASE;   // 提示词改写走同一套服务（镜像同源、主站远端）
  function tryGenerate(i, payload) {
    if (i >= PP_APIS.length) return Promise.resolve({ error: "所有生图通道都不可用，请稍后再试" });
    return fetch(PP_APIS[i] + "/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().catch(function () { return { error: "代理返回异常 HTTP " + res.status }; }); },
            function () { return { error: "通道不可达" }; })
      .then(function (d) {
        if (d && d.url) { PP_ACTIVE = i; return d; }
        if (d && d.error && i + 1 < PP_APIS.length && (/不可达|异常|所有/.test(d.error) || /额度已用完/.test(d.error))) return tryGenerate(i + 1, payload);
        return d;
      });
  }
  var GZH = "香蕉学派";
  var ASSET_BASE = location.hostname === "jackcats.xyz" ? "img/" : "https://cdn.jsdelivr.net/gh/zhengycsh/zhenlue-consulting@main/img/";
  var FAV_KEY = "zhifu_fav_prompts", COOL_KEY = "zhifu_pp_next", WORK_KEY = "zhifu_works";
  var COOL_SEC = 60, CHUNK = 60;
  var body = {}, loaded = {}, genCache = {}, coolTimer = null;

  var SRC_NAME = { gpt: "GPT Image 2 精选", nb: "Nano Banana 玩法", g4o: "GPT-4o 图像提示词集", bq: "Banana Quicker", evo: "EvoLink GPT Image 2" };
  var BASE = "https://jackcats.xyz";
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
      var u = API_BASE + "/log?e=" + encodeURIComponent(e) + "&v=" + encodeURIComponent(v || "");
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
      (favs.size ? '<button class="pp-chip" data-exportfav>&#11015; 导出收藏</button>' : "") +
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
        '<img class="pp-thumb" loading="lazy" decoding="async" src="' + ASSET_BASE + esc(r.im) + '" alt="' + esc(r.t) + '">' +
        '<div class="pp-body"><div class="pp-title">' + esc(r.t) + '</div><div class="pp-desc">' + esc(r.dp) + "…</div>" +
        (r.ph && r.ph.length ? '<div class="pp-ph">改这' + Math.min(r.ph.length, 2) + '个词就是你的：' + r.ph.slice(0, 2).map(function (x) { return "<b>" + esc(x) + "</b>"; }).join(" / ") + "</div>" : "") +
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
        '<div class="pp-d-grid"><div><img class="pp-d-img" src="' + ASSET_BASE + esc(b.img) + '" data-fb="' + esc(b.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '" loading="lazy">' +
        (b.in ? '<img class="pp-d-img pp-d-in" src="' + ASSET_BASE + esc(b.in) + '" alt="输入图" loading="lazy"><div class="pp-d-meta">↑ 图生图玩法：原效果是拿这张输入图做的；只做文生图会更接近风格而非同一主体</div>' : "") +
        '<div class="pp-d-meta">编号 #' + r.id + " · " + esc(SRC_NAME[r.src] || r.src) +
        (b.su ? ' · 出处 <a href="' + esc(b.su) + '" target="_blank" rel="noopener nofollow">' + esc(b.sl || "原帖") + "</a>" : "") + "</div></div>" +
        '<div>' + (b.gd ? '<div class="pp-guide">' +
          '<div class="pp-g-row"><span>在干什么</span>' + esc(b.gd.what) + "</div>" +
          '<div class="pp-g-row"><span>改哪个词</span>' + esc(b.gd.swap) + "</div>" +
          '<div class="pp-g-row"><span>踩坑提醒</span>' + esc(b.gd.tip) + "</div></div>" : "") +
        (b.ph && b.ph.length ? '<div class="pp-phs">可替换：' + b.ph.map(function (x) { return "<b>" + esc(x) + "</b>"; }).join(" / ") + "</div>" : "") +
        '<div class="pp-plabel">提示词（' + b.p.length + ' 字符）</div><div class="pp-prompt">' + markVars(b.p) + "</div>" +
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
  /* ── 对比舞台：永远先有参考原图，生成中/失败都不塌版 ── */
  function stageHtml() {
    var r = ps.r, b = ps.b;
    if (!r || !b) return "";
    var base = '<img class="ps-base" src="' + imgOf(b.img) + '" data-fb="' + esc(b.oj) + '" onerror="ppImgFallback(this)" alt="参考原图">';
    var inner;
    if (ps.stage.url) {
      inner = base + '<div class="ps-top"><img src="' + esc(ps.stage.url) + '" alt="AI 生成"></div>' +
        '<div class="ps-handle"></div><span class="ps-tag l">原图</span><span class="ps-tag r">AI 生成</span>';
    } else {
      inner = base + '<span class="ps-tag l">参考原图</span>' +
        (ps.stage.busy ? '<div class="ps-busy"><span class="ps-spin"></span>正在生成，通常 10-40 秒…</div>' : "") +
        (!ps.stage.busy && ps.stage.err
          ? '<div class="ps-bad">失败：' + esc(ps.stage.err) + (ps.stage.tried ? "<br>通道轨迹：" + esc(ps.stage.tried) : "") +
            '<div class="ps-bad-act"><button class="pp-btn pri" data-retry>重试</button><button class="pp-btn gho" data-openref>看原图大图</button></div></div>'
          : (!ps.stage.busy ? '<div class="ps-idle">点上方「用这段生成」产出 AI 版本，这里会变成可拖动对比</div>' : ""));
    }
    var foot = ps.stage.url
      ? '按住竖线左右拖动对比 · <a href="' + esc(ps.stage.url) + '" target="_blank" rel="noopener">查看 / 下载生成图</a> · 由 <b>' +
        esc(ps.stage.via || "") + "</b> 生成 · 画幅 " + esc(ps.stage.ratio || "") +
        " · " + (ps.stage.wm === false ? '<span class="ps-nowm">无水印</span>' : '<span class="ps-wm">该通道带「AI生成」水印</span>')
      : "左为社区参考原图 · 生成后就地对比";
    return '<div class="ps-cmp"><div class="ps-track" style="--pos:50%">' + inner + '</div><div class="ps-foot">' + foot + "</div></div>";
  }
  function renderStage() {
    var el = document.getElementById("ps-stage");
    if (!el) return;
    el.innerHTML = stageHtml();
    bindCmp(el);
  }

  /* ── 右侧历史列表：缩略图 + 元信息，点击切换对比，可删除 ── */
  function ago(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + " 秒前";
    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
    if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    return Math.floor(s / 86400) + " 天前";
  }
  function renderHistory() {
    var el = document.getElementById("ps-side");
    if (!el) return;
    var w = works();
    var html = '<div class="ps-side-h">生成历史<small>' + w.length + " 张 · 仅存本机</small></div>";
    if (!w.length) {
      html += '<div class="ps-side-empty">还没有记录。生成一张后会出现在这里，点任意一条可回到那次的对比。</div>';
    } else {
      html += w.slice(0, 24).map(function (x) {
        var on = ps.stage.url && x.url === ps.stage.url;
        return '<div class="ps-hitem' + (on ? " on" : "") + '" data-hist="' + esc(x.url) + '" data-hid="' + x.id + '">' +
          '<img loading="lazy" src="' + esc(x.url) + '" alt="">' +
          '<div class="ps-hb"><div>' + esc(x.t.slice(0, 18)) + "</div><small>" + esc(x.via || "未知模型") + " · " + ago(x.ts) + "</small></div>" +
          '<button class="ps-hdel" data-hdel="' + x.ts + '" title="删除这条">&times;</button></div>';
      }).join("");
    }
    el.innerHTML = html;
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

  var RATIOS = [["1:1", "1:1"], ["9:16", "9:16 竖"], ["16:9", "16:9 横"], ["3:4", "3:4 竖"], ["4:3", "4:3 横"]];
  var sameCtx = { list: [], pos: -1 };   // 当前分类内的翻页序列

  function ratioChips(cur, orig) {
    return RATIOS.map(function (p) {
      return '<button class="pp-chip' + (cur === p[0] ? " on" : "") + '" data-ratio="' + p[0] + '">' + p[1] + (orig === p[0] ? " · 原图" : "") + "</button>";
    }).join("");
  }

  /* AI 提示词改写：走网关 /refine（服务端持共享令牌，站点免登录可用）。
     失败静默降级返回原文，绝不阻塞生图主流程。 */
  function refinePrompt(rawPrompt, note) {
    return fetch(GATEWAY + "/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: rawPrompt, note: note || "" })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      return (j.refined && j.refined.trim()) ? j.refined.trim() : rawPrompt;
    }).catch(function () { return rawPrompt; });
  }

/* ── 常驻提示词面板：默认「适配当前模型」版（进入即自动改写、可编辑），另一页是原始提示词 ── */
  var ps = { r: null, b: null, adapted: "", tab: "adapt", busy: false, note: "" };

  function currentPrompt() {
    var ta = document.getElementById("ps-adapt");
    if (ps.tab === "adapt" && ta && ta.value.trim()) return ta.value.trim();
    return (ps.b && ps.b.p) || "";
  }

  function promptPanelHtml() {
    var raw = ps.b ? ps.b.p : "";
    var body;
    if (ps.tab === "adapt") {
      body = '<div class="ps-cap">适配当前模型<span class="ps-sub">已去掉结构化包装并补画质词，可直接编辑</span></div>' +
        (ps.busy && !ps.adapted
          ? '<div class="ps-skeleton"><span class="ps-spin"></span>AI 正在按模型改写提示词…</div>'
          : '<textarea id="ps-adapt" class="ps-ta" rows="6" spellcheck="false">' + esc(ps.adapted || raw) + "</textarea>");
    } else {
      body = '<div class="ps-cap">原始提示词<span class="ps-sub">社区原文，可能含 JSON / 参数结构</span></div>' +
        '<textarea class="ps-ta" rows="6" readonly spellcheck="false">' + esc(raw) + "</textarea>";
    }
    var btns = ps.tab === "adapt"
      ? '<button class="pp-btn pri" data-psgen>用这段生成</button><button class="pp-btn gho" data-psrefine>' + (ps.adapted ? "重新改写" : "AI 改写") + "</button>"
      : '<button class="pp-btn gho" data-psrawgen>直接生成原文</button>';
    return '<div class="ps-panel">' +
      '<div class="ps-tabs">' +
      '<button class="pp-chip' + (ps.tab === "adapt" ? " on" : "") + '" data-pstab="adapt">适配当前模型</button>' +
      '<button class="pp-chip' + (ps.tab === "raw" ? " on" : "") + '" data-pstab="raw">原始提示词</button>' +
      '<button class="pp-btn gho ps-copy" data-pscopy="' + (ps.tab === "adapt" ? "1" : "0") + '">&#128203; 复制</button></div>' +
      body +
      '<div class="ps-act">' + btns + '<span class="ps-note-inline" id="ps-note">' + esc(ps.note) + "</span></div></div>";
  }

  function mountPromptPanel() {
    var host = document.getElementById("ps-panel");
    if (host) host.innerHTML = promptPanelHtml();
  }

  function autoRefine(force) {
    if (!ps.b) return;
    if (ps.adapted && !force) return;
    ps.busy = true; ps.note = ""; mountPromptPanel();
    refinePrompt(ps.b.p, "").then(function (newP) {
      ps.busy = false;
      ps.adapted = newP && newP !== ps.b.p ? newP : "";
      ps.note = ps.adapted ? "已改写 ✓ 可微调后生成" : "改写服务暂不可用，已用原文";
      mountPromptPanel();
    });
  }

  function bindPromptPanel() {
    var host = document.getElementById("ps-panel");
    if (!host) return;
    host.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-pstab]");
      if (tab) { ps.tab = tab.dataset.pstab; mountPromptPanel(); return; }
      var cp = e.target.closest("[data-pscopy]");
      if (cp) { copyText(cp.dataset.pscopy === "1" ? currentPrompt() : ps.b.p, "提示词已复制"); return; }
      if (e.target.closest("[data-psgen]")) { runGen(currentPrompt()); return; }
      if (e.target.closest("[data-psrawgen]")) { runGen(ps.b.p); return; }
      if (e.target.closest("[data-psrefine]")) { autoRefine(true); return; }
    });
    host.addEventListener("input", function (e) {
      if (e.target.id === "ps-adapt") ps.adapted = e.target.value;
    });
  }

  function copyText(text, msg) {
    function fb() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(msg); } catch (e) { toast("复制失败，请手动选中"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg); }, fb);
    else fb();
  }
  function readRatio() { try { return localStorage.getItem("zhifu_ratio") || "1:1"; } catch (e) { return "1:1"; } }

  function runGen(prompt) {
    if (!ps.r || !ps.b) return;
    if (remain() > 0) {
      ps.stage = { busy: false, url: "", via: "", ratio: ps.ratio, err: "免费通道每分钟只跑一张，" + remain() + " 秒后自动继续" };
      renderStage();
      setTimeout(function () { runGen(prompt); }, remain() * 1000 + 400);
      return;
    }
    var ratio = ps.ratio || "1:1";
    ps.stage = { busy: true, url: "", via: "", ratio: ratio, err: "" };
    renderStage();
    startCooldown(COOL_SEC);
    logEvent("same", ps.r.id);
    tryGenerate(PP_ACTIVE, { prompt: prompt, ratio: ratio })
      .then(function (d) {
        if (d.url) {
          ps.stage = { busy: false, url: d.url, via: d.via, ratio: ratio, err: "", wm: d.wm !== false };
          genCache[ps.r.id] = { url: d.url, via: d.via, prompt: prompt, ratio: ratio, wm: d.wm !== false };
          saveWork(ps.r, d.url, d.via);
          ps.note = "生成完成 ✓";
        } else if (d.retryAfter) {
          startCooldown(d.retryAfter);
          ps.stage = { busy: false, url: "", via: "", ratio: ratio, err: "队列繁忙，" + d.retryAfter + " 秒后自动重试" };
          setTimeout(function () { runGen(prompt); }, d.retryAfter * 1000 + 400);
        } else {
          ps.stage = { busy: false, url: "", via: "", ratio: ratio, err: d.error || "未知错误", tried: (d.tried || []).join(" | ") };
        }
        mountPromptPanel(); renderStage(); renderHistory(); tickCool();
      })
      .catch(function (e) {
        ps.stage = { busy: false, url: "", via: "", ratio: ratio, err: "连不上生图服务：" + e.message };
        mountPromptPanel(); renderStage(); renderHistory(); tickCool();
      });
  }

  /* 进入页面：先按模型改写提示词，再用改写结果生成（改写失败则用原文，不阻塞） */
  function startFlow() {
    ps.busy = true; ps.note = ""; mountPromptPanel();
    refinePrompt(ps.b.p, "").then(function (newP) {
      ps.busy = false;
      ps.adapted = newP && newP !== ps.b.p ? newP : "";
      ps.note = ps.adapted ? "已按模型改写 ✓ 正在用适配版生成" : "改写服务暂不可用，用原文生成";
      mountPromptPanel();
      runGen(ps.adapted || ps.b.p);
    });
  }

  function gen(r, force, opts) {
    opts = opts || {};
    ensureBody(r, function (b) {
      if (!b) return;
      var reused = genCache[r.id];
      ps.r = r; ps.b = b; ps.tab = "adapt"; ps.adapted = ""; ps.note = "";
      ps.ratio = opts.ratio || (reused && reused.ratio) || r.ar || readRatio();
      if (reused && !force) {
        ps.stage = { busy: false, url: reused.url, via: reused.via, ratio: reused.ratio, err: "" };
        ps.adapted = reused.prompt && reused.prompt !== b.p ? reused.prompt : "";
        mountPromptPanel(); renderStage(); renderHistory(); tickCool();
      } else {
        ps.stage = { busy: false, url: "", via: "", ratio: ps.ratio, err: "" };
        mountPromptPanel(); renderStage(); renderHistory(); tickCool();
        startFlow();
      }
    });
  }

  /* 反推：本地图片压缩到 768px → 代理 → 视觉模型输出提示词 */
  function reverseImage(file, ta, note, cb) {
    if (!/^image\//.test(file.type)) { note.textContent = "请选择图片文件"; return; }
    note.textContent = "反推中…";
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var w = im.width, h = im.height, k = Math.min(1, 768 / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        var dataURL = c.toDataURL("image/jpeg", 0.85);
        fetch(API_BASE + "/reverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataURL }) })
          .then(function (res) { return res.json().catch(function () { return { error: "代理返回异常 HTTP " + res.status }; }); })
          .then(function (d) {
            if (d.text) {
              if (cb) cb(d.text); else if (ta) ta.value = d.text;
              note.textContent = "反推完成（" + (d.via || "glm-4.6v-flash") + "）· 已填入，可编辑后生成";
              logEvent("reverse", "ok");
            } else if (d.retryAfter) {
              note.textContent = "视觉模型忙，" + d.retryAfter + " 秒后自动重试…";
              setTimeout(function () { reverseImage(file, ta, note, cb); }, d.retryAfter * 1000 + 400);
            } else {
              note.textContent = "反推失败：" + (d.error || "未知错误");
            }
          })
          .catch(function (e) { note.textContent = "反推请求失败：" + e.message; });
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function similarHtml(r) {
    var pool = IDX.filter(function (x) { return x.cn === r.cn && x.id !== r.id; }).slice(0, 60);
    if (!pool.length) return "";
    var picks = [];
    while (picks.length < 4 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return '<div class="ps-similar"><div class="ps-cap2">同场景还可以试</div><div class="ps-sim-grid">' +
      picks.map(function (x) {
        return '<div class="ps-sim" data-goto="' + x.id + '"><img loading="lazy" src="' + imgOf(x.im) + '" alt=""><span>' + esc(x.t.slice(0, 16)) + "</span></div>";
      }).join("") + "</div></div>";
  }

  function navHtml(r) {
    var prev = sameCtx.pos > 0, next = sameCtx.pos < sameCtx.list.length - 1;
    return '<div class="ps-nav">' +
      (prev ? '<button class="pp-btn gho" data-samenav="-1">&#8592;</button>' : "") +
      '<small>' + (sameCtx.pos + 1) + " / " + sameCtx.list.length + "</small>" +
      (next ? '<button class="pp-btn gho" data-samenav="1">&#8594;</button>' : "") + "</div>";
  }

  function openSame(id) {
    var r = byId(id); if (!r) return;
    closeDetail(); showPage("same");
    if (history.replaceState) history.replaceState(null, "", "#same" + r.id);
    sameCtx.list = IDX.filter(function (x) { return x.cn === r.cn; }).map(function (x) { return x.id; });
    sameCtx.pos = sameCtx.list.indexOf(r.id);
    document.getElementById("ps-body").innerHTML =
      '<div class="ps-head"><button class="pp-btn gho" id="ps-back">&#8592; 返回词库</button>' +
      '<div class="ps-head-t"><h1 class="ps-h1">' + esc(r.t) + "</h1>" +
      '<div class="ps-meta">' + esc(r.cn) + " · " + esc(SRC_NAME[r.src] || r.src) + " · 编号 #" + r.id +
      (r.ph && r.ph.length ? ' · 改这几个词就能用：<b>' + esc(r.ph.slice(0, 2).join(" / ")) + "</b>" : "") + "</div></div>" +
      navHtml(r) + "</div>" +
      '<div class="ps-grid"><div class="ps-main">' +
      '<div id="ps-panel"></div>' +
      '<div class="ps-ctrl"><span class="ps-cap2">画幅</span><div class="pp-fchips" id="ps-ratios">' + ratioChips(r.ar || readRatio(), r.ar) + "</div>" +
      '<label class="ps-upfile">&#128247; 选图片反推提示词<input type="file" id="ps-rev" accept="image/*"></label>' +
      '<span class="ps-note-inline" id="ps-revnote"></span></div>' +
      '<div id="ps-stage"></div>' +
      '<div id="ps-similar">' + similarHtml(r) + "</div>" +
      leadHtml() +
      "</div>" +
      '<aside class="ps-side" id="ps-side"></aside></div>';

    document.getElementById("ps-back").onclick = function () {
      showPage("prompts");
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    };
    bindPromptPanel();
    document.getElementById("ps-rev").addEventListener("change", function () {
      if (this.files && this.files[0]) reverseImage(this.files[0], { value: "" }, document.getElementById("ps-revnote"), function (txt) {
        ps.tab = "adapt"; ps.adapted = txt; ps.note = "反推完成 ✓ 已填入适配版，可编辑后生成";
        var ta = document.getElementById("ps-adapt"); if (ta) ta.value = txt;
        mountPromptPanel();
      });
    });
    var view = document.getElementById("view-same");
    view.addEventListener("click", function (e) {
      var nv = e.target.closest("[data-samenav]");
      if (nv) {
        var np = sameCtx.pos + (+nv.dataset.samenav);
        if (np >= 0 && np < sameCtx.list.length) openSame(sameCtx.list[np]);
        return;
      }
      var rt = e.target.closest("[data-ratio]");
      if (rt) {
        ps.ratio = rt.dataset.ratio;
        document.querySelectorAll("[data-ratio]").forEach(function (x) { x.classList.toggle("on", x.dataset.ratio === ps.ratio); });
        return;
      }
      if (e.target.closest("[data-retry]")) { runGen(currentPrompt()); return; }
      var orf = e.target.closest("[data-openref]");
      if (orf && ps.b) { window.open(imgOf(ps.b.img), "_blank"); return; }
      var hm = e.target.closest("[data-hist]");
      if (hm) {
        var del = e.target.closest("[data-hdel]");
        if (del) {
          var ts = +del.dataset.hdel;
          var left = works().filter(function (x) { return x.ts !== ts; });
          localStorage.setItem(WORK_KEY, JSON.stringify(left));
          renderHistory();
          return;
        }
        var hid = +hm.dataset.hid, rec = byId(hid);
        ps.stage = { busy: false, url: hm.dataset.hist, via: (works().find(function (x) { return x.url === hm.dataset.hist; }) || {}).via || "", ratio: ps.ratio, err: "" };
        if (rec) ensureBody(rec, function (b) { ps.b = b; renderStage(); renderHistory(); });
        else { renderStage(); renderHistory(); }
        return;
      }
      var sm = e.target.closest("#ps-similar [data-goto]");
      if (sm) { openSame(+sm.dataset.goto); return; }
    });
    gen(r);
  }

  /* ---------- 需求 → 配方 ---------- */
  var SCENES = ["小红书封面", "公众号头图", "电商主图", "信息图", "人物头像", "手机壁纸", "PPT 配图", "Logo", "漫画分镜", "产品海报"];
  var sceneBox = document.getElementById("scene-chips"), needIn = document.getElementById("need"), matchOut = document.getElementById("match-out");

  function imgOf(p) { return ASSET_BASE + esc(String(p || "").replace(/^img\//, "")); }

  function doMatch(need) {
    need = String(need || "").trim();
    if (!need || !matchOut) return;
    if (needIn) needIn.value = need;
    matchOut.innerHTML = '<div class="pp-matching"><span class="ps-spin"></span>正在从 ' + IDX.length + ' 条配方里挑…</div>';
    fetch(API_BASE + "/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ need: need }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        var list = (d && d.list) || [];
        if (!list.length) { matchOut.innerHTML = '<div class="pp-empty-line">没匹配到，换个说法试试（比如「健身」「茶叶」「儿童绘本」）</div>'; return; }
        matchOut.innerHTML = '<div class="pp-match-title">给你 ' + list.length + ' 条 · 需求「' + esc(need) + '」</div><div class="pp-match-grid">' +
          list.map(function (x) {
            return '<div class="pp-mcard glass"><img loading="lazy" src="' + imgOf(x.img) + '" alt="' + esc(x.t) + '">' +
              '<div class="pp-mbody"><div class="pp-mt" data-goto="' + x.id + '">' + esc(x.t) + "</div>" +
              '<div class="pp-mwhy">' + esc(x.why) + " · " + esc(x.cn) + "</div>" +
              '<div class="pp-macts"><button class="pp-btn pri" data-same2="' + x.id + '">&#9889; 做同款</button>' +
              '<button class="pp-btn gho" data-copy2="' + x.id + '">&#128203; 复制</button></div></div></div>';
          }).join("") + "</div>";
      })
      .catch(function () { matchOut.innerHTML = '<div class="pp-empty-line">推荐服务暂不可用，先用下面的搜索</div>'; });
  }

  /* ---------- 榜单页 ---------- */
  var rankBody = document.getElementById("rank-body");
  function renderRank() {
    if (!rankBody || rankBody.dataset.done) return;
    rankBody.innerHTML = '<div class="pp-matching"><span class="ps-spin"></span>正在统计…</div>';
    var picks = IDX.filter(function (r) { return r.f; }).slice(0, 24);
    function paint(board) {
      var html = "";
      if (board && board.length) {
        html += '<h2 class="pp-rh1">真实热榜 · 按复制与复刻次数</h2><div class="pp-rank-list">' + board.map(function (x, i) {
          return '<div class="pp-rank glass" data-goto="' + x.id + '"><span class="pp-rank-n">' + (i + 1) + "</span>" +
            '<img loading="lazy" src="' + imgOf(x.img) + '" alt=""><div class="pp-rank-b"><div>' + esc(x.t) + "</div>" +
            "<small>" + esc(x.cn) + " · 复制 " + x.copy + " · 复刻 " + x.same + "</small></div>" +
            '<button class="pp-btn pri" data-same2="' + x.id + '">&#9889;</button></div>';
        }).join("") + "</div>";
      } else {
        html += '<div class="pp-empty-line">还没有真实数据 —— 先去复刻几张，榜单每天更新一次。</div>';
      }
      html += '<h2 class="pp-rh1">编辑精选 · 最稳的起手式</h2><div class="pp-rank-list">' + picks.map(function (r) {
        return '<div class="pp-rank glass" data-goto="' + r.id + '"><span class="pp-rank-n">&#11088;</span>' +
          '<img loading="lazy" src="' + imgOf(r.im) + '" alt=""><div class="pp-rank-b"><div>' + esc(r.t) + "</div><small>" + esc(r.cn) + "</small></div>" +
          '<button class="pp-btn pri" data-same2="' + r.id + '">&#9889;</button></div>';
      }).join("") + "</div>";
      rankBody.innerHTML = html;
      rankBody.dataset.done = "1";
    }
    Promise.all([
      fetch(API_BASE + "/leaderboard").then(function (r) { return r.json().catch(function () { return {}; }); }).catch(function () { return {}; }),
      fetch("data/works.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    ]).then(function (res) {
      paint((res[0] && res[0].board) || []);
      renderWorks(res[1] || []);
    });
  }
  function renderWorks(list) {
    if (!rankBody || !list.length) return;
    var byId = {};
    list.forEach(function (w) { (byId[w.id] = byId[w.id] || []).push(w); });
    var html = '<h2 class="pp-rh1">官方对比集 · 同一条配方换画幅</h2><div class="pp-works">';
    Object.keys(byId).forEach(function (id) {
      var g = byId[id], first = g[0];
      html += '<div class="pp-work glass"><div class="pp-work-t" data-goto="' + id + '">' + esc(first.t) + " <small>" + esc(first.cn) + "</small></div><div class='pp-work-row'>" +
        '<figure><img loading="lazy" src="' + imgOf(first.ref) + '" alt="参考原图"><figcaption>原图</figcaption></figure>' +
        g.map(function (w) {
          return '<figure><img loading="lazy" src="' + imgOf(w.img) + '" alt="' + esc(w.ratio) + '"><figcaption>' + esc(w.ratio) + " · " + esc(w.model || "") + "</figcaption></figure>";
        }).join("") + "</div></div>";
    });
    rankBody.insertAdjacentHTML("beforeend", html + "</div>");
    rankBody.querySelectorAll(".pp-work-t").forEach(function (n) {
      n.onclick = function () { openDetail(+n.dataset.goto); };
    });
  }

  /* ---- 事件绑定 ---- */
  if (sceneBox) {
    sceneBox.innerHTML = SCENES.map(function (s) { return '<button class="pp-chip" data-scene="' + esc(s) + '">' + esc(s) + "</button>"; }).join("");
    sceneBox.addEventListener("click", function (e) {
      var c = e.target.closest("[data-scene]"); if (c) doMatch(c.dataset.scene);
    });
  }
  if (needIn) needIn.addEventListener("keydown", function (e) { if (e.key === "Enter") doMatch(needIn.value); });
  var needGo = document.getElementById("need-go");
  if (needGo) needGo.onclick = function () { doMatch(needIn && needIn.value); };
  if (matchOut) matchOut.addEventListener("click", function (e) {
    var s = e.target.closest("[data-same2]"); if (s) { openSame(+s.dataset.same2); return; }
    var c = e.target.closest("[data-copy2]"); if (c) { copyPrompt(+c.dataset.copy2); return; }
    var g = e.target.closest("[data-goto]"); if (g) openDetail(+g.dataset.goto);
  });
  if (rankBody) rankBody.addEventListener("click", function (e) {
    var s = e.target.closest("[data-same2]"); if (s) { e.stopPropagation(); openSame(+s.dataset.same2); return; }
    var g = e.target.closest("[data-goto]"); if (g) openDetail(+g.dataset.goto);
  });
  document.querySelector("nav") && document.querySelector("nav").addEventListener("click", function (e) {
    var t = e.target.closest("[data-view]");
    if (t && t.dataset.view === "rank") setTimeout(renderRank, 50);
  });
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
    var gn = e.target.closest("[data-gen]");
    if (gn) {
      var rr = byId(+gn.dataset.gen), ed = document.getElementById("ps-edit");
      if (rr && ed && ed.value.trim() && ed.value.trim() !== rr.p) gen(rr, true, { prompt: ed.value.trim() });
      else gen(rr, true);
      return true;
    }
    var fv = e.target.closest("[data-fav]"); if (fv) { toggleFav(+fv.dataset.fav); return true; }
    var rt = e.target.closest("[data-ratio]");
    if (rt) {
      localStorage.setItem("zhifu_ratio", rt.dataset.ratio);
      document.querySelectorAll("[data-ratio]").forEach(function (x) { x.classList.toggle("on", x.dataset.ratio === rt.dataset.ratio); });
      return true;
    }
    var sn = e.target.closest("[data-samenav]");
    if (sn) {
      var np = sameCtx.pos + (+sn.dataset.samenav);
      if (np >= 0 && np < sameCtx.list.length) openSame(sameCtx.list[np]);
      return true;
    }
    var ex = e.target.closest("[data-exportfav]"); if (ex) { exportFavs(); return true; }
    return false;
  }
  function exportFavs() {
    var picks = IDX.filter(function (r) { return favs.has(r.id); });
    if (!picks.length) { toast("还没有收藏，先点亮卡片右上角的 ★"); return; }
    var missing = picks.filter(function (r) { return !body[r.id]; });
    if (!missing.length) return doExport(picks);
    toast("正在打包收藏…");
    var n = 0;
    missing.forEach(function (r) {
      ensureBody(r, function () { if (++n === missing.length) doExport(picks); });
    });
  }
  function doExport(picks) {
    var stamp = new Date().toISOString().slice(0, 10);
    var md = "# 我的收藏 · " + picks.length + " 条\n\n" + picks.map(function (r) {
      return "## " + r.t + "\n\n> 分类 " + r.cn + " · " + (SRC_NAME[r.src] || r.src) + " · " + BASE.replace(/https?:\/\//, "") + "/p/" + r.id + ".html\n\n```\n" + ((body[r.id] || {}).p || "") + "\n```\n";
    }).join("\n");
    var zip = JSON.stringify(picks.map(function (r) { var b = body[r.id] || {}; return { id: r.id, title: r.t, category: r.cn, prompt: b.p || "", image: BASE + "/" + r.im, source: b.su || "" }; }), null, 1);
    dl("zhifu-favs-" + stamp + ".md", md, "text/markdown");
    setTimeout(function () { dl("zhifu-favs-" + stamp + ".json", zip, "application/json"); }, 300);
    toast("收藏已导出：Markdown + JSON 各一份");
  }
  function bodyById(id) { return body[id] || null; }
  function dl(name, content, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: type }));
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  mask.addEventListener("click", function (e) {
    if (e.target === mask || e.target.closest("[data-close]")) { closeDetail(); return; }
    anywhere(e);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mask.classList.contains("show")) { closeDetail(); return; }
    if (document.getElementById("view-same").classList.contains("show") && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !/TEXTAREA|INPUT/.test(document.activeElement.tagName)) {
      var np = sameCtx.pos + (e.key === "ArrowRight" ? 1 : -1);
      if (np >= 0 && np < sameCtx.list.length) openSame(sameCtx.list[np]);
    }
  });
  document.getElementById("pp-more").onclick = function () { st.shown += CHUNK; renderGrid(); };

  /* ---- 启动 ---- */
  var toTop = document.createElement("button");
  toTop.id = "to-top";
  toTop.innerHTML = "&#8679; 顶部";
  toTop.onclick = function () { window.scrollTo({ top: 0, behavior: "smooth" }); };
  document.body.appendChild(toTop);
  window.addEventListener("scroll", function () {
    toTop.classList.toggle("show", window.scrollY > 600);
  }, { passive: true });

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
