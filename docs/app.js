"use strict";

(() => {
  const scenarios = {
    directory: {
      command: "bunx serve-rs public/", root: "public/",
      files: ["index.html", "style.css", "assets/"],
      url: "/", response: "index.html", caption: "Your index file, ready to view.",
    },
    file: {
      command: "bunx serve-rs example.html", root: "./",
      files: ["example.html", "style.css", "images/"],
      url: "/", response: "example.html", caption: "A single page, with its relative assets.",
    },
    spa: {
      command: "bunx serve-rs -s dist/", root: "dist/",
      files: ["index.html", "app.js", "assets/"],
      url: "/users/42", response: "index.html", caption: "Your app handles the client-side route.",
    },
  };

  // A single panel keeps examples in the same place while the command changes.
  function setupTabs(container, onSelect) {
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    function select(tab) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
      }
      document.getElementById(tab.getAttribute("aria-controls"))
        .setAttribute("aria-labelledby", tab.id);
      onSelect(tab);
    }
    container.addEventListener("click", (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) select(tab);
    });
    container.addEventListener("keydown", (event) => {
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      let next;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      tabs[next].focus();
      select(tabs[next]);
    });
  }

  setupTabs(document.querySelector(".scenario-tabs"), (tab) => {
    const scenario = scenarios[tab.dataset.scenario];
    document.getElementById("preview-command").textContent = scenario.command;
    document.querySelector("#preview-tree .tree-root span").textContent = scenario.root;
    document.querySelectorAll("#preview-tree .tree-file").forEach((row, index) => {
      const branch = document.createElement("span");
      branch.textContent = index === scenario.files.length - 1 ? "└─" : "├─";
      row.replaceChildren(branch, document.createTextNode(" " + scenario.files[index]));
    });
    document.getElementById("preview-url").textContent = scenario.url;
    document.getElementById("preview-response").textContent = scenario.response;
    document.getElementById("preview-caption").textContent = scenario.caption;
  });

  setupTabs(document.querySelector(".runtime-tabs"), (tab) => {
    const prefix = { bun: "bunx serve-rs", npm: "npx serve-rs", rust: "cargo run --" }[tab.dataset.runtime];
    const output = document.getElementById("quickstart-command");
    const first = document.createElement("span");
    first.className = "code-comment";
    first.textContent = "# Serve a directory";
    const second = first.cloneNode();
    second.textContent = "# Or a single HTML file";
    output.replaceChildren(
      first, document.createTextNode("\n" + prefix + " public/\n\n"),
      second, document.createTextNode("\n" + prefix + " example.html"),
    );
  });

  const status = document.getElementById("copy-status");
  let statusTimer;
  function announce(message) {
    clearTimeout(statusTimer);
    status.hidden = false;
    status.textContent = message;
    statusTimer = setTimeout(() => { status.hidden = true; }, 3500);
  }
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("aria-label", "Command to copy");
    input.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(input);
    const previousFocus = document.activeElement;
    input.select();
    let copied;
    try { copied = document.execCommand("copy"); }
    finally { input.remove(); previousFocus?.focus({ preventScroll: true }); }
    if (!copied) throw new Error("Clipboard access unavailable");
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-target]");
    if (!button || button.disabled) return;
    const code = document.getElementById(button.dataset.copyTarget);
    button.disabled = true;
    try {
      await copyText(code.textContent.trim());
      const label = button.querySelector("span");
      const icon = button.querySelector("use");
      label.textContent = "Copied";
      icon.setAttribute("href", "#icon-check");
      announce("Command copied to clipboard.");
      setTimeout(() => { label.textContent = "Copy"; icon.setAttribute("href", "#icon-copy"); }, 1800);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      announce("Clipboard unavailable. The command is selected so you can copy it.");
    } finally {
      button.disabled = false;
    }
  });

  const searchDialog = document.getElementById("search-dialog");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");
  const mobileDialog = document.getElementById("mobile-navigation");
  document.getElementById("mobile-nav-content")
    .append(document.querySelector(".docs-nav").cloneNode(true));

  for (const dialog of [searchDialog, mobileDialog]) {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
    });
    dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
  const sections = [...document.querySelectorAll(".doc-section")];
  const searchIndex = sections.map((section) => {
    const label = document.querySelector('.sidebar a[href="#' + section.id + '"]').textContent.trim();
    const description = section.querySelector(":scope > p")?.textContent.trim() ?? "Solutions for common serving issues.";
    return {
      id: section.id, title: label,
      keywords: section.dataset.searchTitle.toLowerCase(),
      description, text: section.textContent.toLowerCase(),
    };
  });

  function renderSearch() {
    const query = searchInput.value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const results = searchIndex
      .map((page) => ({
        ...page,
        score: words.length === 0 ? 1 : words.every((word) => page.text.includes(word) || page.keywords.includes(word))
          ? words.reduce((score, word) => score + (page.title.toLowerCase().includes(word) ? 8 : page.keywords.includes(word) ? 4 : 1), 0)
          : 0,
      }))
      .filter((page) => page.score > 0)
      .sort((a, b) => b.score - a.score);
    searchResults.replaceChildren();
    for (const page of results) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + page.id;
      const title = document.createElement("strong");
      title.textContent = page.title;
      const description = document.createElement("span");
      description.textContent = page.description.length > 130 ? page.description.slice(0, 127) + "…" : page.description;
      const arrow = document.querySelector(".back-to-top .icon").cloneNode(true);
      link.append(title, description, arrow);
      link.addEventListener("click", () => {
        searchDialog.close();
        const heading = document.getElementById(page.id).querySelector("h1, h2");
        heading.tabIndex = -1;
        requestAnimationFrame(() => heading.focus({ preventScroll: true }));
      });
      item.append(link);
      searchResults.append(item);
    }
    document.getElementById("search-empty").hidden = results.length !== 0;
    document.getElementById("search-result-count").textContent = query
      ? results.length + (results.length === 1 ? " section found" : " sections found")
      : "Jump to a section";
  }
  function openSearch() {
    if (mobileDialog.open) mobileDialog.close();
    renderSearch();
    if (!searchDialog.open) searchDialog.showModal();
    searchInput.focus();
    searchInput.select();
  }
  document.querySelectorAll("[data-open-search]").forEach((button) => button.addEventListener("click", openSearch));
  searchInput.addEventListener("input", renderSearch);
  searchDialog.addEventListener("keydown", (event) => {
    const links = [...searchResults.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!links.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = index === -1 ? (direction === 1 ? 0 : links.length - 1)
        : (index + direction + links.length) % links.length;
      links[next].focus();
    } else if (event.key === "Enter" && document.activeElement === searchInput && links.length) {
      event.preventDefault();
      links[0].click();
    } else if ((event.key === "Home" || event.key === "End") && index >= 0) {
      event.preventDefault();
      links[event.key === "Home" ? 0 : links.length - 1]?.focus();
    }
  });
  document.addEventListener("keydown", (event) => {
    const typing = event.target.matches("input, textarea, select, [contenteditable]");
    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      event.preventDefault();
      openSearch();
    }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    document.querySelector("[data-search-shortcut]").textContent = "⌘ K";
  }

  document.getElementById("menu-toggle").addEventListener("click", () => mobileDialog.showModal());
  mobileDialog.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => mobileDialog.close()));
  window.matchMedia("(min-width: 761px)").addEventListener("change", (event) => {
    if (event.matches && mobileDialog.open) mobileDialog.close();
  });

  const navigationLinks = [...document.querySelectorAll(".docs-nav a, .page-outline nav a")];
  let ticking = false;
  function updateReadingPosition() {
    const marker = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) + 44;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= marker) current = section;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1);
    for (const link of navigationLinks) {
      if (link.hash === "#" + current.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    const reference = ["cli-reference", "http-behavior"].includes(current.id);
    document.querySelectorAll('.header-nav a[href^="#"]').forEach((link) => {
      link.classList.toggle("selected", link.hash === (reference ? "#cli-reference" : "#quickstart"));
    });
    ticking = false;
  }
  window.addEventListener("scroll", () => {
    if (!ticking) { requestAnimationFrame(updateReadingPosition); ticking = true; }
  }, { passive: true });
  window.addEventListener("resize", updateReadingPosition);
  document.documentElement.classList.add("js");
  updateReadingPosition();
})();
