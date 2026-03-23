#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://onepagelove.com/wp-json/opl/v1/search";

const server = new McpServer({
    name: "One Page Love",
    version: "1.0.0",
    description: "Search 9,000+ curated one-page websites, landing page templates, page section examples and typeface references on One Page Love (onepagelove.com). All results are human-curated by Rob Hope since 2008.",
});

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
        ].filter(Boolean).join("\n");

        content.push({ type: "text", text: lines });

        if (result.screenshot_url) {
            content.push({
                type: "image",
                url: result.screenshot_url,
                mimeType: "image/jpeg",
            });
        }
    });

    return content;
}

// Tool: search_inspiration
server.tool(
    "search_inspiration",
    "Search curated real one-page websites and landing pages for design inspiration. Returns recent examples with screenshots.",
    { query: z.string().describe("What to search for. Examples: 'dark portfolio', 'SaaS landing page', 'minimal', 'photography'") },
    async ({ query }) => {
        const data = await searchOPL(query, "inspiration");
        return { content: formatResults(data) };
    }
);

// Tool: search_templates
server.tool(
    "search_templates",
    "Search downloadable one-page website templates. Includes Framer, Webflow, HTML, Squarespace and more.",
    { query: z.string().describe("What to search for. Examples: 'Framer portfolio', 'free landing page', 'dark HTML template'") },
    async ({ query }) => {
        const data = await searchOPL(query, "templates");
        return { content: formatResults(data) };
    }
);

// Tool: search_sections
server.tool(
    "search_sections",
    "Search page section design examples — real websites using specific section types. Use this for hero sections, pricing tables, CTAs, navigation, testimonials, footers, contact forms etc.",
    { query: z.string().describe("Section type to search for. Examples: 'pricing', 'hero', 'CTA', 'sticky nav', 'testimonials', 'footer'") },
    async ({ query }) => {
        const data = await searchOPL(query, "sections");
        return { content: formatResults(data) };
    }
);

// Tool: search_typefaces
server.tool(
    "search_typefaces",
    "Search for websites using a specific typeface/font. Returns real examples of the font in use on one-page websites.",
    { query: z.string().describe("Font name to search for. Examples: 'Satoshi', 'Haffer', 'Romie', 'Geist'") },
    async ({ query }) => {
        const data = await searchOPL(query, "typeface");
        return { content: formatResults(data) };
    }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
