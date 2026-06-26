export interface DataPodArticle {
  articleId: string;
  addedBy: string;
  addedAt: string;
  votes: number;
}

export interface DataPod {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  coverUrl: string;
  podType: 'standard' | 'premium' | 'open_collab';
  priceBits?: number;
  articles: DataPodArticle[];
  collaboratorIds: string[];
  createdAt: string;
}
