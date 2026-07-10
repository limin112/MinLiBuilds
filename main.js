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
        return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + "M" + suffix;
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

  // Partner terminal: boot animation when scrolled into view
  const partnerTerminal = document.getElementById("partnerTerminal");
  if (partnerTerminal && "IntersectionObserver" in window) {
    const ptIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          partnerTerminal.classList.add("in-view");
          ptIo.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    ptIo.observe(partnerTerminal);
  } else if (partnerTerminal) {
    partnerTerminal.classList.add("in-view");
  }

  // Partner marquee: auto-scroll + drag, seamless loop
  const marquee = document.getElementById("partnerMarquee");
  const track = document.getElementById("partnerTrack");
  if (marquee && track) {
    const firstSet = track.querySelector(".partner-set");
    if (firstSet) {
      const clone = firstSet.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    }

    const autoSpeed = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.5;
    let offset = 0;
    let dragging = false;
    let startX = 0;
    let startOffset = 0;

    const apply = () => {
      const half = track.scrollWidth / 2;
      if (half > 0) offset = ((offset % half) + half) % half;
      track.style.transform = `translateX(${-offset}px)`;
    };

    const tick = () => {
      if (!dragging && autoSpeed) {
        offset += autoSpeed;
        apply();
      }
      requestAnimationFrame(tick);
    };

    marquee.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      startOffset = offset;
      marquee.setPointerCapture(e.pointerId);
      marquee.classList.add("dragging");
    });
    marquee.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      offset = startOffset - (e.clientX - startX);
      apply();
    });
    const endDrag = () => {
      dragging = false;
      marquee.classList.remove("dragging");
    };
    marquee.addEventListener("pointerup", endDrag);
    marquee.addEventListener("pointercancel", endDrag);

    apply();
    requestAnimationFrame(tick);
  }

  // Terminal typewriter
  const phrases = [
    "把模型能力压成每天能用的工作流",
    "能复现、能省 token、能出结果",
    "Claude · Codex · Gemini 一手折腾",
    "不做概念党，只聊 AI 实战",
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
