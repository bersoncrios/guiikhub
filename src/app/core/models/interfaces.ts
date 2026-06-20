export interface BlogSettings {
  title: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  cardBgColor: string;
  textColor: string;
  fontFamily: 'Outfit' | 'Space Grotesk' | 'Fira Code' | 'system-ui';
  layoutType: 'grid' | 'list' | 'magazine';
  bannerUrl: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  bannerUrl?: string;
  blogSettings: BlogSettings;
  viewsCount?: number;
  collaborators?: string[];
}

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
  status?: 'published' | 'pending';
  createdAt: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
}

export interface Comment {
  id: string;
  articleId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string;
  content: string;
  createdAt: string;
}

