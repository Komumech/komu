export interface SearchResult {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sourceIcon?: string;
  image?: string;
  date?: string;
}

export interface AIOverview {
  summary: string;
  sources: { title: string; url: string }[];
}
