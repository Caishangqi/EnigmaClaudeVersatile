---
name: tavily-search
description: >
  Search the web using Tavily for structured, factual, and technical information.
  Use when the user says "tavily search", "use tavily", "search with tavily", or
  needs precise, well-sourced search results with relevance scoring. Tavily excels
  at structured/factual queries, while Grok is better for real-time news and broad
  web exploration.
---

# Tavily Web Search Protocol

When this skill is invoked, follow the protocol below to search the web via Tavily and present results.

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
4. Keep queries under 400 characters for optimal results
5. Keep queries in the language most likely to yield good results (English for tech topics, user's language for local topics)

## Step 3: Select Search Parameters

Choose parameters based on intent:

**search_depth:**
- `"basic"` — for simple factual lookups, quick answers (1 credit)
- `"advanced"` — for technical queries, comparisons, or when higher relevance is needed (2 credits)

**topic:**
- `"general"` — default for most queries
- `"news"` — for recent events, announcements, releases

**include_answer:**
- `true` — when the user needs a direct, concise answer (factual and technical intents)
- `false` — when the user needs raw search results for their own analysis

**max_results:**
- `5` — for focused factual queries
- `10` — for comparative or exploratory queries

**include_domains** (optional):
- For technical queries, prefer official docs: e.g., `["docs.python.org", "developer.mozilla.org"]`
- Only set when the user specifies preferred sources or the query clearly benefits from domain filtering

**time_range** (optional):
- `"day"` — for breaking news
- `"week"` — for recent developments
- `"month"` — for recent releases or updates
- `"year"` — for annual summaries
- Leave unset for evergreen queries

## Step 4: Call tavily_search

Call the `tavily_search` MCP tool with:
- `query`: the crafted search query from Step 2
- `search_depth`: selected in Step 3 (default `"basic"`)
- `topic`: selected in Step 3 (default `"general"`)
- `max_results`: selected in Step 3 (default `5`)
- `include_answer`: selected in Step 3 (default `true`)
- `include_domains`: if applicable from Step 3
- `time_range`: if applicable from Step 3

## Step 5: Present Results

After receiving Tavily's response:
1. Present it with clear attribution: **"Tavily 搜索结果："**
2. If `include_answer` was `true` and an answer was returned, present the direct answer first
3. List individual results with titles, URLs, and relevance scores when available
4. Preserve all source URLs and citations from the response
5. If the response is in a different language than the user's, translate key findings while keeping original URLs
6. If the results don't fully answer the user's question, offer to refine the search with a different query or switch to `"advanced"` search depth
7. If the user needs deeper analysis of the search results (e.g., comparing options, making recommendations), provide Claude's own analysis on top of Tavily's raw results
