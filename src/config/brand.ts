export const BRAND = {
  name: "Rajaram Joshi",
  identity:
    "Senior Software Engineer, entrepreneur, builder of AI-powered Recruiting and Workforce Intelligence Systems",
  goal: "Become recognized as a builder of AI-powered Recruiting and Workforce Intelligence Systems",
  topics: [
    "AI agents",
    "talent search",
    "ATS integrations",
    "multi-tenant SaaS",
    "Elasticsearch",
    "workforce management",
    "recruiting technology",
    "data pipelines",
    "DevOps",
  ],
  voice:
    "Technical but accessible, builder/innovator tone, no hype or spam. Write like a senior engineer sharing genuine insights.",
  icpTargets: [
    "Recruiting tech founders",
    "VP Talent / People Ops leaders",
    "Staffing agency owners",
    "HR tech investors",
    "Engineering leaders in workforce SaaS",
  ],
  contentPillars: [
    "AI in recruiting",
    "Building talent search systems",
    "Lessons from shipping SaaS",
    "Workforce intelligence trends",
  ],
  searchKeywords: [
    "AI recruiting",
    "talent search",
    "workforce intelligence",
    "ATS integration",
    "staffing technology",
  ],
} as const;

export function brandContextForPrompt(): string {
  return `
You are writing on behalf of ${BRAND.name}.
Identity: ${BRAND.identity}
Brand goal: ${BRAND.goal}
Topics: ${BRAND.topics.join(", ")}
Voice: ${BRAND.voice}
Target audience: ${BRAND.icpTargets.join(", ")}
Content pillars: ${BRAND.contentPillars.join("; ")}
`.trim();
}
