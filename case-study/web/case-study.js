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
    galleryLabel: "产品界面证据"
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
    galleryLabel: "Product interface evidence"
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
const statusNode = document.querySelector("#language-status");
const headerNode = document.querySelector(".site-header");
const languageButtons = [...document.querySelectorAll("[data-language]")];

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

function renderHero(meta, lang) {
  const labels = LANGUAGE_CONFIG[lang];
  return `
    <section class="case-hero" aria-labelledby="case-title">
      <p class="eyebrow">AI PRODUCT CASE STUDY · ${meta.year}</p>
      <h1 id="case-title">${meta.title}</h1>
      <p class="case-subtitle">${meta.subtitle}</p>
      <dl class="fact-strip">
        <div><dt>${labels.roleLabel}</dt><dd>${meta.role}</dd></div>
        <div><dt>${labels.stageLabel}</dt><dd>${meta.stage}</dd></div>
        <div><dt>${labels.boundaryLabel}</dt><dd>${labels.boundary}</dd></div>
      </dl>
      <p class="hero-footnote">${lang === "zh"
        ? "一份关于定位、取舍、AI 行为与证据边界的独立产品记录"
        : "An independent product record of positioning, trade-offs, AI behavior, and evidence boundaries"}</p>
    </section>
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

function renderLanguage(lang) {
  const { meta, sections } = caseStudyContent[lang];
  document.documentElement.lang = LANGUAGE_CONFIG[lang].htmlLang;
  document.documentElement.dataset.activeLanguage = lang;
  contentNode.innerHTML = renderHero(meta, lang)
    + sections.map((section, index) => renderSection(section, index, lang)).join("");
  renderNav(sections, lang);
  bindNavigation();
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
    requestAnimationFrame(() => scrollToSection(anchor.id, {
      updateHash: Boolean(location.hash),
      viewportTop: anchor.viewportTop
    }));
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
