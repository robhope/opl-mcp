#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const API_BASE = "https://onepagelove.com/wp-json/opl/v1/search";
const PORT = process.env.PORT || 3000;

async function searchOPL(query, index) {
    const url = new URL(API_BASE);
    url.searchParams.set("q", query);
    url.searchParams.set("index", index);
    url.searchParams.set("source", "claude");

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`OPL API error: ${response.status}`);
    }
    return response.json();
}

function formatResults(data, imageBase = null) {
    if (!data.results || data.results.length === 0) {
        return [{ type: "text", text: "No results found. Try a different search term." }];
    }

    const content = [];

    data.results.forEach((result, i) => {
        let imgUrl = result.screenshot_url || null;
        if (imgUrl && imageBase) {
            imgUrl = `${imageBase}/img?url=${encodeURIComponent(imgUrl)}`;
        }

        const lines = [
            imgUrl ? `![${result.title}](${imgUrl})` : "",
            `**${i + 1}. ${result.title}**`,
            result.description || "",
            `${result.date ? `Added: ${result.date}` : ""}${result.category ? ` · ${result.category}` : ""}`,
            `→ ${result.url}`,
        ].filter(Boolean).join("\n");

        content.push({ type: "text", text: lines });
    });

    return content;
}

function createServer(imageBase = null) {
    const server = new McpServer({
        name: "One Page Love",
        version: "1.1.0",
        description: "Search 9,000+ curated one-page websites, landing page templates, page section examples and typeface references on One Page Love (onepagelove.com). All results are human-curated by Rob Hope since 2008.",
    });

    server.tool(
        "search_inspiration",
        "Search curated real one-page websites and landing pages by overall design style, industry, or company type. Use for queries about complete page designs — e.g. 'dark SaaS landing page', 'minimal portfolio', 'fintech startup'. Do NOT use for specific page sections (hero, pricing, nav etc.) — use search_sections for those.",
        { query: z.string().describe("What to search for. Include style descriptors in the query for better results. Examples: 'dark SaaS landing page', 'minimal portfolio', 'fintech', 'photography'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "inspiration"), imageBase) })
    );

    server.tool(
        "search_templates",
        "Search downloadable one-page website templates. Includes Framer, Webflow, HTML, Squarespace and more. Use when the user wants a template they can download or clone.",
        { query: z.string().describe("What to search for. Examples: 'Framer portfolio', 'free landing page', 'dark HTML template'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "templates"), imageBase) })
    );

    server.tool(
        "search_sections",
        "Search real-world examples of specific page sections and UI components. ALWAYS use this tool when the query mentions a section type: hero, pricing, pricing table, CTA, call to action, navigation, sticky nav, testimonials, footer, contact form, features, about, FAQ, team. Include style descriptors in the query (e.g. 'dark pricing table', 'minimal hero section').",
        { query: z.string().describe("Section type plus any style descriptors. Examples: 'dark pricing table', 'minimal hero', 'sticky nav', 'testimonials with avatars', 'animated CTA'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "sections"), imageBase) })
    );

    server.tool(
        "search_typefaces",
        "Search for websites using a specific typeface/font. Returns real examples of the font in use on one-page websites.",
        { query: z.string().describe("Font name to search for. Examples: 'Satoshi', 'Haffer', 'Romie', 'Geist'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "typeface"), imageBase) })
    );

    return server;
}

const useHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

if (useHttp) {
    // Lazy import express only in HTTP mode
    const { default: express } = await import("express");
    const { rateLimit } = await import("express-rate-limit");

    const app = express();
    app.set("trust proxy", 1); // trust nginx-proxy's X-Forwarded-For
    app.use(express.json());

    // Rate limit: 60 requests/minute per IP
    app.use("/mcp", rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
    }));

    // CORS — allow any origin (public read-only API)
    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");
        if (req.method === "OPTIONS") { res.sendStatus(204); return; }
        next();
    });

    // Root + health check
    app.get("/", (_req, res) => {
        res.json({ service: "opl-mcp", version: "1.1.0", endpoint: "/mcp" });
    });
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "opl-mcp", version: "1.1.0" });
    });

    // Image proxy — serves assets.onepagelove.com images from this trusted domain
    app.get("/img", async (req, res) => {
        const { url } = req.query;
        if (!url || !url.startsWith("https://assets.onepagelove.com/")) {
            return res.status(400).send("Invalid URL");
        }
        try {
            const upstream = await fetch(url);
            if (!upstream.ok) return res.status(upstream.status).send("Upstream error");
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            res.setHeader("Access-Control-Allow-Origin", "*");
            const buffer = await upstream.arrayBuffer();
            res.send(Buffer.from(buffer));
        } catch {
            res.status(502).send("Proxy error");
        }
    });

    // MCP endpoint — stateless, new transport + server per request
    const IMAGE_BASE = process.env.IMAGE_BASE || "https://mcp.onepagelove.com";
    app.all("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless mode
        });
        const server = createServer(IMAGE_BASE);
        res.on("close", () => transport.close().catch(() => {}));
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`opl-mcp HTTP server listening on port ${PORT}`);
    });

} else {
    // stdio mode — unchanged, used by Claude Desktop via npx
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
