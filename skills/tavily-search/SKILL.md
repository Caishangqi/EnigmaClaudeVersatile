---
name: tavily-search
description: >
  Search the web using Tavily for current information, real-time data, news, or any query
  requiring up-to-date results. Use when the user says "search", "look up", "find out",
  "what's the latest", "tavily search", "use tavily", or needs current information beyond
  Claude's knowledge cutoff.
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
4. Keep queries in the language most likely to yield good results (English for tech topics, user's language for local topics)

## Step 3: Select Search Parameters

Set search parameters based on intent:

**For factual queries:**
- `search_depth`: "advanced"
- `include_answer`: true
- `topic`: "general"

**For news queries:**
- `search_depth`: "basic"
- `include_answer`: true
- `topic`: "news"
- `time_range`: "week" (or "day" for breaking news)

**For technical queries:**
- `search_depth`: "advanced"
- `include_answer`: true
- `topic`: "general"

**For comparative/exploratory queries:**
- `search_depth`: "advanced"
- `include_answer`: true
- `topic`: "general"
- `max_results`: 10

**For financial queries:**
- `search_depth`: "advanced"
- `include_answer`: true
- `topic`: "finance"

## Step 4: Call tavily_search

Call the `tavily_search` MCP tool with:
- `query`: the crafted search query from Step 2
- `search_depth`: selected in Step 3
- `topic`: selected in Step 3
- `include_answer`: selected in Step 3
- `max_results`: default unless user needs broader results
- `time_range`: only if recency filtering is needed

## Step 5: Present Results

After receiving Tavily's response:
1. Present it with clear attribution: **"Tavily 搜索结果："**
2. Preserve all source URLs and citations from the response
3. If the response is in a different language than the user's, translate key findings while keeping original URLs
4. If the results don't fully answer the user's question, offer to refine the search with a different query
5. If the user needs deeper analysis of the search results (e.g., comparing options, making recommendations), provide Claude's own analysis on top of Tavily's raw results
