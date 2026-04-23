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
  isNews?: boolean;
}

export type GroupedResult = 
  | { type: 'single'; result: SearchResult }
  | { type: 'group'; primary: SearchResult; secondaries: SearchResult[] };

export interface UserProfile {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface VisualAnalysis {
  objects: string[];
  colors: string[];
  style: string;
  labels: string[];
  tokens: string;
}

export interface DictionaryResult {
  word: string;
  phonetic: string;
  audio?: string;
  class: string;
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
}

export interface VisualMathProblem {
  features: string[];
  timestamp: string;
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
  details: { label: string; value: string }[];
  sections?: { title: string; content: string }[];
}

export interface ClickstreamEvent {
  id: string;
  type: 'success' | 'info' | 'error';
  query: string;
  url: string;
  timestamp: Date | string;
  uid?: string;
}