const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const envPath = path.join(root, ".env");
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const officialDomains = [
  ".gov.in",
  ".nic.in",
  "myscheme.gov.in",
  "pmkisan.gov.in",
  "pmkusum.mnre.gov.in",
  "nabard.org"
];

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  env.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  });
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function toGeminiContents(messages) {
  const recent = messages.slice(-6);
  return recent.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: String(message.text || "").slice(0, 900) }]
  }));
}

function isOfficialSource(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return officialDomains.some((domain) => hostname.endsWith(domain) || hostname === domain);
  } catch {
    return false;
  }
}

function liveLookupUnavailableReply() {
  return [
    "I could not verify live official government scheme information right now.",
    "To avoid giving outdated or expired scheme advice, please check these official places:",
    "- myscheme.gov.in",
    "- Tripura / your state Agriculture, Animal Resources, Fisheries, Dairy or Horticulture department portal",
    "- nearest Krishi Vigyan Kendra, agriculture office, livestock office, fishery office or CSC",
    "Ask again in a moment, or include the exact scheme name and state so I can try a narrower live lookup."
  ].join("\n");
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/chat" && req.method === "POST") {
    (async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        json(res, 500, { error: "Gemini API key is not configured." });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { error: "Invalid chat request." });
        return;
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const userText = String(messages.at(-1)?.text || "").trim();
      if (!userText) {
        json(res, 400, { error: "Please enter a farming question." });
        return;
      }

      const requestBody = {
        systemInstruction: {
          parts: [{
            text: [
              "You are KrishiGyan AI Advisor for Indian farmers.",
              `Today's date is ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`,
              "Answer only questions about farming, farmer government schemes, subsidies, crop planning, livestock, fishery, dairy, poultry, irrigation, solar pumps, loans, organic farming, documents, and farm profit planning in India.",
              "For scheme recommendations, rely only on current official Indian government sources, such as .gov.in, .nic.in, myscheme.gov.in, agriculture department portals, state livestock/fishery/dairy/horticulture portals, PM-KUSUM, PM-Kisan, NABARD, and ministry pages.",
              "Do not rely on blogs, private websites, old PDFs, or unverified lists for scheme status. Do not present an expired, closed, or unverified scheme as active. If you cannot verify that a scheme is currently live from official sources, say that clearly and suggest checking the nearest agriculture/livestock/fishery department office.",
              "If the user asks outside agriculture or farmer benefits, politely say you can help only with farming and scheme guidance.",
              "Use simple farmer-friendly language. Be concise but useful.",
              "Prefer short bullet points when helpful. Mention application status, eligibility uncertainty, and official verification steps.",
              "Do not ask for sensitive personal data. Do not claim guaranteed approval."
            ].join(" ")
          }]
        },
        tools: [{ google_search: {} }],
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: 0.35,
          topP: 0.8,
          maxOutputTokens: 420
        }
      };

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        if (!response.ok) {
          json(res, response.status, { error: data.error?.message || "Gemini request failed." });
          return;
        }

        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
        const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks
          .map((chunk) => chunk.web)
          .filter((web) => web?.uri)
          .filter((web) => isOfficialSource(web.uri))
          .map((web) => ({ title: web.title || "Source", url: web.uri }))
          .slice(0, 5);
        json(res, 200, { reply: text || "I could not generate an answer right now. Please try again.", sources });
      } catch {
        json(res, 200, { reply: liveLookupUnavailableReply(), sources: [] });
      }
    })();
    return;
  }

  const url = new URL(req.url, `http://${host}:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  const relative = path.relative(root, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }

    send(res, 200, data, types[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  console.log(`KrishiGyan local server running at http://${host}:${port}/`);
});
