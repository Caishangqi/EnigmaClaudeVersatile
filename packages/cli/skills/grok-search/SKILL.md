---
name: grok-search
description: >
  Search the web using Grok for current information, real-time data, news, or any query
  requiring up-to-date results. Use when the user says "search", "look up", "find out",
  "what's the latest", "grok search", "use grok", or needs current information beyond
  Claude's knowledge cutoff.
---

# Grok Web Search Protocol

When this skill is invoked, follow the protocol below to search the web via Grok and present results.

## Step 1: Analyze Search Intent

Analyze the user's request (`$ARGUMENTS`) to classify the intent:

- **factual**: specific facts, dates, versions, prices → need precise, sourced answers
- **news**: recent events, announcements, releases → need recency and timeline
- **technical**: API docs, library updates, compatibility info → need code-relevant details
- **comparative**: "X vs Y", "best tool for Z" → need structured comparison
- **exploratory**: broad topic research, "what's happening with X" → need overview with sources

## Step 2: Craft Search Query

Transform the user's request into an effective search query:

1. If the user's request is already a clear search query, use it directly
2. If the request is conversational, extract the core search intent:
   - "帮我查一下 React 19 有什么新特性" → "React 19 new features and changes"
   - "最近有什么关于 Rust 的新闻" → "Rust programming language latest news 2026"
3. Add temporal context if recency matters (e.g., append current year)
4. Keep queries in the language most likely to yield good results (English for tech topics, user's language for local topics)

## Step 3: Select System Prompt

Set the `system_prompt` parameter based on intent:

**For factual queries:**
```
You are a precise research assistant. Provide accurate, well-sourced answers. Include specific numbers, dates, and version info. Always cite your sources with URLs.
```

**For news queries:**
```
You are a news research assistant. Find the most recent and relevant news. Present findings chronologically with dates. Always include source URLs and publication dates.
```

**For technical queries:**
```
You are a technical research assistant for software developers. Find accurate, up-to-date technical information. Include code examples when relevant. Cite official documentation and reliable sources with URLs.
```

**For comparative/exploratory queries:**
```
You are a web search assistant. Search the web and provide accurate, up-to-date information with source citations. Be concise and factual. Always include relevant URLs when available.
```

## Step 4: Call grok_search

Call the `grok_search` MCP tool with:
- `query`: the crafted search query from Step 2
- `system_prompt`: selected in Step 3
- `model`: leave as default unless user specifies otherwise

## Step 5: Present Results

After receiving Grok's response:
1. Present it with clear attribution: **"Grok 搜索结果："**
2. Preserve all source URLs and citations from the response
3. If the response is in a different language than the user's, translate key findings while keeping original URLs
4. If the results don't fully answer the user's question, offer to refine the search with a different query
5. If the user needs deeper analysis of the search results (e.g., comparing options, making recommendations), provide Claude's own analysis on top of Grok's raw results