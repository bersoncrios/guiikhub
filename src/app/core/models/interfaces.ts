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
  sponsorBannerUrl1?: string;
  sponsorBannerLink1?: string;
  sponsorBannerUrl2?: string;
  sponsorBannerLink2?: string;
  sections?: string[];
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
  status?: 'published' | 'pending' | 'draft';
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  section?: string;
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

export interface BlogStatus {
  id: string;
  authorId: string;
  blogId: string;
  content: string;
  createdAt: string;
  expiresAt: string;
}

export interface ArticleNote {
  id: string;
  articleId: string;
  authorId: string;
  authorDisplayName: string;
  authorAvatarUrl: string;
  content: string;
  createdAt: string;
}

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
