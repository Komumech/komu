export interface SearchResult {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sourceIcon?: string;
  image?: string;
  is_image?: boolean;
  score?: number;
  date?: string;
  [key: string]: any;
}

export interface VisualAnalysis {
  objects: string[];
  colors: string[];
  style: string;
  labels: string[];
  tokens: string;
}

export interface AIOverview {
  summary: string;
  sources: { title: string; url: string }[];
}

export interface KnowledgePanel {
  title: string;
  subtitle: string;
  description: string;
  image?: string;
  images?: string[];
  wikipediaUrl?: string;
  details: { label: string; value: string }[];
  sections?: { title: string; content: string }[];
  peopleAlsoSearchFor?: {
    name: string;
    category?: string;
    image: string;
    query: string;
  }[];
}
