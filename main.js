(() => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Mobile nav
  const toggle = document.getElementById("navToggle");
  const drawer = document.getElementById("mobileDrawer");
  if (toggle && drawer) {
    const setOpen = (open) => {
      drawer.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    };

    toggle.addEventListener("click", () => setOpen(drawer.hidden));
    drawer.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setOpen(false));
    });
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
      setTimeout(tick, 500);
    }
  }

  // Copy handle
  const copyBtn = document.getElementById("copyHandle");
  const copyHint = document.getElementById("copyHint");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = copyBtn.dataset.copy || "@MinLiBuilds";
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add("copied");
        if (copyHint) copyHint.textContent = "已复制 ✓";
        setTimeout(() => {
          copyBtn.classList.remove("copied");
          if (copyHint) copyHint.textContent = "点击复制 X 账号";
        }, 1800);
      } catch {
        if (copyHint) copyHint.textContent = "复制失败，请手动选择";
      }
    });
  }

  // Brief helpers
  const form = document.getElementById("briefForm");
  const status = document.getElementById("formStatus");
  const copyBriefBtn = document.getElementById("copyBrief");

  const buildBrief = (data) => {
    return [
      "【商务合作 Brief · MinLiBuilds】",
      `品牌/姓名：${data.brand || "-"}`,
      `联系方式：${data.reach || "-"}`,
      `产品链接：${data.product || "-"}`,
      `合作形式：${data.type || "-"}`,
      `预算区间：${data.budget || "未填"}`,
      `需求说明：${data.note || "-"}`,
      "",
      "来自个人站 brief 表单",
    ].join("\n");
  };

  const readForm = () => {
    if (!form) return {};
    const fd = new FormData(form);
    return Object.fromEntries(fd.entries());
  };

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = readForm();
      if (!data.brand || !data.reach) {
        if (status) status.textContent = "请至少填写品牌和联系方式";
        return;
      }
      const body = encodeURIComponent(buildBrief(data));
      const subject = encodeURIComponent(`商务合作 · ${data.brand} × MinLiBuilds`);
      // Placeholder mailbox — user can replace with real address later
      window.location.href = `mailto:hello@minlibuilds.com?subject=${subject}&body=${body}`;
      if (status) status.textContent = "已打开邮件草稿，可改收件邮箱后发送";
    });
  }

  if (copyBriefBtn) {
    copyBriefBtn.addEventListener("click", async () => {
      const data = readForm();
      const text = buildBrief(data);
      try {
        await navigator.clipboard.writeText(text);
        if (status) status.textContent = "Brief 已复制，可直接贴到 X DM";
      } catch {
        if (status) status.textContent = "复制失败，请手动选择文本";
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
