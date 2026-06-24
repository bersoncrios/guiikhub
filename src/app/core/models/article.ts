export interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  summary: string;
  coverUrl: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string;
  blogId?: string;
  status?: 'published' | 'pending' | 'draft';
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  section?: string;
  newsletterSent?: boolean;
  scheduledAt?: string | null;
  scheduledNewsletter?: boolean;
  applauseCount?: number;
}
