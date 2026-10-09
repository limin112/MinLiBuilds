(() => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Mobile nav
  const toggle = document.getElementById("navToggle");
  const drawer = document.getElementById("mobileDrawer");
  if (toggle && drawer) {
    const setOpen = (open) => {
      drawer.hidden = !open;
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    };

    toggle.addEventListener("click", () => setOpen(drawer.hidden));
    drawer.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setOpen(false));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !drawer.hidden) setOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (!drawer.hidden && !drawer.contains(e.target) && !toggle.contains(e.target)) {
        setOpen(false);
      }
    });
  }

  // Stats count-up
  const statNums = document.querySelectorAll(".stat-num[data-count]");
  const reduceMotionStats = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (statNums.length && !reduceMotionStats && "IntersectionObserver" in window) {
    const formatStat = (value, el) => {
      const suffix = el.dataset.suffix || "";
      if (el.dataset.format === "m" && value >= 100000) {
        const m = value / 1000000;
        const digits = Number(el.dataset.digits);
        const places = Number.isFinite(digits) ? digits : 1;
        if (m >= 10) return Math.round(m) + "M" + suffix;
        const factor = 10 ** places;
        return Math.round(m * factor) / factor + "M" + suffix;
      }
      if (el.dataset.format === "k" && value >= 1000) {
        const k = value / 1000;
        return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "K" + suffix;
      }
      return Math.round(value).toLocaleString() + suffix;
    };

    const animate = (el) => {
      const target = Number(el.dataset.count);
      if (!Number.isFinite(target)) return;
      const duration = 1200;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = formatStat(target * eased, el);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const statIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(entry.target);
            statIo.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    statNums.forEach((el) => statIo.observe(el));
  }

  // Posts grid: sort by views / date, show 12 first
  const logGrid = document.getElementById("logGrid");
  const logMore = document.getElementById("logMore");
  if (logGrid) {
    const LIMIT = 12;
    const cards = Array.from(logGrid.querySelectorAll(".log-card"));
    if (logMore && cards.length > LIMIT) {
      logGrid.classList.add("is-collapsed");
      logMore.hidden = false;
      logMore.addEventListener("click", () => {
        logGrid.classList.remove("is-collapsed");
        logMore.hidden = true;
      });
    }

    const sorters = {
      views: (a, b) => Number(b.dataset.views) - Number(a.dataset.views),
      date: (a, b) => b.dataset.date.localeCompare(a.dataset.date),
    };
    document.querySelectorAll(".log-sort").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sorter = sorters[btn.dataset.sort];
        if (!sorter) return;
        cards.sort(sorter).forEach((card) => logGrid.appendChild(card));
        document.querySelectorAll(".log-sort").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-pressed", String(on));
        });
      });
    });
  }

  // Terminal typewriter
  const phrases = [
    "# 新模型发布，当天上手测",
    "# 数字都来自自己的卡",
    "# Claude · Codex · Grok · Gemini · 开源模型",
    "# 能复现，才发出来",
  ];
  const typed = document.getElementById("typedText");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (typed) {
    if (reduceMotion) {
      typed.textContent = phrases[0];
    } else {
      let pi = 0;
      let ci = 0;
      let deleting = false;

      const tick = () => {
        const full = phrases[pi];
        if (!deleting) {
          ci += 1;
          typed.textContent = full.slice(0, ci);
          if (ci >= full.length) {
            deleting = true;
            setTimeout(tick, 1800);
            return;
          }
          setTimeout(tick, 42 + Math.random() * 30);
        } else {
          ci -= 1;
          typed.textContent = full.slice(0, ci);
          if (ci <= 0) {
            deleting = false;
            pi = (pi + 1) % phrases.length;
            setTimeout(tick, 320);
            return;
          }
          setTimeout(tick, 24);
        }
      };
      setTimeout(tick, 2300);
    }
  }

  // Copy email
  const copyBtn = document.getElementById("copyEmail");
  const copyHint = document.getElementById("copyHint");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = copyBtn.dataset.copy || "uslimin@gmail.com";
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add("copied");
        if (copyHint) copyHint.textContent = "已复制 ✓";
        setTimeout(() => {
          copyBtn.classList.remove("copied");
          if (copyHint) copyHint.textContent = "点击复制邮箱";
        }, 1800);
      } catch {
        if (copyHint) copyHint.textContent = "复制失败，请手动选择";
      }
    });
  }

  // Hide mobile CTA when contact is in view
  const mobileCta = document.getElementById("mobileCta");
  const contact = document.getElementById("contact");
  if (mobileCta && contact && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        mobileCta.style.opacity = entry.isIntersecting ? "0" : "1";
        mobileCta.style.pointerEvents = entry.isIntersecting ? "none" : "auto";
      },
      { threshold: 0.15 }
    );
    io.observe(contact);
  }
})();
