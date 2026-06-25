export interface PautaInvestor {
  userId: string;
  username: string;
  displayName: string;
  bitsContributed: number;
}

export interface PautaContract {
  id: string;
  title: string;
  description: string;
  creatorId: string;
  creatorName: string;
  goalBits: number;
  currentBits: number;
  status: 'active' | 'funded' | 'published' | 'cancelled';
  createdAt: string;
  investors: PautaInvestor[];
  publishedArticleId?: string;
}
