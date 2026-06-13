export const PLANS = {
  free: {
    label: "Free",
    credits: 50,
    price: 0,
  },
  starter: {
    label: "Starter",
    credits: 50,
    price: 10,
  },
  pro: {
    label: "Pro",
    credits: 150,
    price: 30,
  },
} as const;

export const CREDIT_COST_PER_GENERATION = 1;

export const MIN_CREDITS_TO_GENERATE = 1;

export const PRICING_PLANS = [
  {
    key: "free",
    label: "Free",
    description: "Start building. No credit card required.",
    price: 0,
    featured: false,
    planId: null,
    active: true,
    features: ["50 generations / month", "Live preview", "Export to zip"],
  },
  {
    key: "starter",
    label: "Starter",
    description: "For developers who build regularly.",
    price: 10,
    featured: true,
    planId: "cplan_3ExMIyIUVvWhe8uGPtlnGnnC7pn",
    active: true,
    features: [
      "50 generations / month",
      "Image uploads",
      "Live preview",
      "Export to zip",
    ],
  },
  {
    key: "pro",
    label: "Pro",
    description: "For power users who ship fast.",
    price: 30,
    featured: false,
    planId: "cplan_3ExMpNcg81cf2XQ5V2W06aktqHh",
    active: true,
    features: [
      "150 generations / month",
      "Priority AI (faster response)",
      "Live preview",
      "Export to zip",
      "Image uploads",
      "Access to Flow Pro Agent",
    ],
  },
] as const;
