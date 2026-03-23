# One Page Love MCP Server

Search 9,000+ curated one-page websites, landing page templates, page section examples and typeface references directly from Claude.

## Install

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "onepagelove": {
      "command": "npx",
      "args": ["-y", "opl-mcp"]
    }
  }
}
```

Restart Claude Desktop. You'll see a 🔨 icon confirming the tools are loaded.

## Tools

| Tool | Description |
|---|---|
| `search_inspiration` | Curated real one-page websites and landing pages |
| `search_templates` | Downloadable templates (Framer, Webflow, HTML, Squarespace) |
| `search_sections` | Page section examples (hero, pricing, CTA, nav, footer etc.) |
| `search_typefaces` | Websites using a specific font |

## Example prompts

- "Show me dark SaaS landing pages"
- "Find Framer portfolio templates"
- "Show me pricing section examples"
- "What websites use the Satoshi font?"

## About

One Page Love is curated by [Rob Hope](https://robhope.com) since 2008. All results link back to onepagelove.com.
