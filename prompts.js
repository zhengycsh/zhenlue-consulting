/* ===== 提示词库交互层 =====
   数据来自 data/prompts.js 的 window.PROMPTS（源：awesome-gpt-image-2，MIT）
   生图走 PP_API 指向的代理（QW Pages 上的 Node 服务）：解决跨域 + 统一 OpenAI 兼容格式。
   密钥为「用户自带」模式：Key 只存在用户浏览器 localStorage，随请求发给代理转发上游，代理不落库不计费。 */
(function () {
  var ALL = window.PROMPTS || [];
  var PP_API = "https://zzmeq5c4.qwenwork.host"; // 生图代理；留空则「在线试跑」只提示不请求
  var FAV_KEY = "zhifu_fav_prompts";
  var CHUNK = 48;

  var favs;
  try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch (e) { favs = new Set(); }

  var st = { q: "", cat: "", style: "", scene: "", feat: false, fav: false, sort: "rank", shown: CHUNK };

  var grid = document.getElementById("pp-grid");
  var side = document.getElementById("pp-side");
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
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }
  function counts(field, isList) {
    var m = {};
    ALL.forEach(function (r) {
      var v = isList ? (r[field] || []) : [r[field]];
      (v || []).forEach(function (x) { if (x) m[x] = (m[x] || 0) + 1; });
    });
    return m;
  }
  var CATS = counts("cn"), STYLES = counts("s", true), SCENES = counts("sc", true);

  function list(el, title, map, field) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
    var h = '<div class="pp-group"><div class="pp-gtitle">' + title + "</div>";
    h += '<button class="pp-item' + (st[field] ? "" : " active") + '" data-f="' + field + '" data-v=""><span>全部</span><span class="n">' + ALL.length + "</span></button>";
    keys.forEach(function (k) {
      h += '<button class="pp-item' + (st[field] === k ? " active" : "") + '" data-f="' + field + '" data-v="' + esc(k) + '"><span>' + esc(k) + '</span><span class="n">' + map[k] + "</span></button>";
    });
    return h + "</div>";
  }

  function renderSide() {
    side.innerHTML =
      list(side, "使用场景", CATS, "cat") +
      list(side, "视觉风格", STYLES, "style") +
      list(side, "题材", SCENES, "scene") +
      '<div class="pp-group"><div class="pp-gtitle">快捷</div><div class="pp-switch">' +
      '<button class="pp-sw' + (st.feat ? " on" : "") + '" data-t="feat">&#11088; 只看精选</button>' +
      '<button class="pp-sw fav' + (st.fav ? " on" : "") + '" data-t="fav">&#11088; 我的收藏 ' + favs.size + "</button></div></div>";
  }

  function filtered() {
    var q = st.q.trim().toLowerCase();
    var out = ALL.filter(function (r) {
      if (st.cat && r.cn !== st.cat) return false;
      if (st.style && (r.s || []).indexOf(st.style) < 0) return false;
      if (st.scene && (r.sc || []).indexOf(st.scene) < 0) return false;
      if (st.feat && !r.f) return false;
      if (st.fav && !favs.has(r.id)) return false;
      if (q) {
        var hay = (r.t + " " + r.p + " " + r.cn + " " + (r.s || []).join(" ") + " " + (r.sc || []).join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (st.sort === "new") out.sort(function (a, b) { return b.id - a.id; });
    else if (st.sort === "title") out.sort(function (a, b) { return a.t.localeCompare(b.t, "zh"); });
    else out.sort(function (a, b) { return (b.f - a.f) || (a.id - b.id); });
    return out;
  }

  var CDN = "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data";
  window.ppImgFallback = function (img) {
    var f = img.dataset.fb;
    if (!f) return;
    img.dataset.fb = "";
    img.src = f;
  };

  function card(r) {
    var tags = (r.s || []).slice(0, 2).map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") +
      (r.sc || []).slice(0, 1).map(function (x) { return '<i class="scene">' + esc(x) + "</i>"; }).join("");
    return '<div class="pp-card glass" data-id="' + r.id + '">' +
      (r.f ? '<span class="pp-flag">精选</span>' : "") +
      '<button class="pp-same" data-same="' + r.id + '" title="用这条提示词免费生成一张">&#9889;</button>' +
      '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" data-fav="' + r.id + '" title="收藏">&#9733;</button>' +
      '<img class="pp-thumb" loading="lazy" decoding="async" src="' + esc(r.img) + '" data-fb="' + esc(CDN + r.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '">' +
      '<div class="pp-body"><div class="pp-title">' + esc(r.t) + "</div>" +
      '<div class="pp-desc">' + esc((r.p || "").replace(/\s+/g, " ").slice(0, 90)) + "…</div>" +
      '<div class="pp-tags">' + tags + "</div></div></div>";
  }

  function renderGrid() {
    var rows = filtered();
    bar.innerHTML = "<span><b>" + rows.length + "</b> 条提示词 · 共 " + ALL.length + " 条</span>" +
      '<span class="pp-sort">' +
      ["rank:推荐", "new:最新", "title:标题"].map(function (s) {
        var p = s.split(":");
        return '<button class="pp-sw' + (st.sort === p[0] ? " on" : "") + '" data-sort="' + p[0] + '">' + p[1] + "</button>";
      }).join("") + "</span>";
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

  /* ---- 详情弹层 ---- */
  function markVars(s) {
    return esc(s).replace(/\[([A-Z][A-Z \/][^\]\n]{0,28})\]/g, '<span class="pp-var">[$1]</span>');
  }
  function openDetail(id) {
    var r = ALL.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    box.innerHTML = '<button class="detail-close" data-close>&#10005;</button>' +
      '<span class="d-tag">' + esc(r.cn) + "</span>" +
      '<div class="pp-d-head"><h2>' + esc(r.t) + "</h2>" +
      '<button class="pp-fav' + (favs.has(r.id) ? " on" : "") + '" style="position:static;opacity:1;border:1px solid rgba(0,0,0,.08)" data-fav="' + r.id + '">&#9733; 收藏</button></div>' +
      '<div class="pp-d-grid">' +
      '<div><img class="pp-d-img" src="' + esc(r.img) + '" data-fb="' + esc(CDN + r.oj) + '" onerror="ppImgFallback(this)" alt="' + esc(r.t) + '" loading="lazy">' +
      '<div class="pp-d-meta">来源：' + (r.su ? '<a href="' + esc(r.su) + '" target="_blank" rel="noopener">' + esc(r.sl || r.su) + "</a>" : "—") +
      " · 编号 #" + r.id + ((r.s || []).length ? " · 风格 " + esc(r.s.join(" / ")) : "") + "</div></div>" +
      '<div><div class="pp-plabel">提示词（' + (r.p || "").length + " 字符）</div>" +
      '<div class="pp-prompt" id="pp-prompt">' + markVars(r.p) + "</div>" +
      '<div class="pp-actions">' +
      '<button class="pp-btn pri" data-copy="' + r.id + '">&#128203; 复制提示词</button>' +
      '<button class="pp-btn pri" data-run="' + r.id + '">&#9889; 做同款</button></div></div></div>' +
      '<div id="pp-run-box"></div>';
    if (!showResult(document.getElementById("pp-run-box"), r)) {
      document.getElementById("pp-run-box").innerHTML =
        '<div class="pp-run"><div class="note">点「做同款」用这条提示词让免费智谱 CogView 重画一张（限流时自动切 Agnes），出图后可拖动竖线与原图对比。每个 IP 每分钟一张。</div></div>';
    }
    tickCool();
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
    var r = ALL.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var done = function () { toast("提示词已复制，直接粘到即梦/可灵/GPT Image 就能用"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.p).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = r.p; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中"); }
      document.body.removeChild(ta);
    }
  }

  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favs)));
    document.querySelectorAll('[data-fav="' + id + '"]').forEach(function (b) { b.classList.toggle("on", favs.has(id)); });
    renderSide();
    if (st.fav) renderGrid();
  }

  /* ---- 一键做同款：密钥在代理服务端，前端只发 prompt ---- */
  var COOL_KEY = "zhifu_pp_next";
  var COOL_SEC = 60;
  var genCache = {};
  var coolTimer = null;

  function remain() { return Math.max(0, Math.ceil(((+localStorage.getItem(COOL_KEY) || 0) - Date.now()) / 1000)); }
  function startCooldown(sec) { localStorage.setItem(COOL_KEY, String(Date.now() + sec * 1000)); tickCool(); }
  function tickCool() {
    var left = remain();
    document.querySelectorAll("[data-run]").forEach(function (b) {
      b.disabled = left > 0;
      b.innerHTML = left > 0 ? "&#9203; " + left + " 秒后可再做" : "&#9889; 做同款";
    });
    if (left > 0 && !coolTimer) {
      coolTimer = setInterval(function () {
        tickCool();
        if (remain() <= 0) { clearInterval(coolTimer); coolTimer = null; }
      }, 1000);
    }
  }

  function compareHtml(r, url, via) {
    return '<div class="pp-cmp"><div class="pp-cmp-track" style="--pos:50%">' +
      '<img class="pp-cmp-base" src="' + esc(r.img) + '" data-fb="' + esc(CDN + r.oj) + '" onerror="ppImgFallback(this)" alt="原图">' +
      '<div class="pp-cmp-top"><img src="' + esc(url) + '" alt="AI 同款"></div>' +
      '<div class="pp-cmp-handle"></div>' +
      '<span class="pp-cmp-tag l">原图</span><span class="pp-cmp-tag r">AI 同款</span></div>' +
      '<div class="pp-cmp-foot">按住竖线左右拖动对比 · <a href="' + esc(url) + '" target="_blank" rel="noopener">下载 / 查看大图</a>' +
      (via ? ' · 由 <b>' + esc(via) + '</b> 生成' : '') + '</div></div>';
  }

  function bindCmp(root) {
    root.querySelectorAll(".pp-cmp-track").forEach(function (track) {
      var base = track.querySelector(".pp-cmp-base");
      if (base && !base.dataset.ar) {
        var fit = function () { base.dataset.ar = "1"; if (base.naturalWidth) track.style.aspectRatio = base.naturalWidth + " / " + base.naturalHeight; };
        if (base.complete) fit(); else base.addEventListener("load", fit);
      }
      function set(x) {
        var rect = track.getBoundingClientRect();
        track.style.setProperty("--pos", Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)) + "%");
      }
      track.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        set(e.clientX);
        var mv = function (ev) { set(ev.clientX); };
        var up = function () {
          window.removeEventListener("pointermove", mv);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", mv);
        window.addEventListener("pointerup", up);
      });
    });
  }

  function showResult(host, r) {
    var g = genCache[r.id];
    if (!g) return false;
    host.innerHTML = compareHtml(r, g.url, g.via);
    bindCmp(host);
    return true;
  }

  function runIt(id) {
    var host = document.getElementById("pp-run-box");
    var r = ALL.filter(function (x) { return x.id === id; })[0];
    if (!r || !host) return;
    if (showResult(host, r)) return;
    if (!PP_API) {
      host.innerHTML = '<div class="pp-run"><div class="note">生图代理未配置。</div></div>';
      return;
    }
    if (remain() > 0) {
      host.innerHTML = '<div class="pp-run"><div class="note">免费额度每分钟只跑一张，' + remain() + ' 秒后自动可以再点。</div></div>';
      return;
    }
    host.innerHTML = '<div class="pp-run"><div class="pp-wait"><span class="pp-spin"></span>正在让智谱 CogView 出图，通常 10-40 秒…</div></div>';
    startCooldown(COOL_SEC);
    fetch(PP_API + "/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: r.p })
    }).then(function (res) {
      return res.json().catch(function () { return { error: "代理返回异常 HTTP " + res.status }; });
    }).then(function (d) {
      if (d.url) {
        genCache[r.id] = { url: d.url, via: d.via };
        showResult(host, r);
        var cmp = host.querySelector(".pp-cmp");
        if (cmp && cmp.scrollIntoView) cmp.scrollIntoView({ behavior: "smooth", block: "center" });
        toast("出图完成 · 拖动竖线看原图对比");
      } else {
        host.innerHTML = '<div class="pp-run"><div class="note">失败：' + esc(d.error || "未知错误") +
          (d.tried && d.tried.length ? '<br>通道轨迹：' + esc(d.tried.join(" | ")) : "") + '</div></div>';
        if (d.retryAfter) startCooldown(d.retryAfter);
      }
    }).catch(function (e) {
      host.innerHTML = '<div class="pp-run"><div class="note">连不上生图服务：' + esc(e.message) + '</div></div>';
    });
  }

  /* ---- 事件 ---- */
  side.addEventListener("click", function (e) {
    var it = e.target.closest(".pp-item");
    if (it) { st[it.dataset.f] = it.dataset.v; st.shown = CHUNK; renderSide(); renderGrid(); return; }
    var sw = e.target.closest(".pp-sw[data-t]");
    if (sw) { st[sw.dataset.t] = !st[sw.dataset.t]; st.shown = CHUNK; renderSide(); renderGrid(); }
  });
  bar.addEventListener("click", function (e) {
    var s = e.target.closest("[data-sort]");
    if (s) { st.sort = s.dataset.sort; renderGrid(); }
  });
  input.addEventListener("input", function () { st.q = input.value; st.shown = CHUNK; renderGrid(); });
  grid.addEventListener("click", function (e) {
    var f = e.target.closest("[data-fav]");
    if (f) { e.stopPropagation(); toggleFav(+f.dataset.fav); return; }
    var s = e.target.closest("[data-same]");
    if (s) { e.stopPropagation(); var sid = +s.dataset.same; openDetail(sid); runIt(sid); return; }
    var c = e.target.closest(".pp-card");
    if (c) openDetail(+c.dataset.id);
  });
  mask.addEventListener("click", function (e) {
    if (e.target === mask || e.target.closest("[data-close]")) return closeDetail();
    var cp = e.target.closest("[data-copy]"); if (cp) return copyPrompt(+cp.dataset.copy);
    var rv = e.target.closest("[data-run]"); if (rv) return runIt(+rv.dataset.run);
    var fv = e.target.closest("[data-fav]"); if (fv) return toggleFav(+fv.dataset.fav);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && mask.classList.contains("show")) closeDetail(); });
  var more = document.getElementById("pp-more");
  if (more) more.onclick = function () { st.shown += CHUNK; renderGrid(); };

  /* 深链：#p123 直接打开详情 */
  function fromHash() {
    var m = location.hash.match(/^#p(\d+)$/);
    if (m) { openDetail(+m[1]); return true; }
    return false;
  }

  renderSide();
  renderGrid();
  tickCool();
  if (!fromHash()) {
    var obs = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; }) && st.shown < filtered().length) {
        st.shown += CHUNK; renderGrid();
      }
    }, { rootMargin: "600px" });
    obs.observe(document.getElementById("pp-sentinel"));
  }
})();
