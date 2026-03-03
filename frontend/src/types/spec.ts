/** Mirrors backend/app/spec/models.py — JSON wire format. */

export interface RegistryEntry {
  id: string;
  type: string;
  path: string;
  title: string;
  status: string;
  covers: string[];
  tags: string[];
  created: string;
  updated: string;
}

export interface Link {
  from: string;
  to: string;
  type: string;
}

export interface SpecSummary {
  id: string;
  type: string;
  path: string;
  status: string;
  title: string;
  tags: string[];
}

export interface SpecDetail {
  id: string;
  type: string;
  path: string;
  status: string;
  title: string;
  tags: string[];
  content: string;
  links: Link[];
}

export interface SpecGraph {
  nodes: RegistryEntry[];
  edges: Link[];
}
