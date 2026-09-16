/* ===== 提示词库交互层 =====
   数据：data/prompts.js 的 window.PROMPTS（三源合并，见 ../README.md）
   生图：PP_API 指向的服务端代理，密钥在代理侧，前端只发 {prompt}
   页面：#view-prompts 列表 / #view-same 做同款独立页（hash #p<id> 详情、#same<id> 做同款） */
(function () {
  var ALL = window.PROMPTS || [];
  var PP_API = "https://zzmeq5c4.qwenwork.host";
  var FAV_KEY = "zhifu_fav_prompts";
  var COOL_KEY = "zhifu_pp_next";
  var COOL_SEC = 60;
  var CHUNK = 60;
  var genCache = {};
  var coolTimer = null;

  var SRC_NAME = { gpt: "GPT Image 2 精选", ym: "YouMind 主仓", nb: "Nano Banana 玩法" };
  var st = { q: "", src: "", cat: "", style: "", scene: "", feat: false, fav: false, sort: "rank", shown: CHUNK };

  var grid = document.getElementById("pp-grid");
  var filters = document.getElementById("pp-filters");
  var bar = document.getElementById("pp-count");
  var input = document.getElementById("pp-q");
  var mask = document.getElementById("detail-mask");
  var box = document.getElementById("detail-box");
  var toastEl = document.getElementById("pp-toast");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }
  function byId(id) { for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i]; return null; }
  window.ppImgFallback = function (img) {
    var f = img.dataset.fb;
    if (!f) return;
    img.dataset.fb = "";
    img.src = f;
  };
  function favsLoad() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch (e) { return new Set(); } }
  var favs = favsLoad();
  function favsSave() { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favs))); }

  /* ---------- 筛选：分面计数（每个候选值统计「除该维度外其余条件都满足」的条数） ---------- */
  function match(r, skip) {
    var q = st.q.trim().toLowerCase();
    if (skip !== "src" && st.src && r.src !== st.src) return false;
    if (skip !== "cat" && st.cat && r.cn !== st.cat) return false;
    if (skip !== "style" && st.style && (r.s || []).indexOf(st.style) < 0) return false;
    if (skip !== "scene" && st.scene && (r.sc || []).indexOf(st.scene) < 0) return false;
    if (skip !== "feat" && st.feat && !r.f) return false;
    if (skip !== "fav" && st.fav && !favs.has(r.id)) return false;
    if (q) {
      var hay = (r.t + " " + r.p + " " + r.cn + " " + (r.s || []).join(" ") + " " + (r.sc || []).join(" ")).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function filtered() {
    var out = ALL.filter(function (r) { return match(r, null); });
    if (st.sort === "new") out.sort(function (a, b) { return b.id - a.id; });
    else if (st.sort === "title") out.sort(function (a, b) { return a.t.localeCompare(b.t, "zh"); });
    else out.sort(function (a, b) { return (b.f - a.f) || (a.id - b.id); });
    return out;
  }
  function facet(dataKey, stateField, isList) {
    var m = {};
    ALL.forEach(function (r) {
      if (!match(r, stateField)) return;
      var v = isList ? (r[dataKey] || []) : [r[dataKey]];
      (v || []).forEach(function (x) { if (x) m[x] = (m[x] || 0) + 1; });
    });
    return m;
  }
  function row(label, field, map) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
    if (!keys.length) return "";
    var all = ALL.filter(function (r) { return match(r, field); }).length;
    var h = '<div class="pp-frow"><span class="pp-flabel">' + label + '</span><div class="pp-fchips">';
    h += '<button class="pp-chip' + (st[field] ? "" : " on") + '" data-f="' + field + '" data-v="">全部 <i>' + all + "</i></button>";
    keys.forEach(function (k) {
      if (!map[k]) return;
      var name = field === "src" ? (SRC_NAME[k] || k) : k;
      h += '<button class="pp-chip' + (st[field] === k ? " on" : "") + '" data-f="' + field + '" data-v="' + esc(k) + '">' + esc(name) + " <i>" + map[k] + "</i></button>";
    });
    return h + "</div></div>";
  }
  function renderFilters() {
    var base = ALL.filter(function (r) { return match(r, null); }).length;
    filters.innerHTML =
      row("来源库", "src", facet("src", "src")) +
      row("使用场景", "cat", facet("cn", "cat")) +
      row("视觉风格", "style", facet("s", "style", true)) +
      row("题材", "scene", facet("sc", "scene", true)) +
      '<div class="pp-frow"><span class="pp-flabel">快捷</span><div class="pp-fchips">' +
      '<button class="pp-chip' + (st.feat ? " on" : "") + '" data-t="feat">&#11088; 只看精选</button>' +
      '<button class="pp-chip' + (st.fav ? " on fav" : "") + '" data-t="fav">&#9829; 我的收藏 ' + favs.size + "</button>" +
      '<span class="pp-sortwrap">排序</span>' +
      ["rank:推荐", "new:最新", "title:标题"].map(function (s) {
        var p = s.split(":");
        return '<button class="pp-chip' + (st.sort === p[0] ? " on" : "") + '" data-sort="' + p[0] + '">' + p[1] + "</button>";
      }).join("") +
      "</div></div>";
    bar.innerHTML = "当前 <b>" + base + "</b> 条 / 全库 " + ALL.length + " 条" +
      (base !== ALL.length ? ' <button class="pp-clear" data-clear>清空筛选</button>' : "");
  }

  function card(r) {
    var tags = (SRC_NAME[r.src] || "").replace(" 精选", "").replace(" 主仓", "");
    var extra = (r.s || []).slice(0, 2).map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") +
      (r.sc || []).slice(0, 1).map(function (x) { return '<i class="scene">' + esc(x) + "</i>"; }).join("");
    return '<div class="pp-card glass" data-id="' + r.id + '">' +
      (r.f ? '<span class="pp-flag">精选</span>' : "") +
      '<button class="pp-same" data-same="' + r.id + '" title="一键做同款">&#9889;</button>' +
      '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" data-fav="' + r.id + '" title="收藏">&#9733;</button>' +
      '<img class="pp-thumb" loading="lazy" decoding="async" src="' + esc(r.img) + '" data-fb="' + esc(r.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '">' +
      '<div class="pp-body"><div class="pp-title">' + esc(r.t) + "</div>" +
      '<div class="pp-desc">' + esc((r.p || "").replace(/\s+/g, " ").slice(0, 88)) + "…</div>" +
      '<div class="pp-tags"><i class="src">' + esc(tags) + "</i>" + extra + "</div></div></div>";
  }

  function renderGrid() {
    var rows = filtered();
    st.shown = Math.max(CHUNK, Math.min(st.shown, rows.length));
    grid.innerHTML = rows.slice(0, st.shown).map(card).join("") ||
      '<div class="pp-empty">没有匹配的提示词，换个关键词或清空筛选试试。</div>';
    var more = document.getElementById("pp-more");
    if (more) more.style.display = rows.length > st.shown ? "block" : "none";
    requestAnimationFrame(function () {
      grid.querySelectorAll(".pp-card:not(.vis)").forEach(function (el, i) {
        el.style.transitionDelay = (i % 8) * 0.04 + "s";
        el.classList.add("vis");
      });
    });
  }
  function refresh() { renderFilters(); renderGrid(); }

  /* ---------- 页面切换（做同款是独立页面） ---------- */
  function showPage(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("show", v.id === "view-" + name); });
    document.querySelectorAll(".nav-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name || (name === "same" && t.dataset.view === "prompts"));
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ---------- 详情弹层 ---------- */
  function markVars(s) {
    return esc(s).replace(/\[([A-Z][A-Z \/][^\]\n]{0,28})\]/g, '<span class="pp-var">[$1]</span>');
  }
  function openDetail(id) {
    var r = byId(id);
    if (!r) return;
    box.innerHTML = '<button class="detail-close" data-close>&#10005;</button>' +
      '<span class="d-tag">' + esc(r.cn) + "</span>" +
      '<div class="pp-d-head"><h2>' + esc(r.t) + "</h2>" +
      '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" style="position:static;opacity:1;border:1px solid rgba(0,0,0,.08)" data-fav="' + r.id + '">&#9733; 收藏</button></div>' +
      '<div class="pp-d-grid">' +
      '<div><img class="pp-d-img" src="' + esc(r.img) + '" data-fb="' + esc(r.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '" loading="lazy">' +
      (r.in ? '<img class="pp-d-img pp-d-in" src="' + esc(r.in) + '" alt="输入图" loading="lazy"><div class="pp-d-meta">↑ 这条是图生图玩法，上面是它的输入图</div>' : "") +
      '<div class="pp-d-meta">来源：' + (r.su ? '<a href="' + esc(r.su) + '" target="_blank" rel="noopener">' + esc(r.sl || "查看原帖") + "</a>" : esc(r.sl || "—")) +
      " · 编号 #" + r.id + " · " + esc(SRC_NAME[r.src] || r.src) + "</div></div>" +
      '<div><div class="pp-plabel">提示词（' + (r.p || "").length + " 字符）</div>" +
      '<div class="pp-prompt">' + markVars(r.p) + "</div>" +
      '<div class="pp-actions">' +
      '<button class="pp-btn pri" data-copy="' + r.id + '">&#128203; 复制提示词</button>' +
      '<button class="pp-btn gho" data-goto="' + r.id + '">&#9889; 做同款看对比</button></div></div></div>';
    mask.classList.add("show");
    document.body.style.overflow = "hidden";
    if (history.replaceState) history.replaceState(null, "", "#p" + r.id);
  }
  function closeDetail() {
    mask.classList.remove("show");
    document.body.style.overflow = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  }

  function copyPrompt(id) {
    var r = byId(id);
    if (!r) return;
    var done = function () { toast("提示词已复制，直接粘到即梦 / 可灵 / GPT Image 就能用"); };
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = r.p; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.p).then(done, fallback);
    else fallback();
  }

  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    favsSave();
    document.querySelectorAll('[data-fav="' + id + '"]').forEach(function (b) { b.classList.toggle("on", favs.has(id)); });
    renderFilters();
    renderGrid();
  }

  /* ---------- 冷却倒计时 ---------- */
  function remain() { return Math.max(0, Math.ceil(((+localStorage.getItem(COOL_KEY) || 0) - Date.now()) / 1000)); }
  function startCooldown(sec) { localStorage.setItem(COOL_KEY, String(Date.now() + sec * 1000)); tickCool(); }
  function tickCool() {
    var left = remain();
    document.querySelectorAll("[data-gen]").forEach(function (b) {
      b.disabled = left > 0;
      b.innerHTML = left > 0 ? "&#9203; " + left + " 秒后可再做" : "&#9889; 重新生成一张";
    });
    if (left > 0 && !coolTimer) {
      coolTimer = setInterval(function () {
        tickCool();
        if (remain() <= 0) { clearInterval(coolTimer); coolTimer = null; }
      }, 1000);
    }
  }

  /* ---------- 做同款页：原图 / 生成图 拖动对比 ---------- */
  function cmpHtml(r, url, via) {
    return '<div class="ps-cmp"><div class="ps-track" style="--pos:50%">' +
      '<img class="ps-base" src="' + esc(r.img) + '" data-fb="' + esc(r.oj) + '" onerror="ppImgFallback(this)" alt="原图">' +
      '<div class="ps-top"><img src="' + esc(url) + '" alt="AI 同款"></div>' +
      '<div class="ps-handle"></div><span class="ps-tag l">原图</span><span class="ps-tag r">AI 同款</span></div>' +
      '<div class="ps-foot">按住中间竖线左右拖动对比 · <a href="' + esc(url) + '" target="_blank" rel="noopener">下载 AI 生成图</a>' +
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
    var g = genCache[r.id];
    if (g && !force) { out.innerHTML = cmpHtml(r, g.url, g.via); bindCmp(out); tickCool(); return; }
    if (remain() > 0 && !g) {
      out.innerHTML = '<div class="ps-note">免费通道每分钟只跑一张，<b>' + remain() + '</b> 秒后自动继续…</div>';
      setTimeout(function () { gen(r, true); }, Math.min(remain() * 1000 + 300, 61000));
      return;
    }
    out.innerHTML = '<div class="ps-note"><span class="ps-spin"></span>正在让智谱 CogView 出图，通常 10-40 秒…</div>';
    startCooldown(COOL_SEC);
    fetch(PP_API + "/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: r.p })
    }).then(function (res) { return res.json().catch(function () { return { error: "代理返回异常 HTTP " + res.status }; }); })
      .then(function (d) {
        if (d.url) {
          genCache[r.id] = { url: d.url, via: d.via };
          out.innerHTML = cmpHtml(r, d.url, d.via);
          bindCmp(out);
        } else if (d.retryAfter) {
          startCooldown(d.retryAfter);
          out.innerHTML = '<div class="ps-note">免费通道每分钟只跑一张，<b>' + d.retryAfter + '</b> 秒后自动继续…</div>';
          setTimeout(function () { gen(r, true); }, d.retryAfter * 1000 + 400);
        } else {
          out.innerHTML = '<div class="ps-note ps-bad">失败：' + esc(d.error || "未知错误") +
            (d.tried && d.tried.length ? "<br>通道轨迹：" + esc(d.tried.join(" | ")) : "") + "</div>";
        }
        tickCool();
      })
      .catch(function (e) {
        out.innerHTML = '<div class="ps-note ps-bad">连不上生图服务：' + esc(e.message) + "</div>";
        tickCool();
      });
  }

  function openSame(id) {
    var r = byId(id);
    if (!r) return;
    closeDetail();
    showPage("same");
    if (history.replaceState) history.replaceState(null, "", "#same" + r.id);
    document.getElementById("ps-body").innerHTML =
      '<button class="ps-back" id="ps-back">&#8592; 返回提示词库</button>' +
      '<h1 class="ps-h1">' + esc(r.t) + "</h1>" +
      '<div class="ps-meta">' + esc(r.cn) + " · " + esc(SRC_NAME[r.src] || r.src) +
      (r.su ? ' · 出处 <a href="' + esc(r.su) + '" target="_blank" rel="noopener">' + esc(r.sl || "原帖") + "</a>" : "") + "</div>" +
      '<div class="ps-prompt">' + markVars(r.p) + "</div>" +
      '<div class="ps-acts"><button class="pp-btn pri" data-copy="' + r.id + '">&#128203; 复制提示词</button>' +
      '<button class="pp-btn gho" data-gen="' + r.id + '">&#9889; 重新生成一张</button></div>' +
      '<div id="ps-out"></div>';
    document.getElementById("ps-back").onclick = function () { showPage("prompts"); if (history.replaceState) history.replaceState(null, "", location.pathname + location.search); };
    gen(r);
  }

  /* ---------- 事件 ---------- */
  filters.addEventListener("click", function (e) {
    var c = e.target.closest(".pp-chip");
    if (!c) return;
    if (c.dataset.f) { st[c.dataset.f] = st[c.dataset.f] === c.dataset.v ? "" : c.dataset.v; }
    else if (c.dataset.t) { st[c.dataset.t] = !st[c.dataset.t]; }
    else if (c.dataset.sort) { st.sort = c.dataset.sort; }
    else return;
    st.shown = CHUNK;
    refresh();
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
  function clickAnywhere(e) {
    var cp = e.target.closest("[data-copy]"); if (cp) { copyPrompt(+cp.dataset.copy); return; }
    var go = e.target.closest("[data-goto]"); if (go) { openSame(+go.dataset.goto); return; }
    var gn = e.target.closest("[data-gen]"); if (gn) { gen(byId(+gn.dataset.gen), true); return; }
    var fv = e.target.closest("[data-fav]"); if (fv && mask.contains(fv)) toggleFav(+fv.dataset.fav);
  }
  mask.addEventListener("click", function (e) {
    if (e.target === mask || e.target.closest("[data-close]")) { closeDetail(); return; }
    clickAnywhere(e);
  });
  document.getElementById("view-same").addEventListener("click", clickAnywhere);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && mask.classList.contains("show")) closeDetail(); });
  document.getElementById("pp-more").onclick = function () { st.shown += CHUNK; renderGrid(); };

  /* ---------- 启动 ---------- */
  document.querySelectorAll("[data-total]").forEach(function (el) { el.textContent = ALL.length; });
  refresh();
  tickCool();

  var m = location.hash.match(/^#p(\d+)$/);
  if (m) openDetail(+m[1]);
  else {
    var s = location.hash.match(/^#same(\d+)$/);
    if (s) openSame(+s[1]);
    else {
      var obs = new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; }) && st.shown < filtered().length) { st.shown += CHUNK; renderGrid(); }
      }, { rootMargin: "700px" });
      obs.observe(document.getElementById("pp-sentinel"));
    }
  }
})();
