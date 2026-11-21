// SPDX-License-Identifier: Apache-2.0
// The search page's filter (docs/design/engine-site.md, 6.3). No request, no storage, no cookie, no timer beyond one frame.
const KINDS = ["Function", "Class", "Constant", "Type"];
const LIMIT = 50;

/** Whether every term occurs in the text (both lower-cased). */
export function matches(text, terms) {
  return terms.every((term) => text.includes(term));
}

/** 0 exact name, 1 name starts with the query, 2 query starts a word inside the name, 3 any other match. */
export function rank(name, query) {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  for (let i = 1; i < name.length; i++) {
    const start = /[-_/. ]/.test(name[i - 1]) || (/[A-Z]/.test(name[i]) && /[a-z0-9]/.test(name[i - 1]));
    if (start && lower.startsWith(query, i)) return 2;
  }
  return 3;
}

/** Sort key: rank, then functions, classes, constants, types, then the name. */
export function compare(a, b) {
  return a.rank - b.rank || a.kind - b.kind || a.name.localeCompare(b.name);
}

function setUp() {
  const field = document.getElementById("sq");
  const status = document.getElementById("search-status");
  document.getElementById("noscript-note")?.remove();
  const lists = [...document.querySelectorAll("section[data-list]")].map((section) => {
    const rows = [...section.querySelectorAll("li")].filter((li) => li.querySelector(".what")).map((li) => {
      const name = li.querySelector("a").textContent;
      const what = li.querySelector(".what").textContent;
      const kind = KINDS.indexOf(what.split(" ")[0]);
      return { li, home: li.parentNode, name, text: `${name} ${what}`.toLowerCase(), kind: kind < 0 ? KINDS.length : kind };
    });
    const live = document.createElement("ul");
    live.className = "results";
    live.hidden = true;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "quiet";
    more.hidden = true;
    section.append(live, more);
    const index = [...section.children].filter((child) => child.tagName !== "H2" && child !== live && child !== more);
    const list = { section, rows, live, more, index, shown: [], all: false };
    more.addEventListener("click", () => { list.all = true; show(list); more.focus(); });
    return list;
  });

  function show(list) {
    const visible = list.all ? list.shown : list.shown.slice(0, LIMIT);
    list.live.replaceChildren(...visible.map((row) => row.li));
    list.more.hidden = visible.length === list.shown.length;
    list.more.textContent = `Show all ${list.shown.length}`;
  }

  function restore(list) {
    for (const row of list.rows) row.home.append(row.li);
    list.live.hidden = true;
    list.more.hidden = true;
    list.section.hidden = false;
    for (const element of list.index) element.hidden = false;
  }

  function filter() {
    const query = field.value.trim().toLowerCase().replace(/\s+/g, " ");
    const url = new URL(location.href);
    if (query) url.searchParams.set("q", field.value.trim()); else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    if (!query) {
      lists.forEach(restore);
      status.textContent = "";
      return;
    }
    const terms = query.split(" ");
    const compact = query.replace(/ /g, "");
    const counts = [];
    for (const list of lists) {
      list.all = false;
      list.shown = list.rows.filter((row) => matches(row.text, terms))
        .map((row) => Object.assign(row, { rank: rank(row.name, compact) })).sort(compare);
      for (const element of list.index) element.hidden = true;
      list.live.hidden = false;
      list.section.hidden = list.shown.length === 0;
      show(list);
      counts.push(list.shown.length);
    }
    const total = counts.reduce((sum, n) => sum + n, 0);
    const words = [["task", "tasks"], ["export", "exports"], ["module", "modules"], ["guide section", "guide sections"]];
    const parts = counts.map((n, i) => (n ? `${n} ${words[i][n === 1 ? 0 : 1]}` : "")).filter(Boolean);
    const said = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    status.textContent = total
      ? `${total} ${total === 1 ? "match" : "matches"} for “${field.value.trim()}”: ${said}.`
      : `No matches for “${field.value.trim()}”. Check the spelling, or browse the API index.`;
  }

  let frame = 0;
  field.addEventListener("input", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(filter);
  });
  field.form.addEventListener("submit", (event) => { event.preventDefault(); filter(); });
  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    field.value = query;
    filter();
  }
}

if (typeof document !== "undefined") setUp();
