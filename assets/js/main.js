const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  });

  siteNav.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    siteNav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation menu");
  });
}

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const chatForm = document.querySelector(".chat-form");
const chatLog = document.querySelector(".chat-log");
const chatHistory = [];

function addChatMessage(role, text, sources = []) {
  if (!chatLog) return;
  const message = document.createElement("p");
  message.className = role === "assistant" ? "bot" : "user";
  message.textContent = text;
  chatLog.appendChild(message);

  if (role === "assistant" && sources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "source-list";
    sourceList.textContent = "Official/current sources checked: ";
    sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title || `Source ${index + 1}`;
      sourceList.appendChild(link);
    });
    chatLog.appendChild(sourceList);
  }

  message.scrollIntoView({ block: "nearest" });
}

if (chatForm && chatLog) {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = chatForm.querySelector("input");
    const button = chatForm.querySelector("button");
    const text = input?.value.trim();
    if (!text || !button) return;

    input.value = "";
    button.disabled = true;
    button.textContent = "Asking...";
    addChatMessage("user", text);
    chatHistory.push({ role: "user", text });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory.slice(-6) })
      });
      const data = await response.json();
      const reply = data.reply || data.error || "Sorry, I could not answer right now.";
      addChatMessage("assistant", reply, Array.isArray(data.sources) ? data.sources : []);
      chatHistory.push({ role: "assistant", text: reply });
    } catch {
      addChatMessage("assistant", "I could not connect to the AI advisor. Please try again in a moment.");
    } finally {
      button.disabled = false;
      button.textContent = "Ask";
    }
  });

  document.querySelectorAll(".prompt-chips button").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = chatForm.querySelector("input");
      if (!input) return;
      input.value = chip.textContent || "";
      chatForm.requestSubmit();
    });
  });
}

document.querySelectorAll("[data-calc]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const output = form.querySelector("output");
    const calc = form.dataset.calc;

    if (calc === "subsidy") {
      const cost = Number(data.get("cost")) || 0;
      const rate = Number(data.get("rate")) || 0;
      output.value = `Estimated subsidy: ${money.format(cost * rate / 100)}`;
    }

    if (calc === "emi") {
      const principal = Number(data.get("principal")) || 0;
      const months = Math.max(Number(data.get("months")) || 1, 1);
      const monthlyRate = ((Number(data.get("interest")) || 0) / 100) / 12;
      const emi = monthlyRate === 0
        ? principal / months
        : principal * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
      output.value = `Monthly EMI: ${money.format(emi)}`;
    }

    if (calc === "profit") {
      const revenue = Number(data.get("revenue")) || 0;
      const costs = ["stock", "inputs", "other"].reduce((sum, key) => sum + (Number(data.get(key)) || 0), 0);
      output.value = `Estimated profit: ${money.format(revenue - costs)}`;
    }
  });
});

document.querySelectorAll(".lead-form, .quick-search, .filter-form, .chat-form").forEach((form) => {
  form.addEventListener("submit", (event) => {
    if (form.classList.contains("chat-form")) return;
    if (form.dataset.calc) return;
    event.preventDefault();
    const button = form.querySelector("button");
    if (!button) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Saved";
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  });
});
