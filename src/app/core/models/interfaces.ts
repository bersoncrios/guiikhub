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
  email?: string;
  bannerUrl?: string;
  blogSettings: BlogSettings;
  viewsCount?: number;
  collaborators?: string[];
  bits_balance?: number;
  xp_points?: number;
  lastDailyRewardAt?: string;
  role?: 'admin' | 'creator';
  unlockedBadges?: string[];
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
  newsletterSent?: boolean;
  scheduledAt?: string | null;
  scheduledNewsletter?: boolean;
  applauseCount?: number;
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

export interface GamificationLog {
  id: string;
  userId: string;
  typeAction: 'earn' | 'spend' | 'transfer';
  amount: number;
  description: string;
  createdAt: string;
}

export interface LeilaoDia {
  id: string; // YYYY-MM-DD
  maiorLanceAtual: number;
  usuarioLiderId: string;
  usuarioLiderDisplayName: string;
  postLiderId: string;
  postLiderTitle: string;
  finalizado: boolean;
  historicoLances: Array<{
    usuarioId: string;
    displayName: string;
    postId: string;
    amount: number;
    timestamp: string;
  }>;
}

export interface ConfiguracaoHolofote {
  id: string; // 'feed_spotlight'
  postDestaqueId: string;
  autorUsername: string;
  maiorLanceVencedor: number;
  dataDestaque: string; // YYYY-MM-DD
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  xpRequirement: number;
  iconUrl: string;
  createdAt: string;
}
