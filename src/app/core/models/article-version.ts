export interface ArticleVersion {
  id: string;
  articleId: string;
  title: string;
  content: string;
  summary: string;
  coverUrl: string;
  tags: string[];
  savedAt: string;
  savedByDisplayName: string;
}
