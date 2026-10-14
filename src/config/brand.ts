export const BRAND = {
  name: "Rajaram Joshi",
  company: "Independent / Opsaway",
  companyUrl: "https://rajaram.info",
  portfolioUrl: "https://rajaram.info",
  githubUrl: "https://github.com/TheCBKM",
  identity:
    "Independent AI and backend engineer, and freelance CTO, who builds production LLM agent systems, backend platforms, and the DevOps around them. Previously CTO at Scrummer.ai (AI standups and Jira automation) and builder of NinjaHire candidate intelligence over 200M profile records",
  goal:
    "Land a remote senior AI/LLM, backend, or engineering-leadership role, and win remote freelance contracts building AI agents, automation, and backend platforms",
  availability:
    "Remote only, worldwide. Open to full-time senior/staff/lead roles and to freelance or contract engagements. Comfortable overlapping with US, UK, EU, and AU hours",
  targetRoles: [
    "Senior / Staff / Lead AI, LLM, or Agent Engineer",
    "Senior / Staff Backend or Platform Engineer",
    "Engineering Manager, Head of Engineering, or CTO",
    "DevOps, Platform, or Infrastructure Engineer",
    "Founding Engineer at an early-stage startup",
    "Freelance or contract builds: AI agents, automation, backend systems",
  ],
  /** Concrete stack, so job fit scoring can judge real overlap. */
  stack: {
    languages: ["TypeScript", "JavaScript", "Python", "Go"],
    backend: ["Node.js", "FastAPI", "REST APIs", "queues", "workflow engines"],
    data: ["PostgreSQL", "MongoDB", "Redis", "caching", "high-volume ingestion"],
    ai: [
      "LLM application architecture",
      "agent orchestration and tool use",
      "RAG and retrieval",
      "structured outputs",
      "evaluations and guardrails",
      "production observability",
    ],
    infra: ["Docker", "AWS", "GitHub Actions", "CI/CD", "Linux", "monitoring"],
  },
  /** Verifiable shipped work. Never invent additions to this list. */
  proofOfWork: [
    "Scrummer.ai: AI standups and Jira automation that detect blockers and preserve engineering context (CTO)",
    "NinjaHire: candidate intelligence and agent workflows over 200M candidate profile records",
    "Opsaway: freelance CTO engagements taking product ideas to production systems",
    "ShopDeFi: backend and Web3 product engineering at Deqode Labs",
  ],
  topics: [
    "AI agents in production",
    "LLM application architecture",
    "RAG and retrieval systems",
    "agent evaluation and guardrails",
    "backend platforms and APIs",
    "data pipelines at scale",
    "workflow automation",
    "DevOps and CI/CD",
    "distributed systems",
    "remote engineering work",
  ],
  voice:
    "Technical but accessible. Write like an engineer who ships: genuine lessons, sharp questions, no hype and no personal-brand fluff. Never beg for work, never pitch availability in comments or invites. Let the engineering do the talking. NEVER use em dashes (—), en dashes (–), or double-hyphen dashes. Use commas, periods, or a single hyphen instead.",
  icpTargets: [
    "Technical recruiters and sourcers hiring AI, backend, or platform engineers in US, UK, Europe, Canada, Australia",
    "Talent acquisition partners and heads of talent at remote-first tech companies",
    "Hiring managers, engineering managers, and directors of engineering with open remote roles",
    "Founders, co-founders, and CTOs at early-stage and scaling startups hiring remotely",
    "Agency, studio, and consultancy owners who buy contract engineering work",
    "Fractional CTO and dev-shop buyers looking for AI or automation build help",
  ],
  contentPillars: [
    "Production AI agent engineering: durable state, idempotency, evaluation, guardrails, observability, and human escalation",
    "Backend and data systems at scale: high-volume ingestion, retrieval, queues, and performance tradeoffs",
    "Proof of work: systems I have shipped, the design decisions behind them, what broke, and what I would do differently",
  ],
  searchKeywords: [
    "hiring AI engineer remote",
    "hiring backend engineer remote",
    "remote engineering role",
    "AI agents production",
    "LLM engineering",
    "contract backend developer",
    "freelance AI developer",
    "founding engineer hiring",
    "remote first engineering team",
    "platform engineering hiring",
  ],
} as const;

export function brandContextForPrompt(): string {
  const { stack } = BRAND;
  return `
You are writing on behalf of ${BRAND.name}, ${BRAND.identity}.
Portfolio: ${BRAND.portfolioUrl}
Career goal: ${BRAND.goal}
Availability: ${BRAND.availability}
Target roles: ${BRAND.targetRoles.join("; ")}
Stack: ${stack.languages.join(", ")} | backend: ${stack.backend.join(", ")} | data: ${stack.data.join(", ")} | AI: ${stack.ai.join(", ")} | infra: ${stack.infra.join(", ")}
Shipped work (the only projects you may reference; never invent others): ${BRAND.proofOfWork.join("; ")}
Topics: ${BRAND.topics.join(", ")}
Voice: ${BRAND.voice}
Target audience: ${BRAND.icpTargets.join(", ")}
Content pillars: ${BRAND.contentPillars.join("; ")}
`.trim();
}
