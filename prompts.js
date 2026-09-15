/* ===== 提示词库交互层 =====
   数据来自 data/prompts.js 的 window.PROMPTS（源：awesome-gpt-image-2，MIT）
   生图代理地址写在 PP_API（Cloudflare Worker / 国内云函数），留空则按钮只提示不请求。 */
(function () {
  var ALL = window.PROMPTS || [];
  var PP_API = ""; // 例：'https://zhifu-pp.<account>.workers.dev'
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
      '<button class="pp-btn gho" data-run="' + r.id + '">&#9889; 在线试跑</button></div>' +
      '<div id="pp-run-box"></div></div></div>';
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

  /* ---- 在线试跑（走自建代理，Key 不进前端） ---- */
  function runIt(id) {
    var host = document.getElementById("pp-run-box");
    if (!PP_API) {
      host.innerHTML = '<div class="pp-run"><div class="note"><b>生图代理还没接上。</b><br>纯静态站不能放 API Key（view-source 就能拿走），需要一个极薄的服务端代理：Cloudflare Workers 免费额度 10 万次/天，或国内云函数。仓库里 <code>worker/index.js</code> 已写好，部署后把地址填进 <code>prompts.js</code> 顶部的 PP_API 即可。</div></div>';
      return;
    }
    var r = ALL.filter(function (x) { return x.id === id; })[0];
    host.innerHTML = '<div class="pp-run"><input id="pp-extra" placeholder="可选：追加你的主体/配色，拼在提示词后面"><button class="pp-btn pri" id="pp-go">开始生成</button><div class="note" id="pp-note">生成需要十几秒到一分钟，请勿关闭页面。</div></div>';
    document.getElementById("pp-go").onclick = function () {
      var extra = document.getElementById("pp-extra").value.trim();
      document.getElementById("pp-note").textContent = "生成中…";
      fetch(PP_API + "/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: r.p + (extra ? "\n" + extra : "") })
      }).then(function (res) { return res.json(); }).then(function (d) {
        if (d && d.url) {
          document.getElementById("pp-note").textContent = "完成";
          host.querySelector(".pp-run").insertAdjacentHTML("beforeend", '<img src="' + esc(d.url) + '" alt="生成结果">');
        } else {
          document.getElementById("pp-note").textContent = "失败：" + ((d && d.error) || "未知错误");
        }
      }).catch(function (e) { document.getElementById("pp-note").textContent = "请求失败：" + e.message; });
    };
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
  if (!fromHash()) {
    var obs = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; }) && st.shown < filtered().length) {
        st.shown += CHUNK; renderGrid();
      }
    }, { rootMargin: "600px" });
    obs.observe(document.getElementById("pp-sentinel"));
  }
})();
