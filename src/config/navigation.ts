export type NavItem = {
  label: string;
  href: string;
  icon: string; // lucide-react icon name
  badge?: "count" | string;
  badgeKey?: "openActions";
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavSection[] = [
  {
    id: "main",
    label: "Main",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" }],
  },
  {
    id: "geo",
    label: "AI Search (GEO)",
    items: [
      { label: "Brand Visibility", href: "/geo/visibility", icon: "Radar" },
      { label: "AI Traffic", href: "/geo/traffic", icon: "Activity" },
      { label: "Prompt Explorer", href: "/geo/prompts/explore", icon: "Search" },
      {
        label: "Action Center",
        href: "/geo/actions",
        icon: "ListChecks",
        badge: "count",
        badgeKey: "openActions",
      },
      { label: "ChatGPT Shopping", href: "/geo/shopping", icon: "ShoppingBag" },
    ],
  },
  {
    id: "seo",
    label: "SEO",
    items: [
      { label: "Site Audit", href: "/seo/audit", icon: "ShieldCheck" },
      { label: "Content Optimizer", href: "/seo/optimizer", icon: "Target" },
      { label: "Keywords", href: "/seo/keywords", icon: "KeyRound" },
    ],
  },
  {
    id: "content",
    label: "Content",
    items: [
      { label: "Articles", href: "/content/articles", icon: "FileText" },
      { label: "Brand Voices", href: "/content/brand-voices", icon: "Mic" },
      { label: "Templates", href: "/content/templates", icon: "LayoutGrid" },
    ],
  },
  {
    id: "tools",
    label: "AI Tools",
    items: [
      { label: "Chatsonic", href: "/chat", icon: "MessagesSquare" },
      { label: "Photosonic", href: "/tools/images", icon: "Image" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      { label: "Team", href: "/settings/team", icon: "Users" },
      { label: "Integrations", href: "/settings/integrations", icon: "Plug" },
      { label: "Billing", href: "/billing", icon: "CreditCard" },
      { label: "API Keys", href: "/settings/api", icon: "KeyRound" },
    ],
  },
];
