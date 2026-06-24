import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { User, Article, Comment, BlogSettings, BlogStatus, ArticleNote, ArticleVersion, GamificationLog, LeilaoDia, ConfiguracaoHolofote, Badge, ShopItem } from '../models/interfaces';
import { 
  Firestore, 
  collection, 
  collectionData, 
  doc, 
  docData, 
  setDoc, 
  updateDoc, 
  query, 
  orderBy,
  where
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';

import { AuthService } from './auth.service';
import { ArticleService } from './article.service';
import { UserService } from './user.service';
import { GamificationService } from './gamification.service';
import { AuctionService } from './auction.service';
import { BlogStatusService } from './blog-status.service';
import { NewsletterService } from './newsletter.service';

@Injectable({
  providedIn: 'root'
})
export class DbService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly rewardedArticlesInMemory = new Set<string>();

  // Inject Sub-Services
  private readonly authService = inject(AuthService);
  private readonly articleService = inject(ArticleService);
  private readonly userService = inject(UserService);
  private readonly gamificationService = inject(GamificationService);
  private readonly auctionService = inject(AuctionService);
  private readonly blogStatusService = inject(BlogStatusService);
  private readonly newsletterService = inject(NewsletterService);

  // Writable Signals for application state
  readonly users = signal<User[]>([]);
  readonly articles = signal<Article[]>([]);
  readonly comments = signal<Comment[]>([]);
  readonly follows = signal<Array<{ followerId: string; followedId: string }>>([]);
  readonly likes = signal<Array<{ userId: string; articleId: string }>>([]);
  readonly blogStatuses = signal<BlogStatus[]>([]);
  readonly articleNotes = signal<ArticleNote[]>([]);
  readonly articleVersions = signal<ArticleVersion[]>([]);

  readonly isUsersLoading = signal<boolean>(true);
  readonly isArticlesLoading = signal<boolean>(true);

  // Gamification Signals and Computeds
  readonly gamificationLogs = signal<GamificationLog[]>([]);
  readonly badges = signal<Badge[]>([]);
  readonly shopItems = signal<ShopItem[]>([]);

  readonly currentUserLevel = computed(() => {
    const user = this.currentUser();
    if (!user) return 1;
    const xp = user.xp_points || 0;
    return Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2) || 1;
  });

  readonly currentUserXpInLevel = computed(() => {
    const user = this.currentUser();
    if (!user) return 0;
    const xp = user.xp_points || 0;
    const level = this.currentUserLevel();
    return xp - (50 * level * (level - 1));
  });

  readonly currentUserXpRequiredForNext = computed(() => {
    return this.currentUserLevel() * 100;
  });

  readonly currentUserXpProgress = computed(() => {
    const xpInLevel = this.currentUserXpInLevel();
    const required = this.currentUserXpRequiredForNext();
    if (required <= 0) return 0;
    return Math.max(0, Math.min(100, Math.floor((xpInLevel / required) * 100)));
  });

  // Spotlight / Leilão Signals
  readonly leilaoDiaAtual = signal<LeilaoDia | null>(null);
  readonly holofoteAtivo = signal<ConfiguracaoHolofote | null>(null);

  // Blogs the current user is a collaborator on
  readonly collaboratingBlogs = computed(() => {
    const me = this.currentUser();
    if (!me) return [];
    return this.users().filter(u => u.collaborators?.includes(me.id));
  });

  readonly currentUser = signal<User | null>(null);
  readonly isAuthenticated = signal<boolean>(false);
  readonly isAuthLoading = signal<boolean>(true);
  readonly isOffline = signal<boolean>(false);
  private isCheckingEventBadges = false;
  private isClaimingDailyReward = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOffline.set(!navigator.onLine);
      window.addEventListener('online', () => this.isOffline.set(false));
      window.addEventListener('offline', () => this.isOffline.set(true));
    }
    this.initFirebaseSync();

    // Retroactive badge check for logged-in user whenever their XP or badges change
    effect(() => {
      const user = this.currentUser();
      const badgesList = this.badges();
      if (user && badgesList.length > 0) {
        const currentXp = user.xp_points || 0;
        const unlocked = user.unlockedBadges || [];
        const eligibleButLocked = badgesList.filter(b => (!b.type || b.type === 'xp') && b.xpRequirement <= currentXp && !unlocked.includes(b.id));
        
        if (eligibleButLocked.length > 0) {
          this.unlockBadgesRetroactively(user.id, eligibleButLocked);
        }
      }
    });
  }

  private initFirebaseSync() {
    if (typeof window === 'undefined') {
      // Server-Side Rendering (SSR) Guard
      return;
    }

    // 1. Sync Users Collection
    collectionData(collection(this.firestore, 'users'), { idField: 'id' }).subscribe(data => {
      if (data) {
        this.users.set(data as User[]);
      }
      this.isUsersLoading.set(false);
    });

    // Sync Shop Items
    collectionData(collection(this.firestore, 'shop_items'), { idField: 'id' }).subscribe(data => {
      if (data) {
        this.shopItems.set(data as ShopItem[]);
      }
    });

    // 2. Sync Auth State
    let logsSubscription: any = null;
    let userSubscription: any = null;
    authState(this.auth).subscribe(fbUser => {
      if (fbUser) {
        this.isAuthenticated.set(true);
        // Sync user doc from Firestore
        const userRef = doc(this.firestore, `users/${fbUser.uid}`);
        if (userSubscription) {
          userSubscription.unsubscribe();
        }
        userSubscription = docData(userRef).subscribe({
          next: userData => {
            if (userData) {
              const u = userData as User;
              let hasChanges = false;
              const updates: any = {};
              
              if (!u.email && fbUser.email) {
                updates.email = fbUser.email;
                u.email = fbUser.email;
                hasChanges = true;
              }
              
              if (u.bits_balance === undefined) {
                updates.bits_balance = 0;
                u.bits_balance = 0;
                hasChanges = true;
              }
              if (u.xp_points === undefined) {
                updates.xp_points = 0;
                u.xp_points = 0;
                hasChanges = true;
              }

              if (hasChanges) {
                updateDoc(userRef, updates);
              }
              this.currentUser.set(u);

              // Daily Reward Bonus Check (usando data local para coincidir com o fuso do admin)
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const todayStr = `${year}-${month}-${day}`;
              
              // Check/Assign event badges for today
              this.checkAndAssignEventBadges(u.id, todayStr);

              if (u.lastDailyRewardAt !== todayStr) {
                this.claimDailyReward(u.id, todayStr);
              }
            }
            this.isAuthLoading.set(false);
          },
          error: err => {
            console.error('Error fetching user profile:', err);
            this.isAuthLoading.set(false);
          }
        });

        // Sync user's gamification logs
        if (logsSubscription) logsSubscription.unsubscribe();
        const logsCol = collection(this.firestore, 'gamification_logs');
        const logsQuery = query(logsCol, where('userId', '==', fbUser.uid), orderBy('createdAt', 'desc'));
        logsSubscription = collectionData(logsQuery, { idField: 'id' }).subscribe(data => {
          if (data) {
            this.gamificationLogs.set(data as GamificationLog[]);
          }
        });
      } else {
        this.isAuthenticated.set(false);
        this.currentUser.set(null);
        this.gamificationLogs.set([]);
        if (userSubscription) {
          userSubscription.unsubscribe();
          userSubscription = null;
        }
        if (logsSubscription) {
          logsSubscription.unsubscribe();
          logsSubscription = null;
        }
        this.isAuthLoading.set(false);
      }
    });

    // 3. Sync Articles Collection (Ordered by creation date)
    const articlesCol = collection(this.firestore, 'articles');
    const articlesQuery = query(articlesCol, orderBy('createdAt', 'desc'));
    collectionData(articlesQuery, { idField: 'id' }).subscribe(data => {
      if (data) {
        this.articles.set(data as Article[]);
      }
      this.isArticlesLoading.set(false);
    });

    // 4. Sync Comments Collection
    collectionData(collection(this.firestore, 'comments'), { idField: 'id' }).subscribe(data => {
      if (data) {
        this.comments.set(data as Comment[]);
      }
    });

    // 5. Sync Follows Collection
    collectionData(collection(this.firestore, 'follows')).subscribe(data => {
      if (data) {
        this.follows.set(data as any[]);
      }
    });

    // 6. Sync Likes Collection
    collectionData(collection(this.firestore, 'likes')).subscribe(data => {
      if (data) {
        this.likes.set(data as any[]);
      }
    });

    // 7. Sync Blog Statuses Collection
    collectionData(collection(this.firestore, 'blog_statuses'), { idField: 'id' }).subscribe(data => {
      if (data) {
        this.blogStatuses.set(data as BlogStatus[]);
      }
    });

    // 8. Sync Article Notes Collection
    const notesQuery = query(collection(this.firestore, 'article_notes'), orderBy('createdAt', 'asc'));
    collectionData(notesQuery, { idField: 'id' }).subscribe(data => {
      if (data) {
        this.articleNotes.set(data as ArticleNote[]);
      }
    });

    // 9. Sync Article Versions Collection
    const versionsQuery = query(collection(this.firestore, 'article_versions'), orderBy('savedAt', 'desc'));
    collectionData(versionsQuery, { idField: 'id' }).subscribe(data => {
      if (data) {
        this.articleVersions.set(data as ArticleVersion[]);
      }
    });

    // 10. Sync Spotlight Feed Configuration
    const spotlightRef = doc(this.firestore, 'configuracoes/feed_spotlight');
    docData(spotlightRef).subscribe(data => {
      if (data) {
        const spotlight = data as ConfiguracaoHolofote;
        this.holofoteAtivo.set(spotlight);
        this.checkLazyConsolidation(spotlight);
      } else {
        setDoc(spotlightRef, {
          id: 'feed_spotlight',
          postDestaqueId: '',
          autorUsername: '',
          maiorLanceVencedor: 0,
          dataDestaque: new Date().toISOString().split('T')[0]
        });
      }
    });

    // 11. Sync Current Day's Auction Document
    const todayStr = new Date().toISOString().split('T')[0];
    const leilaoRef = doc(this.firestore, `leilao_holofote/${todayStr}`);
    docData(leilaoRef).subscribe(data => {
      if (data) {
        this.leilaoDiaAtual.set(data as LeilaoDia);
      } else {
        setDoc(leilaoRef, {
          id: todayStr,
          maiorLanceAtual: 0,
          usuarioLiderId: '',
          usuarioLiderDisplayName: '',
          postLiderId: '',
          postLiderTitle: '',
          finalizado: false,
          historicoLances: []
        });
      }
    });

    // 12. Sync Badges Collection
    collectionData(collection(this.firestore, 'badges'), { idField: 'id' }).subscribe(data => {
      if (data) {
        this.badges.set(data as Badge[]);
      }
    });
  }

  // --- AUTH SERVICE DELEGATES ---

  async loginWithGoogle(): Promise<boolean> {
    return this.authService.loginWithGoogle((u) => this.currentUser.set(u));
  }

  async signUpWithEmail(email: string, pass: string, displayName: string, username: string): Promise<boolean> {
    return this.authService.signUpWithEmail(email, pass, displayName, username, this.users(), (u) => this.currentUser.set(u));
  }

  async loginWithEmail(email: string, pass: string): Promise<boolean> {
    return this.authService.loginWithEmail(email, pass);
  }

  async logout() {
    await this.authService.logout();
  }

  // --- ARTICLE SERVICE DELEGATES ---

  async addArticle(
    title: string, 
    summary: string, 
    content: string, 
    coverUrl: string, 
    tags: string[], 
    targetBlogId?: string, 
    saveAsDraft: boolean = false, 
    section?: string,
    scheduledAt?: string | null,
    scheduledNewsletter?: boolean
  ) {
    const user = this.currentUser();
    if (!user) return null;
    return this.articleService.addArticle(
      user, title, summary, content, coverUrl, tags, targetBlogId, saveAsDraft, section, scheduledAt, scheduledNewsletter,
      (uId, xp, reason) => this.addXpToUser(uId, xp, reason)
    );
  }

  async updateArticle(id: string, data: Partial<Article>) {
    await this.articleService.updateArticle(id, data, (uId, xp, reason) => this.addXpToUser(uId, xp, reason));
  }

  async saveArticleVersion(article: Article) {
    const user = this.currentUser();
    if (!user) return;
    await this.articleService.saveArticleVersion(article, user);
  }

  async addArticleNote(articleId: string, content: string) {
    const user = this.currentUser();
    if (!user) return;
    await this.articleService.addArticleNote(articleId, content, user);
  }

  async deleteArticle(id: string) {
    await this.articleService.deleteArticle(id, this.comments(), this.likes());
  }

  async approveArticle(articleId: string) {
    await this.articleService.approveArticle(articleId);
  }

  async addComment(articleId: string, content: string, parentId?: string) {
    const user = this.currentUser();
    if (!user) return null;
    return this.articleService.addComment(
      articleId, content, user, this.articles(),
      (uId, xp, reason) => this.addXpToUser(uId, xp, reason),
      parentId
    );
  }

  async toggleLike(articleId: string) {
    const user = this.currentUser();
    if (!user) return;
    await this.articleService.toggleLike(articleId, user, this.likes(), this.articles());
  }

  isLiked(articleId: string): boolean {
    return this.articleService.isLiked(articleId, this.currentUser(), this.likes());
  }

  async stumbleUpon() {
    await this.articleService.stumbleUpon(this.currentUser(), this.articles());
  }

  // --- USER SERVICE DELEGATES ---

  async toggleFollow(followedId: string) {
    const user = this.currentUser();
    if (!user) return;
    await this.userService.toggleFollow(followedId, user, this.follows());
  }

  isFollowing(followedId: string): boolean {
    return this.userService.isFollowing(followedId, this.currentUser(), this.follows());
  }

  async registerBlogView(userId: string) {
    await this.userService.registerBlogView(userId);
  }

  async updateBlogSettings(settings: BlogSettings) {
    const user = this.currentUser();
    if (!user) return;
    await this.userService.updateBlogSettings(settings, user, (newSettings) => {
      this.currentUser.update(curr => curr ? { ...curr, blogSettings: { ...newSettings } } : null);
    });
  }

  async updateProfile(displayName: string, bio: string, avatarUrl: string, username?: string): Promise<boolean | string> {
    const user = this.currentUser();
    if (!user) return false;
    return this.userService.updateProfile(
      displayName, bio, avatarUrl, username, user, this.users(), this.articles(), this.comments(),
      (dName, b, aUrl, uName) => {
        this.currentUser.update(curr => curr ? { ...curr, displayName: dName, bio: b, avatarUrl: aUrl, username: uName } : null);
      }
    );
  }

  async addCollaborator(usernameToAdd: string): Promise<boolean | string> {
    const user = this.currentUser();
    if (!user) return false;
    return this.userService.addCollaborator(usernameToAdd, user, this.users(), (newCollabs) => {
      this.currentUser.update(curr => curr ? { ...curr, collaborators: newCollabs } : null);
    });
  }

  async removeCollaborator(collaboratorId: string) {
    const user = this.currentUser();
    if (!user) return;
    await this.userService.removeCollaborator(collaboratorId, user, (newCollabs) => {
      this.currentUser.update(curr => curr ? { ...curr, collaborators: newCollabs } : null);
    });
  }

  async updateUserRole(userId: string, role: 'admin' | 'creator'): Promise<boolean> {
    return this.userService.updateUserRole(userId, role);
  }

  // --- GAMIFICATION SERVICE DELEGATES ---

  async handleUserRewardOrSpend(
    userId: string,
    amount: number,
    actionType: 'earn' | 'spend' | 'transfer',
    description: string
  ): Promise<boolean> {
    return this.gamificationService.handleUserRewardOrSpend(userId, amount, actionType, description, this.badges(), this.currentUser());
  }

  async runGamificationMigration(): Promise<void> {
    await this.gamificationService.runGamificationMigration(this.users(), this.badges());
  }

  async claimDailyReward(userId: string, todayStr: string): Promise<boolean> {
    if (this.isClaimingDailyReward) return false;
    this.isClaimingDailyReward = true;
    try {
      return await this.gamificationService.claimDailyReward(userId, todayStr, this.badges(), this.currentUser());
    } finally {
      this.isClaimingDailyReward = false;
    }
  }

  async applaudArticle(
    articleId: string,
    authorId: string,
    amount: number
  ): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;
    return this.gamificationService.applaudArticle(articleId, authorId, amount, user, this.gamificationLogs(), this.badges());
  }

  async grantBitsToUser(targetUserId: string, amount: number, description: string): Promise<boolean> {
    return this.gamificationService.grantBitsToUser(targetUserId, amount, description, this.badges(), this.currentUser());
  }

  async addXpToUser(userId: string, xpAmount: number, reason: string): Promise<boolean> {
    return this.gamificationService.addXpToUser(userId, xpAmount, reason, this.badges(), this.currentUser());
  }

  async unlockBadgesRetroactively(userId: string, badgesToUnlock: Badge[]): Promise<void> {
    await this.gamificationService.unlockBadgesRetroactively(userId, badgesToUnlock, this.currentUser());
  }

  async createBadge(
    name: string, 
    description: string, 
    xpRequirement: number, 
    iconUrl: string,
    type?: 'xp' | 'event' | 'special' | 'staff' | 'milestone' | 'custom',
    targetDate?: string,
    rewardBits?: number
  ): Promise<boolean> {
    return this.gamificationService.createBadge(name, description, xpRequirement, iconUrl, type, targetDate, rewardBits);
  }

  async assignBadgeToUser(userId: string, badgeId: string): Promise<boolean> {
    return this.gamificationService.assignBadgeToUser(userId, badgeId);
  }

  async removeBadgeFromUser(userId: string, badgeId: string): Promise<boolean> {
    return this.gamificationService.removeBadgeFromUser(userId, badgeId);
  }

  async deleteBadge(badgeId: string): Promise<boolean> {
    return this.gamificationService.deleteBadge(badgeId);
  }

  async checkAndAssignEventBadges(userId: string, todayStr: string): Promise<boolean> {
    if (this.isCheckingEventBadges) return false;
    this.isCheckingEventBadges = true;
    try {
      return await this.gamificationService.checkAndAssignEventBadges(userId, todayStr, this.badges(), this.currentUser());
    } finally {
      this.isCheckingEventBadges = false;
    }
  }

  async rewardPostReading(articleId: string, articleTitle: string): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;
    return this.gamificationService.rewardPostReading(
      articleId, articleTitle, user, this.articles(), this.gamificationLogs(), this.rewardedArticlesInMemory, this.badges()
    );
  }

  // --- AUCTION SERVICE DELEGATES ---

  private async checkLazyConsolidation(spotlight: ConfiguracaoHolofote) {
    await this.auctionService.checkLazyConsolidation(spotlight);
  }

  async placeBid(articleId: string, amount: number): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;
    return this.auctionService.placeBid(articleId, amount, user);
  }

  async consolidarLeilaoDia(dataOntem: string): Promise<boolean> {
    return this.auctionService.consolidarLeilaoDia(dataOntem);
  }

  // --- BLOG STATUS SERVICE DELEGATES ---

  async addBlogStatus(content: string, targetBlogId?: string) {
    const user = this.currentUser();
    if (!user) return null;
    return this.blogStatusService.addBlogStatus(content, user, targetBlogId);
  }

  async deleteBlogStatus(id: string) {
    await this.blogStatusService.deleteBlogStatus(id);
  }

  // --- NEWSLETTER SERVICE DELEGATES ---

  async sendNewsletter(articleId: string, blogId: string) {
    await this.newsletterService.sendNewsletter(articleId, blogId, this.follows(), this.users());
  }

  // --- CYBER-SHOP DELEGATES & HELPERS ---

  getUserById(id: string): User | undefined {
    return this.users().find(u => u.id === id);
  }

  getUserByUsername(username: string): User | undefined {
    return this.users().find(u => u.username?.toLowerCase() === username?.toLowerCase());
  }

  async createShopItem(
    name: string,
    description: string,
    cost: number,
    category: 'frame' | 'tag' | 'theme' | 'other',
    itemValue: string,
    imageUrl?: string
  ): Promise<boolean> {
    return this.gamificationService.createShopItem(name, description, cost, category, itemValue, imageUrl);
  }

  async deleteShopItem(itemId: string): Promise<boolean> {
    return this.gamificationService.deleteShopItem(itemId);
  }

  async buyShopItem(userId: string, itemId: string): Promise<boolean> {
    return this.gamificationService.buyShopItem(userId, itemId);
  }

  async updateActiveCosmetic(userId: string, category: 'frame' | 'tag' | 'theme', itemValue: string): Promise<boolean> {
    return this.gamificationService.updateActiveCosmetic(userId, category, itemValue);
  }

  getFrameClass(activeFrame: string | undefined): string {
    if (!activeFrame) return '';
    if (activeFrame.startsWith('{')) return 'custom-frame';
    return activeFrame;
  }

  getFrameStyle(activeFrame: string | undefined): Record<string, string> {
    if (!activeFrame) return {};
    if (!activeFrame.startsWith('{')) return {};
    try {
      const config = JSON.parse(activeFrame);
      const color1 = config.color1 || '#00f0ff';
      const color2 = config.color2 || '#ff007f';
      const glowColor = config.glowColor || '#00f0ff';
      const shape = config.shape || 'circle';
      const animType = config.animation || 'pulse';
      
      let animation = 'none';
      if (animType === 'pulse') animation = 'frame-pulse 2s infinite alternate';
      else if (animType === 'rotate') animation = 'matrix-rotate 4s linear infinite';
      else if (animType === 'glitch') animation = 'glitch-anim 0.3s steps(2) infinite';
      else if (animType === 'fire') animation = 'fire-flicker 1.5s ease-in-out infinite alternate';

      const frameRad = shape === 'circle' ? '50%' : '12px';
      const avatarRad = shape === 'circle' ? '50%' : '9px';

      return {
        '--frame-bg': `linear-gradient(45deg, ${color1}, ${color2})`,
        '--frame-radius': frameRad,
        '--avatar-radius': avatarRad,
        '--frame-glow': `0 0 12px ${glowColor}`,
        '--frame-animation': animation
      };
    } catch (e) {
      console.error('Error parsing custom activeFrame:', e);
      return {};
    }
  }

  getThemeClass(activeTheme: string | undefined): string {
    if (!activeTheme) return '';
    if (activeTheme.startsWith('{')) {
      try {
        const config = JSON.parse(activeTheme);
        let cls = 'theme-custom';
        if (config.effect === 'scanlines') cls += ' theme-custom-scanlines';
        if (config.effect === 'matrix') cls += ' theme-custom-matrix';
        if (config.fontFamily === 'mono') cls += ' theme-custom-mono';
        return cls;
      } catch (e) {
        return 'theme-custom';
      }
    }
    return activeTheme;
  }

  getThemeStyleVariables(activeTheme: string | undefined): Record<string, string> {
    if (!activeTheme) return {};
    if (!activeTheme.startsWith('{')) {
      if (activeTheme === 'theme-terminal') {
        return {
          'background-color': '#020202',
          'color': '#39ff14',
          'border': '1.5px solid #39ff14'
        };
      }
      if (activeTheme === 'theme-matrix') {
        return {
          'background-color': '#000000',
          'color': '#39ff14',
          'border': '1.5px solid rgba(57, 255, 20, 0.25)'
        };
      }
      return {};
    }
    try {
      const config = JSON.parse(activeTheme);
      return {
        'background-color': config.bgColor || '#121420',
        'color': config.primaryColor || '#00f0ff',
        'border': `1.5px solid ${config.primaryColor || '#00f0ff'}`,
        '--accent-green': config.primaryColor || '#39ff14',
        '--blog-primary': config.primaryColor || '#39ff14',
        '--blog-bg': config.bgColor || '#121420',
        '--blog-card-bg': config.cardBgColor || 'rgba(255,255,255,0.02)',
        '--blog-text': config.textColor || '#fff'
      };
    } catch (e) {
      return {};
    }
  }

  getThemeSymbol(activeTheme: string | undefined): string {
    if (!activeTheme) return '🎨';
    if (!activeTheme.startsWith('{')) {
      if (activeTheme === 'theme-terminal') return '>_';
      if (activeTheme === 'theme-matrix') return '10';
      return '🎨';
    }
    try {
      const config = JSON.parse(activeTheme);
      if (config.effect === 'scanlines') return '>_';
      if (config.effect === 'matrix') return '10';
      return '🎨';
    } catch (e) {
      return '🎨';
    }
  }
}
