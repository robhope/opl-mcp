#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const ALGOLIA_APP_ID  = "MZD9L5GHEU";
const ALGOLIA_API_KEY = "8b38cb1b451ae9b2c874bbfa9e3a451c";
const ALGOLIA_BASE    = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes`;
const PORT = process.env.PORT || 3000;
const HITS = 5;

async function searchOPL(query, index) {
    const res = await fetch(`${ALGOLIA_BASE}/${index}/query`, {
        method: "POST",
        headers: {
            "X-Algolia-Application-Id": ALGOLIA_APP_ID,
            "X-Algolia-API-Key": ALGOLIA_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            query,
            hitsPerPage: HITS,
            attributesToRetrieve: ["title", "description", "url", "category", "date", "screenshot_url"],
            analyticsTags: ["claude"],
        }),
    });
    if (!res.ok) throw new Error(`Algolia error: ${res.status}`);
    const data = await res.json();
    // Normalise to same shape as WP endpoint
    return { results: (data.hits || []).map(h => ({
        title: h.title,
        description: h.description,
        url: h.url,
        category: h.category,
        date: h.date,
        screenshot_url: h.screenshot_url,
    })) };
}

async function fetchImageBase64(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return Buffer.from(buf).toString("base64");
    } catch {
        return null;
    }
}

async function formatResults(data) {
    if (!data.results || data.results.length === 0) {
        return [{ type: "text", text: "No results found. Try a different search term." }];
    }

    // Fetch all screenshots in parallel (3s timeout each)
    const images = await Promise.all(
        data.results.map(r => r.screenshot_url ? fetchImageBase64(r.screenshot_url) : Promise.resolve(null))
    );

    const content = [];
    data.results.forEach((result, i) => {
        if (images[i]) {
            content.push({ type: "image", data: images[i], mimeType: "image/jpeg" });
        }
        const lines = [
            `**[${result.title}](${result.url})**`,
            result.description || "",
            `${result.date ? result.date : ""}${result.category ? ` · ${result.category}` : ""}`,
        ].filter(Boolean).join("\n");
        content.push({ type: "text", text: lines });
    });

    return content;
}

function createServer() {
    const server = new McpServer({
        name: "One Page Love",
        version: "1.2.0",
        description: "Search 9,000+ curated one-page websites, landing page templates, page section examples and typeface references on One Page Love (onepagelove.com). All results are human-curated by Rob Hope since 2008.",
    });

    server.tool(
        "search_inspiration",
        "Search curated real one-page websites and landing pages by overall design style, industry, or company type. Use for queries about complete page designs — e.g. 'dark SaaS landing page', 'minimal portfolio', 'fintech startup'. Do NOT use for specific page sections (hero, pricing, nav etc.) — use search_sections for those.",
        { query: z.string().describe("What to search for. Include style descriptors in the query for better results. Examples: 'dark SaaS landing page', 'minimal portfolio', 'fintech', 'photography'") },
        async ({ query }) => ({ content: await formatResults(await searchOPL(query, "inspiration")) })
    );

    server.tool(
        "search_templates",
        "Search downloadable one-page website templates. Includes Framer, Webflow, HTML, Squarespace and more. Use when the user wants a template they can download or clone.",
        { query: z.string().describe("What to search for. Examples: 'Framer portfolio', 'free landing page', 'dark HTML template'") },
        async ({ query }) => ({ content: await formatResults(await searchOPL(query, "templates")) })
    );

    server.tool(
        "search_sections",
        "Search real-world examples of specific page sections and UI components. ALWAYS use this tool when the query mentions a section type: hero, pricing, pricing table, CTA, call to action, navigation, sticky nav, testimonials, footer, contact form, features, about, FAQ, team. Include style descriptors in the query (e.g. 'dark pricing table', 'minimal hero section').",
        { query: z.string().describe("Section type plus any style descriptors. Examples: 'dark pricing table', 'minimal hero', 'sticky nav', 'testimonials with avatars', 'animated CTA'") },
        async ({ query }) => ({ content: await formatResults(await searchOPL(query, "sections")) })
    );

    server.tool(
        "search_typefaces",
        "Search for websites using a specific typeface/font. Returns real examples of the font in use on one-page websites.",
        { query: z.string().describe("Font name to search for. Examples: 'Satoshi', 'Haffer', 'Romie', 'Geist'") },
        async ({ query }) => ({ content: await formatResults(await searchOPL(query, "typeface")) })
    );

    return server;
}

const useHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

if (useHttp) {
    const { default: express } = await import("express");
    const { rateLimit } = await import("express-rate-limit");

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());

    app.use("/mcp", rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
    }));

    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");
        if (req.method === "OPTIONS") { res.sendStatus(204); return; }
        next();
    });

    app.get("/", (_req, res) => res.json({ service: "opl-mcp", version: "1.2.0", endpoint: "/mcp" }));
    app.get("/health", (_req, res) => res.json({ status: "ok", service: "opl-mcp", version: "1.2.0" }));

    app.all("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createServer();
        res.on("close", () => transport.close().catch(() => {}));
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    app.listen(PORT, "0.0.0.0", () => console.log(`opl-mcp HTTP server listening on port ${PORT}`));

} else {
    const server = createServer();
    await server.connect(new StdioServerTransport());
}
