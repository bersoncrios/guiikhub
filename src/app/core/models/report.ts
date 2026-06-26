export interface Report {
  id: string;
  articleId: string;
  articleTitle: string;
  authorId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}
