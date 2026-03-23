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

function formatResults(data) {
    if (!data.results || data.results.length === 0) {
        return [{ type: "text", text: "No results found. Try a different search term." }];
    }

    const content = [];

    data.results.forEach((result, i) => {
        const lines = [
            `**${i + 1}. ${result.title}**`,
            result.description || "",
            `${result.date ? `Added: ${result.date}` : ""}${result.category ? ` · ${result.category}` : ""}`,
            `→ ${result.url}`,
            result.screenshot_url ? `Screenshot: ${result.screenshot_url}` : "",
        ].filter(Boolean).join("\n");

        content.push({ type: "text", text: lines });
    });

    return content;
}

function createServer() {
    const server = new McpServer({
        name: "One Page Love",
        version: "1.1.0",
        description: "Search 9,000+ curated one-page websites, landing page templates, page section examples and typeface references on One Page Love (onepagelove.com). All results are human-curated by Rob Hope since 2008.",
    });

    server.tool(
        "search_inspiration",
        "Search curated real one-page websites and landing pages for design inspiration. Returns recent examples with screenshots.",
        { query: z.string().describe("What to search for. Examples: 'dark portfolio', 'SaaS landing page', 'minimal', 'photography'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "inspiration")) })
    );

    server.tool(
        "search_templates",
        "Search downloadable one-page website templates. Includes Framer, Webflow, HTML, Squarespace and more.",
        { query: z.string().describe("What to search for. Examples: 'Framer portfolio', 'free landing page', 'dark HTML template'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "templates")) })
    );

    server.tool(
        "search_sections",
        "Search page section design examples — real websites using specific section types. Use this for hero sections, pricing tables, CTAs, navigation, testimonials, footers, contact forms etc.",
        { query: z.string().describe("Section type to search for. Examples: 'pricing', 'hero', 'CTA', 'sticky nav', 'testimonials', 'footer'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "sections")) })
    );

    server.tool(
        "search_typefaces",
        "Search for websites using a specific typeface/font. Returns real examples of the font in use on one-page websites.",
        { query: z.string().describe("Font name to search for. Examples: 'Satoshi', 'Haffer', 'Romie', 'Geist'") },
        async ({ query }) => ({ content: formatResults(await searchOPL(query, "typeface")) })
    );

    return server;
}

const useHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

if (useHttp) {
    // Lazy import express only in HTTP mode
    const { default: express } = await import("express");
    const { rateLimit } = await import("express-rate-limit");

    const app = express();
    app.use(express.json());

    // Rate limit: 60 requests/minute per IP
    app.use("/mcp", rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
    }));

    // CORS — claude.ai makes cross-origin requests to this endpoint
    app.use("/mcp", (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "https://claude.ai");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
        if (req.method === "OPTIONS") { res.sendStatus(204); return; }
        next();
    });

    // Health check for proxy probes
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "opl-mcp", version: "1.1.0" });
    });

    // MCP endpoint — stateless, new transport + server per request
    app.all("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless mode
        });
        const server = createServer();
        res.on("close", () => transport.close().catch(() => {}));
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    app.listen(PORT, "127.0.0.1", () => {
        console.log(`opl-mcp HTTP server listening on 127.0.0.1:${PORT}`);
    });

} else {
    // stdio mode — unchanged, used by Claude Desktop via npx
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
