export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines) {
  const [header, , ...rows] = lines.map(tableCells);
  const head = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<div class="table-scroll" role="region" aria-label="Data table" tabindex="0"><table>${head}${body}</table></div>`;
}

export function renderMarkdown(markdown) {
  const lines = markdown.trim().split(/\r?\n/);
  const blocks = [];
  let list = [];
  let listType = null;
  let paragraph = [];

  const flushList = () => {
    if (list.length) {
      const tag = listType === "ordered" ? "ol" : "ul";
      blocks.push(`<${tag}>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      list = [];
      listType = null;
    }
  };

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (
      /^\|/.test(trimmed)
      && lines[index + 1]
      && isTableDivider(lines[index + 1])
    ) {
      flushParagraph();
      flushList();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && /^\|/.test(lines[index].trim())) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push(renderTable(tableLines));
      continue;
    }

    if (!trimmed || /^<!--/.test(trimmed) || /^---$/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^###\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${renderInline(line.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }

    if (/^##\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${renderInline(line.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (/^-\s+/.test(line)) {
      flushParagraph();
      if (listType && listType !== "unordered") flushList();
      listType = "unordered";
      list.push(line.replace(/^-\s+/, ""));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      if (listType && listType !== "ordered") flushList();
      listType = "ordered";
      list.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}
