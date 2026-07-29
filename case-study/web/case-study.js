const caseStudyContent = globalThis.caseStudyContent;
if (!caseStudyContent) {
  throw new Error("Missing generated Case Study content.");
}

const LANGUAGE_CONFIG = {
  zh: {
    htmlLang: "zh-CN",
    status: "已切换为中文",
    boundary: "外部用户验证待进行",
    roleLabel: "角色",
    stageLabel: "阶段",
    boundaryLabel: "验证边界",
    evidenceLabel: "证据",
    sectionLabel: "章节",
    galleryLabel: "产品界面证据",
    quickReadLabel: "招聘方 3 分钟速览",
    quickReadAction: "3 分钟速览",
    fullCaseAction: "查看完整案例",
    pdfAction: "下载中文 PDF",
    githubAction: "GitHub 项目",
    footerLabel: "继续查看"
  },
  en: {
    htmlLang: "en",
    status: "Switched to English",
    boundary: "External validation pending",
    roleLabel: "Role",
    stageLabel: "Stage",
    boundaryLabel: "Validation boundary",
    evidenceLabel: "Evidence",
    sectionLabel: "Section",
    galleryLabel: "Product interface evidence",
    quickReadLabel: "Three-minute recruiter overview",
    quickReadAction: "3-minute overview",
    fullCaseAction: "Read full case study",
    pdfAction: "Download English PDF",
    githubAction: "GitHub project",
    footerLabel: "Continue exploring"
  }
};

const DIAGRAMS = {
  reframe: "category-boundary.svg",
  loop: "product-loop.svg",
  system: "memory-system.svg",
  validation: "validation-layers.svg"
};

const SCREENSHOTS = ["now", "learn", "actions", "memory", "management", "achievements"];
const contentNode = document.querySelector("#case-study-content");
const navNode = document.querySelector("#case-study-nav");
const footerNode = document.querySelector("#case-study-footer");
const statusNode = document.querySelector("#language-status");
const headerNode = document.querySelector(".site-header");
const languageButtons = [...document.querySelectorAll("[data-language]")];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstHeading(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector("h2")?.textContent?.trim() || "";
}

function diagramFigure(sectionId, lang) {
  const file = DIAGRAMS[sectionId];
  if (!file) return "";
  const alt = {
    zh: {
      reframe: "Margin 产品类别边界图",
      loop: "Margin 核心产品闭环图",
      system: "状态聚合与选择性记忆系统图",
      validation: "已实现、场景验证与假设三层边界图"
    },
    en: {
      reframe: "Margin product category boundaries",
      loop: "Margin core product loop",
      system: "State aggregation and selective memory system",
      validation: "Implemented, scenario-validated, and hypothesis boundaries"
    }
  }[lang][sectionId];
  return `
    <figure class="evidence-figure evidence-figure--wide">
      <img src="../assets/diagrams/${file}" alt="${alt}">
      <figcaption>${alt}</figcaption>
    </figure>
  `;
}

function screenshotGallery(lang) {
  const labels = {
    zh: ["此刻", "学习", "行动", "记忆", "整理", "成就"],
    en: ["Now", "Learn", "Actions", "Memory", "Management", "Achievements"]
  }[lang];
  return `
    <div class="screen-gallery" aria-label="${LANGUAGE_CONFIG[lang].galleryLabel}">
      ${SCREENSHOTS.map((name, index) => `
        <figure class="evidence-figure">
          <img src="../assets/screenshots/${name}.png" alt="Margin ${labels[index]} ${lang === "zh" ? "页面" : "view"}">
          <figcaption><span>UI ${String(index + 1).padStart(2, "0")}</span>${labels[index]}</figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function renderHero(meta, quickRead, resources, lang) {
  const labels = LANGUAGE_CONFIG[lang];
  return `
    <section class="case-hero" aria-labelledby="case-title">
      <p class="eyebrow">AI PRODUCT CASE STUDY · ${escapeHtml(meta.year)}</p>
      <h1 id="case-title">${escapeHtml(meta.title)}</h1>
      <p class="case-subtitle">${escapeHtml(meta.subtitle)}</p>
      <dl class="fact-strip">
        <div><dt>${labels.roleLabel}</dt><dd>${escapeHtml(meta.role)}</dd></div>
        <div><dt>${labels.stageLabel}</dt><dd>${escapeHtml(meta.stage)}</dd></div>
        <div><dt>${labels.boundaryLabel}</dt><dd>${labels.boundary}</dd></div>
      </dl>
      <nav class="hero-actions" aria-label="${labels.footerLabel}">
        <a class="case-link case-link--primary" href="#recruiter-summary" data-case-anchor="recruiter-summary">${labels.quickReadAction}</a>
        <a class="case-link" href="#${resources.fullCaseAnchor}" data-case-anchor="${resources.fullCaseAnchor}">${labels.fullCaseAction}</a>
        <a class="case-link" href="${resources.pdf[lang]}" download>${labels.pdfAction}</a>
        <a class="case-link case-link--text" href="${resources.github}" rel="noreferrer">${labels.githubAction}</a>
      </nav>
      <p class="hero-footnote">${escapeHtml(
        quickRead?.summary
        || (lang === "zh"
          ? "一份关于定位、取舍、AI 行为与证据边界的独立产品记录"
          : "An independent product record of positioning, trade-offs, AI behavior, and evidence boundaries")
      )}</p>
    </section>
  `;
}

function evidencePill(label, text) {
  return `
    <div class="boundary-card">
      <strong>${escapeHtml(label)}</strong>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function renderRecruiterFallback(lang) {
  console.error("Missing recruiter quick-read content.", { lang });
  return `
    <section class="recruiter-summary recruiter-summary--fallback" id="recruiter-summary">
      <p>${lang === "zh"
        ? "招聘速览暂时不可用，请继续阅读下方完整案例。"
        : "The recruiter overview is temporarily unavailable. Continue with the full case study below."}</p>
    </section>
  `;
}

function renderQuickRead(quickRead, lang) {
  if (!quickRead) return renderRecruiterFallback(lang);
  const labels = LANGUAGE_CONFIG[lang];
  return `
    <section class="recruiter-summary" id="recruiter-summary" aria-labelledby="quick-read-title">
      <p class="eyebrow">${escapeHtml(quickRead.label)}</p>
      <h2 id="quick-read-title">${escapeHtml(quickRead.title)}</h2>
      <div class="quick-read-grid">
        <article class="quick-read-problem">
          <p class="section-index">01 / PROBLEM</p>
          <h3>${escapeHtml(quickRead.problem.title)}</h3>
          <p>${escapeHtml(quickRead.problem.body)}</p>
        </article>
        <article class="quick-read-decisions">
          <p class="section-index">02 / DECISIONS</p>
          <div class="decision-grid">
            ${quickRead.decisions.map((decision, index) => `
              <section>
                <span>${String(index + 1).padStart(2, "0")}</span>
                <h3>${escapeHtml(decision.title)}</h3>
                <p>${escapeHtml(decision.body)}</p>
                <p class="decision-evidence">${decision.evidenceIds
                  .map((id) => `<span class="evidence-id">${escapeHtml(id)}</span>`)
                  .join("")}</p>
              </section>
            `).join("")}
          </div>
        </article>
        <article class="quick-read-delivery">
          <p class="section-index">03 / DELIVERY</p>
          <h3>${escapeHtml(quickRead.delivery.title)}</h3>
          <p>${escapeHtml(quickRead.delivery.body)}</p>
          <ul>${quickRead.delivery.items
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>
        </article>
        <article class="quick-read-evidence">
          <p class="section-index">04 / EVIDENCE</p>
          <h3>${escapeHtml(quickRead.evidence.title)}</h3>
          <p>${escapeHtml(quickRead.evidence.body)}</p>
          <div class="boundary-grid">
            ${evidencePill("Implemented", quickRead.evidence.implemented)}
            ${evidencePill("Scenario-validated", quickRead.evidence.scenarioValidated)}
            ${evidencePill("Hypothesis", quickRead.evidence.hypothesis)}
          </div>
        </article>
      </div>
      <p class="quick-read-end">
        <a class="case-link case-link--text" href="#overview" data-case-anchor="overview">${labels.fullCaseAction}</a>
      </p>
    </section>
  `;
}

function renderFooter(resources, lang) {
  const labels = LANGUAGE_CONFIG[lang];
  return `
    <p class="eyebrow">${labels.footerLabel}</p>
    <div class="footer-links">
      <a class="case-link" href="${resources.pdf.zh}" download>中文 PDF</a>
      <a class="case-link" href="${resources.pdf.en}" download>English PDF</a>
      <a class="case-link case-link--text" href="${resources.github}" rel="noreferrer">${labels.githubAction}</a>
    </div>
  `;
}

function renderSection(section, index, lang) {
  const evidence = section.evidenceIds
    .map((id) => `<span class="evidence-id">${id}</span>`)
    .join("");
  const visual = diagramFigure(section.id, lang)
    || (section.id === "experience" ? screenshotGallery(lang) : "");
  return `
    <section class="case-section" id="${section.id}" data-section="${section.id}">
      <p class="section-index">${LANGUAGE_CONFIG[lang].sectionLabel} ${String(index + 1).padStart(2, "0")}</p>
      <div class="section-copy">${section.html}</div>
      ${visual}
      <aside class="evidence-note" aria-label="${LANGUAGE_CONFIG[lang].evidenceLabel}">
        <strong>${LANGUAGE_CONFIG[lang].evidenceLabel}</strong>${evidence}
      </aside>
    </section>
  `;
}

function renderNav(sections, lang) {
  navNode.innerHTML = `
    <ol>
      ${sections.map((section, index) => `
        <li>
          <a href="#${section.id}" data-nav-section="${section.id}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <span>${firstHeading(section.html).replace(/^\d+\.\s*/, "")}</span>
          </a>
        </li>
      `).join("")}
    </ol>
  `;
  navNode.setAttribute("aria-label", lang === "zh" ? "Case Study 章节" : "Case study sections");
}

function headerOffset() {
  const mobileRail = window.matchMedia("(max-width: 860px)").matches ? 52 : 0;
  return headerNode.getBoundingClientRect().height + mobileRail + 16;
}

function currentSectionAnchor() {
  const sections = [...document.querySelectorAll("[data-section]")];
  if (!sections.length) return null;
  const threshold = headerOffset() + 24;
  const firstTop = sections[0].getBoundingClientRect().top;
  if (firstTop > threshold) {
    return { id: null, scrollY: window.scrollY };
  }
  const current = sections.reduce((selected, section) => {
    const top = section.getBoundingClientRect().top;
    return top <= threshold ? section : selected;
  }, sections[0]);
  return {
    id: current.id,
    viewportTop: current.getBoundingClientRect().top
  };
}

function scrollToSection(id, { updateHash = true, viewportTop = null } = {}) {
  const target = document.getElementById(id);
  if (!target) return;
  const desiredTop = viewportTop ?? headerOffset();
  const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - desiredTop);
  window.scrollTo({ top, behavior: "auto" });
  if (updateHash) history.replaceState(null, "", `#${id}`);
}

function bindNavigation() {
  for (const link of navNode.querySelectorAll("[data-nav-section]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToSection(link.dataset.navSection);
    });
  }
}

function bindPageAnchors() {
  for (const link of document.querySelectorAll("[data-case-anchor]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToSection(link.dataset.caseAnchor);
    });
  }
}

function renderLanguage(lang) {
  const { meta, quickRead, sections } = caseStudyContent[lang];
  const { resources } = caseStudyContent;
  document.documentElement.lang = LANGUAGE_CONFIG[lang].htmlLang;
  document.documentElement.dataset.activeLanguage = lang;
  contentNode.innerHTML = renderHero(meta, quickRead, resources, lang)
    + renderQuickRead(quickRead, lang)
    + sections.map((section, index) => renderSection(section, index, lang)).join("");
  footerNode.innerHTML = renderFooter(resources, lang);
  renderNav(sections, lang);
  bindNavigation();
  bindPageAnchors();
  for (const button of languageButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.language === lang));
  }
}

function setLanguage(lang, { announce = true, preservePosition = true } = {}) {
  const safeLang = caseStudyContent[lang] ? lang : "zh";
  const anchor = preservePosition ? currentSectionAnchor() : null;
  renderLanguage(safeLang);
  try {
    sessionStorage.setItem("margin-case-study-language", safeLang);
  } catch {
    // The static page still works when storage is unavailable.
  }
  if (announce) statusNode.textContent = LANGUAGE_CONFIG[safeLang].status;
  if (anchor) {
    requestAnimationFrame(() => {
      if (anchor.id) {
        scrollToSection(anchor.id, {
          updateHash: Boolean(location.hash),
          viewportTop: anchor.viewportTop
        });
      } else {
        window.scrollTo({ top: anchor.scrollY, behavior: "auto" });
      }
    });
  }
}

for (const button of languageButtons) {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
}

document.querySelector(".wordmark").addEventListener("click", (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: "auto" });
  history.replaceState(null, "", `${location.pathname}${location.search}`);
});

let initialLanguage = "zh";
try {
  initialLanguage = sessionStorage.getItem("margin-case-study-language") || "zh";
} catch {
  initialLanguage = "zh";
}
setLanguage(initialLanguage, { announce: false, preservePosition: false });

if (location.hash) {
  requestAnimationFrame(() => scrollToSection(location.hash.slice(1), { updateHash: false }));
}
