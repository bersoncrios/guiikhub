import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { User, Article, Comment, BlogSettings, BlogStatus, ArticleNote, ArticleVersion, GamificationLog, LeilaoDia, ConfiguracaoHolofote, Badge } from '../models/interfaces';
import { 
  Firestore, 
  collection, 
  collectionData, 
  doc, 
  docData, 
  getDoc,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy,
  runTransaction,
  where
} from '@angular/fire/firestore';
import { 
  Auth, 
  authState, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  UserCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class DbService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly rewardedArticlesInMemory = new Set<string>();

  // EmailJS Configuration
  private readonly emailjsServiceId = 'service_8dyxl0t';
  private readonly emailjsTemplateId = 'template_2tqtp6q';
  private readonly emailjsPublicKey = 'EWcK4w9n6ogMtV0XV';

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
        const eligibleButLocked = badgesList.filter(b => b.xpRequirement <= currentXp && !unlocked.includes(b.id));
        
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

    // 2. Sync Auth State
    let logsSubscription: any = null;
    authState(this.auth).subscribe(fbUser => {
      if (fbUser) {
        this.isAuthenticated.set(true);
        // Sync user doc from Firestore
        const userRef = doc(this.firestore, `users/${fbUser.uid}`);
        docData(userRef).subscribe({
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

              // Daily Reward Bonus Check
              const todayStr = new Date().toISOString().split('T')[0];
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

  // Google Login Auth
  async loginWithGoogle(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const provider = new GoogleAuthProvider();
    try {
      const result: UserCredential = await signInWithPopup(this.auth, provider);
      const fbUser = result.user;
      
      const userRef = doc(this.firestore, `users/${fbUser.uid}`);
      const docSnap = await getDoc(userRef);
      
      if (!docSnap.exists()) {
        // Perform profile creation if new user
        const defaultSettings: BlogSettings = {
          title: `${fbUser.displayName || 'Meu'}'s Space`,
          tagline: 'Toda paixão merece um espaço.',
          primaryColor: '#00f0ff',
          accentColor: '#ff007f',
          bgColor: '#08090d',
          cardBgColor: '#121420',
          textColor: '#f1f5f9',
          fontFamily: 'Space Grotesk',
          layoutType: 'grid',
          bannerUrl: '/images/cyberpunk_cover.png',
          sections: ['Geral', 'Tech', 'Quadrinhos']
        };
        
        const userProfile: User = {
          id: fbUser.uid,
          username: ((fbUser.displayName || 'user').replace(/[^a-zA-Z0-9]+/g, '') + fbUser.uid.substring(0, 4)).toLowerCase(),
          displayName: fbUser.displayName || 'Criador',
          avatarUrl: fbUser.photoURL || '/images/default-avatar.svg',
          bio: 'Novo criador no GuiikHub!',
          bannerUrl: '/images/cyberpunk_cover.png',
          blogSettings: defaultSettings,
          email: fbUser.email || undefined
        };

        await setDoc(userRef, userProfile);
        this.currentUser.set(userProfile);
      } else {
        const existingData = docSnap.data() as User;
        if (!existingData.email && fbUser.email) {
          await updateDoc(userRef, { email: fbUser.email });
          existingData.email = fbUser.email;
        }
        this.currentUser.set(existingData);
      }

      Swal.fire({
        icon: 'success',
        title: 'Conectado!',
        text: 'Você entrou com sucesso no GuiikHub!',
        timer: 1800,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error) {
      console.error('Google Sign In Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Falha na Conexão',
        text: 'Erro ao entrar com Google. Tente novamente.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  // Email Sign Up Auth
  async signUpWithEmail(email: string, pass: string, displayName: string, username: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]+/g, '');
      
      // Check if username is already taken in users collection
      const usernameExists = this.users().some(u => u.username === cleanUsername);
      if (usernameExists) {
        Swal.fire({
          icon: 'error',
          title: 'Nome de Usuário Indisponível',
          text: 'Este apelido (username) já está sendo usado por outro criador.',
          background: '#121420',
          color: '#f1f5f9',
          confirmButtonText: 'Tentar Outro',
          customClass: {
            popup: 'guiik-swal-popup',
            title: 'guiik-swal-title',
            htmlContainer: 'guiik-swal-html',
            confirmButton: 'guiik-swal-confirm-btn'
          },
          buttonsStyling: false
        });
        return false;
      }

      const result: UserCredential = await createUserWithEmailAndPassword(this.auth, email, pass);
      const fbUser = result.user;
      
      const userRef = doc(this.firestore, `users/${fbUser.uid}`);
      
      const defaultSettings: BlogSettings = {
        title: `${displayName}'s Space`,
        tagline: 'Toda paixão merece um espaço.',
        primaryColor: '#8a2be2',
        accentColor: '#00f0ff',
        bgColor: '#0d0e15',
        cardBgColor: '#151724',
        textColor: '#f1f5f9',
        fontFamily: 'Outfit',
        layoutType: 'grid',
        bannerUrl: '/images/cyberpunk_cover.png',
        sections: ['Geral', 'Tech', 'Quadrinhos']
      };
      
      const userProfile: User = {
        id: fbUser.uid,
        username: cleanUsername,
        displayName: displayName,
        avatarUrl: '/images/default-avatar.svg', // Neutral placeholder avatar SVG
        bio: 'Novo criador no GuiikHub!',
        bannerUrl: '/images/cyberpunk_cover.png',
        blogSettings: defaultSettings,
        email: email
      };

      await setDoc(userRef, userProfile);
      this.currentUser.set(userProfile);
      
      Swal.fire({
        icon: 'success',
        title: 'Criado com Sucesso!',
        text: 'Sua conta GuiikHub foi criada e seu blog está pronto!',
        timer: 2000,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error: any) {
      console.error('Email Sign Up Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erro no Cadastro',
        text: 'Não foi possível criar a conta: ' + (error.message || error),
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Voltar',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  // Email Login Auth
  async loginWithEmail(email: string, pass: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      await signInWithEmailAndPassword(this.auth, email, pass);
      Swal.fire({
        icon: 'success',
        title: 'Entrou com Sucesso!',
        text: 'Bem-vindo de volta ao GuiikHub!',
        timer: 1800,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error: any) {
      console.error('Email Login Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erro de Login',
        text: 'Não foi possível entrar: ' + (error.message || 'Verifique seus dados de acesso.'),
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Tentar Novamente',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async logout() {
    await signOut(this.auth);
    Swal.fire({
      icon: 'success',
      title: 'Sessão Encerrada',
      text: 'Desconectado com sucesso do GuiikHub!',
      timer: 1500,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html'
      }
    });
  }



  // Mutator Actions linked to Firestore
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

    const id = 'art_' + Date.now();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const isCollaboratorPost = targetBlogId && targetBlogId !== user.id;
    
    let status: 'published' | 'pending' | 'draft' = 'published';
    if (saveAsDraft) {
      status = 'draft';
    } else if (isCollaboratorPost) {
      status = 'pending';
    }

    const newArticle: Article = {
      id,
      title,
      slug,
      summary,
      content,
      coverUrl: coverUrl || '/images/cyberpunk_cover.png',
      authorId: user.id,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      authorAvatarUrl: user.avatarUrl,
      blogId: targetBlogId || user.id,
      status,
      createdAt: new Date().toISOString(),
      tags,
      likesCount: 0,
      commentsCount: 0,
      section: section || '',
      scheduledAt: scheduledAt || null,
      scheduledNewsletter: scheduledNewsletter || false
    };

    await setDoc(doc(this.firestore, `articles/${id}`), newArticle);
    if (status !== 'draft') {
      await this.addXpToUser(user.id, 50, `Escreveu a matéria "${title}"`);
    }
    return newArticle;
  }

  async updateArticle(id: string, data: Partial<Article>) {
    const artDocRef = doc(this.firestore, `articles/${id}`);
    const snap = await getDoc(artDocRef);
    const oldData = snap.exists() ? (snap.data() as Article) : null;
    
    await updateDoc(artDocRef, data);
    
    if (oldData && oldData.status === 'draft' && data.status && data.status !== 'draft') {
      await this.addXpToUser(oldData.authorId, 50, `Publicou a matéria "${data.title || oldData.title}"`);
    }
  }

  async saveArticleVersion(article: Article) {
    const user = this.currentUser();
    if (!user) return;
    const versionId = 'v_' + Date.now();
    const newVersion: ArticleVersion = {
      id: versionId,
      articleId: article.id,
      title: article.title,
      content: article.content,
      summary: article.summary,
      coverUrl: article.coverUrl,
      tags: article.tags || [],
      savedAt: new Date().toISOString(),
      savedByDisplayName: user.displayName
    };
    await setDoc(doc(this.firestore, `article_versions/${versionId}`), newVersion);
  }

  async addArticleNote(articleId: string, content: string) {
    const user = this.currentUser();
    if (!user) return;
    const noteId = 'n_' + Date.now();
    const newNote: ArticleNote = {
      id: noteId,
      articleId,
      authorId: user.id,
      authorDisplayName: user.displayName,
      authorAvatarUrl: user.avatarUrl,
      content,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(this.firestore, `article_notes/${noteId}`), newNote);
  }

  async deleteArticle(id: string) {
    await deleteDoc(doc(this.firestore, `articles/${id}`));
    
    const relatedComments = this.comments().filter(c => c.articleId === id);
    for (const c of relatedComments) {
      await deleteDoc(doc(this.firestore, `comments/${c.id}`));
    }

    const relatedLikes = this.likes().filter(l => l.articleId === id);
    for (const l of relatedLikes) {
      await deleteDoc(doc(this.firestore, `likes/${l.userId}_${l.articleId}`));
    }
  }

  async approveArticle(articleId: string) {
    await updateDoc(doc(this.firestore, `articles/${articleId}`), {
      status: 'published'
    });
  }

  async addComment(articleId: string, content: string) {
    const user = this.currentUser();
    if (!user) return null;

    const id = 'c_' + Date.now();
    const newComment: Comment = {
      id,
      articleId,
      authorId: user.id,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      authorAvatarUrl: user.avatarUrl,
      content,
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(this.firestore, `comments/${id}`), newComment);
    
    const art = this.articles().find(a => a.id === articleId);
    if (art) {
      await updateDoc(doc(this.firestore, `articles/${articleId}`), {
        commentsCount: art.commentsCount + 1
      });
      if (art.authorId !== user.id) {
        await this.addXpToUser(art.authorId, 10, `Recebeu comentário na matéria "${art.title}"`);
      }
    }

    return newComment;
  }

  async toggleLike(articleId: string) {
    const user = this.currentUser();
    if (!user) return;

    const likeId = `${user.id}_${articleId}`;
    const isLiked = this.likes().some(l => l.userId === user.id && l.articleId === articleId);
    const art = this.articles().find(a => a.id === articleId);
    if (!art) return;

    if (isLiked) {
      await deleteDoc(doc(this.firestore, `likes/${likeId}`));
      await updateDoc(doc(this.firestore, `articles/${articleId}`), {
        likesCount: Math.max(0, art.likesCount - 1)
      });
    } else {
      await setDoc(doc(this.firestore, `likes/${likeId}`), { userId: user.id, articleId });
      await updateDoc(doc(this.firestore, `articles/${articleId}`), {
        likesCount: art.likesCount + 1
      });
    }
  }

  isLiked(articleId: string): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return this.likes().some(l => l.userId === user.id && l.articleId === articleId);
  }

  async toggleFollow(followedId: string) {
    const user = this.currentUser();
    if (!user || user.id === followedId) return;

    const followId = `${user.id}_${followedId}`;
    const isFollowing = this.follows().some(f => f.followerId === user.id && f.followedId === followedId);

    if (isFollowing) {
      await deleteDoc(doc(this.firestore, `follows/${followId}`));
    } else {
      await setDoc(doc(this.firestore, `follows/${followId}`), { followerId: user.id, followedId });
    }
  }

  isFollowing(followedId: string): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return this.follows().some(f => f.followerId === user.id && f.followedId === followedId);
  }

  // Blog Views tracking by IP
  async registerBlogView(userId: string) {
    if (typeof window === 'undefined') return;
    try {
      // 1. Fetch IP
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      const ip = data.ip;
      if (!ip) return;

      // Clean IP to use as doc ID piece
      const safeIp = ip.replace(/\./g, '_').replace(/:/g, '_');
      const viewId = `${userId}_${safeIp}`;

      // 2. Check if this IP already viewed this blog
      const viewRef = doc(this.firestore, `blog_views/${viewId}`);
      const viewSnap = await getDoc(viewRef);

      if (!viewSnap.exists()) {
        // 3. Register the view
        await setDoc(viewRef, { userId, ip, timestamp: new Date().toISOString() });
        
        // 4. Increment the user's viewsCount
        const userRef = doc(this.firestore, `users/${userId}`);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data() as User;
          const newCount = (userData.viewsCount || 0) + 1;
          await updateDoc(userRef, { viewsCount: newCount });
        }
      }
    } catch (err) {
      console.warn('Failed to register blog view', err);
    }
  }

  async updateBlogSettings(settings: BlogSettings) {
    const user = this.currentUser();
    if (!user) return;

    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      blogSettings: { ...settings }
    });

    this.currentUser.update(curr => curr ? { ...curr, blogSettings: { ...settings } } : null);
  }

  async updateProfile(displayName: string, bio: string, avatarUrl: string, username?: string): Promise<boolean | string> {
    const user = this.currentUser();
    if (!user) return false;

    let cleanUsername = user.username;
    if (username) {
      cleanUsername = username.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!cleanUsername) {
        return 'username_invalid';
      }
      
      // Check if username is already taken by another user
      const isTaken = this.users().some(u => u.username === cleanUsername && u.id !== user.id);
      if (isTaken) {
        return 'username_taken';
      }
    }

    const usernameChanged = cleanUsername !== user.username;
    const nameChanged = displayName !== user.displayName;
    const avatarChanged = avatarUrl !== user.avatarUrl;

    // 1. Update user profile in Firestore
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      displayName,
      bio,
      avatarUrl,
      username: cleanUsername
    });

    // 2. Cascade updates to articles and comments if username, name, or avatar changed
    if (usernameChanged || nameChanged || avatarChanged) {
      const userArticles = this.articles().filter(art => art.authorId === user.id);
      for (const art of userArticles) {
        await updateDoc(doc(this.firestore, `articles/${art.id}`), {
          authorUsername: cleanUsername,
          authorDisplayName: displayName,
          authorAvatarUrl: avatarUrl
        });
      }

      const userComments = this.comments().filter(c => c.authorId === user.id);
      for (const c of userComments) {
        await updateDoc(doc(this.firestore, `comments/${c.id}`), {
          authorUsername: cleanUsername,
          authorDisplayName: displayName,
          authorAvatarUrl: avatarUrl
        });
      }
    }

    // 3. Update current user signal locally
    this.currentUser.update(curr => curr ? { ...curr, displayName, bio, avatarUrl, username: cleanUsername } : null);
    
    return true;
  }

  async addCollaborator(usernameToAdd: string): Promise<boolean | string> {
    const user = this.currentUser();
    if (!user) return false;

    const cleanUsername = usernameToAdd.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const userToAdd = this.users().find(u => u.username === cleanUsername);
    if (!userToAdd) return 'not_found';
    if (userToAdd.id === user.id) return 'self';

    const currentCollabs = user.collaborators || [];
    if (currentCollabs.includes(userToAdd.id)) return 'already_added';

    const newCollabs = [...currentCollabs, userToAdd.id];
    
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      collaborators: newCollabs
    });

    this.currentUser.update(curr => curr ? { ...curr, collaborators: newCollabs } : null);
    return true;
  }

  async removeCollaborator(collaboratorId: string) {
    const user = this.currentUser();
    if (!user) return;

    const currentCollabs = user.collaborators || [];
    const newCollabs = currentCollabs.filter(id => id !== collaboratorId);
    
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      collaborators: newCollabs
    });

    this.currentUser.update(curr => curr ? { ...curr, collaborators: newCollabs } : null);
  }

  // Temporary Statuses (Stories)
  async addBlogStatus(content: string, targetBlogId?: string) {
    const user = this.currentUser();
    if (!user) return null;

    const id = 'status_' + Date.now();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const newStatus: BlogStatus = {
      id,
      authorId: user.id,
      blogId: targetBlogId || user.id,
      content,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await setDoc(doc(this.firestore, `blog_statuses/${id}`), newStatus);
    return newStatus;
  }

  async deleteBlogStatus(id: string) {
    await deleteDoc(doc(this.firestore, `blog_statuses/${id}`));
  }

  async sendNewsletter(articleId: string, blogId: string) {
    const artSnap = await getDoc(doc(this.firestore, `articles/${articleId}`));
    if (!artSnap.exists()) return;
    const art = artSnap.data() as Article;

    const followers = this.follows()
      .filter(f => f.followedId === blogId)
      .map(f => f.followerId);

    const recipientUsers = this.users().filter(u => followers.includes(u.id));
    const blogOwner = this.users().find(u => u.id === blogId);
    const blogTitle = blogOwner?.blogSettings?.title || blogOwner?.displayName || 'Blog';

    Swal.fire({
      title: 'Disparando Newsletter...',
      text: `Enviando e-mails para ${recipientUsers.length} seguidores via EmailJS...`,
      allowOutsideClick: false,
      background: '#121420',
      color: '#f1f5f9',
      didOpen: () => {
        Swal.showLoading();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    let sentCount = 0;
    for (const recUser of recipientUsers) {
      if (recUser.email) {
        const emailHtml = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0e15; color: #f1f5f9; padding: 2rem; border-radius: 16px; border: 1px solid #1f2937;">
            <div style="text-align: center; margin-bottom: 2rem; border-bottom: 1px solid #1f2937; padding-bottom: 1.5rem;">
              <h1 style="color: #00f0ff; margin: 0; font-size: 1.8rem; letter-spacing: 1px;">${blogTitle}</h1>
              <p style="color: #94a3b8; margin: 0.5rem 0 0; font-size: 0.9rem;">Newsletter do GuiikHub</p>
            </div>
            
            <div style="margin-bottom: 2rem;">
              <img src="${art.coverUrl}" alt="Capa" style="width: 100%; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid #374151;">
              <h2 style="color: #ffffff; font-size: 1.5rem; line-height: 1.3; margin: 0 0 1rem 0;">${art.title}</h2>
              <p style="color: #cbd5e1; font-size: 1rem; line-height: 1.6; margin: 0 0 1.5rem 0;">${art.summary}</p>
              
              <div style="text-align: center; margin: 2rem 0;">
                <a href="https://guiikhub.com/b/${art.authorUsername}/post/${art.slug}" style="background-color: #00f0ff; color: #0d0e15; padding: 0.8rem 2rem; border-radius: 9999px; text-decoration: none; font-weight: bold; font-size: 1rem; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); display: inline-block;">
                  ⚡ Ler Matéria Completa
                </a>
              </div>
            </div>
            
            <div style="border-top: 1px solid #1f2937; padding-top: 1.5rem; text-align: center; font-size: 0.8rem; color: #6b7280; display: flex; align-items: center; justify-content: center; gap: 0.75rem;">
              <img src="${art.authorAvatarUrl}" alt="${art.authorDisplayName}" style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #00f0ff; object-fit: cover;">
              <div>
                Publicado por <strong>${art.authorDisplayName}</strong><br>
                Você está recebendo este e-mail porque segue o blog no GuiikHub.
              </div>
            </div>
          </div>
        `;

        try {
          const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              service_id: this.emailjsServiceId,
              template_id: this.emailjsTemplateId,
              user_id: this.emailjsPublicKey,
              template_params: {
                to_email: recUser.email,
                to_name: recUser.displayName || recUser.username,
                blog_title: blogTitle,
                article_title: art.title,
                article_summary: art.summary,
                article_link: `https://guiikhub.com/b/${art.authorUsername}/post/${art.slug}`,
                author_name: art.authorDisplayName,
                message_html: emailHtml
              }
            })
          });

          if (response.ok) {
            sentCount++;
          } else {
            console.error('EmailJS dispatch failed for user:', recUser.email, await response.text());
          }
        } catch (err) {
          console.error('Error calling EmailJS API for user:', recUser.email, err);
        }
      }
    }

    const sendId = 'ns_' + Date.now();
    const log = {
      id: sendId,
      articleId,
      blogId,
      sentAt: new Date().toISOString(),
      recipientsCount: sentCount,
      recipientUsernames: recipientUsers.filter(u => u.email).map(u => u.username)
    };

    await setDoc(doc(this.firestore, `newsletter_sends/${sendId}`), log);

    await updateDoc(doc(this.firestore, `articles/${articleId}`), {
      newsletterSent: true
    });

    Swal.close();

    Swal.fire({
      icon: 'success',
      title: 'Newsletter Disparada!',
      text: `Foram enviados ${sentCount} e-mails via EmailJS com sucesso para seus seguidores!`,
      background: '#121420',
      color: '#f1f5f9',
      confirmButtonText: 'Sensacional!',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html',
        confirmButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    });
  }

  async stumbleUpon() {
    const user = this.currentUser();
    const candidates = this.articles().filter(art => {
      const isPublished = (!art.status || art.status === 'published') &&
                          (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now());
      if (!isPublished) return false;
      if (user && art.authorId === user.id) return false;
      const engagementScore = (art.likesCount || 0) * 2 + (art.commentsCount || 0) * 3;
      const hasEngagement = engagementScore >= 2;
      const isNotEmpty = art.content && art.content.replace(/<[^>]*>/g, '').trim().length > 200;
      return hasEngagement || isNotEmpty;
    });

    let selectedArticle: Article | null = null;
    if (candidates.length > 0) {
      const randomIndex = Math.floor(Math.random() * candidates.length);
      selectedArticle = candidates[randomIndex];
    } else {
      const fallbackArticles = this.articles().filter(art => 
        (!art.status || art.status === 'published') &&
        (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now()) &&
        (!user || art.authorId !== user.id)
      );
      if (fallbackArticles.length > 0) {
        const randomIndex = Math.floor(Math.random() * fallbackArticles.length);
        selectedArticle = fallbackArticles[randomIndex];
      }
    }

    if (!selectedArticle) {
      Swal.fire({
        icon: 'info',
        title: 'Nenhuma matéria encontrada',
        text: 'Ainda não existem matérias publicadas no GuiikHub para descobrir!',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    Swal.fire({
      title: '⚡ SINTONIZANDO MATÉRIA...',
      html: `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem; margin-top: 1rem;">
          <div class="cyber-spinner" style="width: 50px; height: 50px; border: 3px solid rgba(0,240,255,0.1); border-top: 3px solid #00f0ff; border-radius: 50%; animation: spinStumble 0.8s linear infinite;"></div>
          <span style="font-size: 0.8rem; color: #94a3b8; font-family: 'Space Grotesk', sans-serif; letter-spacing: 1px;">EMBARCANDO EM CANAL ALEATÓRIO...</span>
        </div>
        <style>
          @keyframes spinStumble {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `,
      showConfirmButton: false,
      allowOutsideClick: false,
      background: '#0d0e15',
      color: '#00f0ff',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title'
      }
    });

    setTimeout(() => {
      Swal.close();
      this.router.navigate(['/b', selectedArticle!.authorUsername, 'post', selectedArticle!.slug]);
    }, 1000);
  }

  async handleUserRewardOrSpend(
    userId: string,
    amount: number,
    actionType: 'earn' | 'spend' | 'transfer',
    description: string
  ): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;

        let newBalance = currentBalance;
        let newXp = currentXp;

        if (actionType === 'earn') {
          newBalance += amount;
          newXp += amount; // Ganhar bits também concede XP
        } else if (actionType === 'spend') {
          if (currentBalance < amount) {
            throw new Error('Saldo insuficiente de bits');
          }
          newBalance -= amount;
        } else if (actionType === 'transfer') {
          // Se amount for negativo, é transferência de saída; se positivo, entrada.
          if (amount < 0) {
            const absAmount = Math.abs(amount);
            if (currentBalance < absAmount) {
              throw new Error('Saldo insuficiente para transferência');
            }
            newBalance -= absAmount;
          } else {
            newBalance += amount;
          }
        }

        // Atualizar documento do usuário
        transaction.update(userRef, {
          bits_balance: newBalance,
          xp_points: newXp
        });

        let unlockedBadgesText = '';
        if (newXp !== currentXp) {
          const badgeResult = this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef);
          unlockedBadgesText = badgeResult.unlockedBadgesText;
        }

        // Registrar log da ação
        const newLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: actionType,
          amount,
          description: description + (unlockedBadgesText ? `. Conquistas desbloqueadas: ${unlockedBadgesText}` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, newLog);
      });

      return true;
    } catch (err: any) {
      console.error('Erro na transação de gamificação:', err);
      Swal.fire({
        icon: 'error',
        title: 'Operação Neural Falhou',
        text: err.message || 'Erro ao processar transação de gamificação.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async runGamificationMigration(): Promise<void> {
    const userList = this.users();
    const badgesList = this.badges();
    for (const u of userList) {
      const currentXp = u.xp_points ?? 0;
      const currentBits = u.bits_balance ?? 0;
      const unlocked = u.unlockedBadges || [];
      const eligibleBadges = badgesList.filter(b => b.xpRequirement <= currentXp && !unlocked.includes(b.id));

      const updates: any = {};
      let needsUpdate = false;

      if (u.bits_balance === undefined || u.xp_points === undefined) {
        updates.bits_balance = currentBits;
        updates.xp_points = currentXp;
        needsUpdate = true;
      }

      if (eligibleBadges.length > 0) {
        const newUnlocked = [...unlocked, ...eligibleBadges.map(b => b.id)];
        updates.unlockedBadges = newUnlocked;
        needsUpdate = true;
      }

      if (needsUpdate) {
        const userRef = doc(this.firestore, `users/${u.id}`);
        await updateDoc(userRef, updates);
      }
    }
  }

  async claimDailyReward(userId: string, todayStr: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_daily';
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        if (userData.lastDailyRewardAt === todayStr) {
          return;
        }

        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;
        const newXp = currentXp + 10;
        
        transaction.update(userRef, {
          bits_balance: currentBalance + 10,
          xp_points: newXp,
          lastDailyRewardAt: todayStr
        });

        this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef);

        const rewardLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'earn',
          amount: 10,
          description: 'Recompensa de Login Diário GuiikHub',
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, rewardLog);
      });

      Swal.fire({
        icon: 'success',
        title: '⚡ BÔNUS DIÁRIO RECEBIDO!',
        html: `Você ganhou <b style="color: #ffd700;">+10 Bits</b> e <b style="color: #00f0ff;">+10 XP</b> por entrar hoje no GuiikHub!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
        customClass: {
          popup: 'guiik-swal-toast-popup'
        }
      });
      return true;
    } catch (err) {
      console.error('Erro ao conceder bônus diário:', err);
      return false;
    }
  }

  async applaudArticle(
    articleId: string,
    authorId: string,
    amount: number
  ): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;

    if (user.id === authorId) {
      Swal.fire({
        icon: 'warning',
        title: 'Auto-Aplauso Bloqueado',
        text: 'Você não pode gastar Bits aplaudindo seu próprio artigo!',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }

    try {
      const readerRef = doc(this.firestore, `users/${user.id}`);
      const authorRef = doc(this.firestore, `users/${authorId}`);
      const articleRef = doc(this.firestore, `articles/${articleId}`);
      
      const logIdReader = 'glog_' + Date.now() + '_clap_spend';
      const logIdAuthor = 'glog_' + Date.now() + '_clap_earn';
      
      const logReaderRef = doc(this.firestore, `gamification_logs/${logIdReader}`);
      const logAuthorRef = doc(this.firestore, `gamification_logs/${logIdAuthor}`);

      await runTransaction(this.firestore, async (transaction) => {
        const readerDoc = await transaction.get(readerRef);
        const authorDoc = await transaction.get(authorRef);
        const articleDoc = await transaction.get(articleRef);

        if (!readerDoc.exists() || !authorDoc.exists() || !articleDoc.exists()) {
          throw new Error('Leitor, autor ou artigo não encontrado');
        }

        const readerData = readerDoc.data() as User;
        const authorData = authorDoc.data() as User;
        const articleData = articleDoc.data() as Article;

        const readerBalance = readerData.bits_balance || 0;
        if (readerBalance < amount) {
          throw new Error('Saldo de Bits insuficiente');
        }

        // Validate 5 claps maximum limit
        const clapsGiven = this.gamificationLogs()
          .filter(log => log.typeAction === 'spend' && log.description === `Aplaudiu o artigo "${articleData.title}"`)
          .reduce((sum, log) => sum + log.amount, 0);

        if (clapsGiven + amount > 5) {
          throw new Error('Limite de 5 aplausos por artigo excedido');
        }

        // Deduct from reader
        transaction.update(readerRef, {
          bits_balance: readerBalance - amount
        });

        // Add to author (Bits + XP)
        const authorBalance = authorData.bits_balance || 0;
        const authorXp = authorData.xp_points || 0;
        const newXp = authorXp + amount;
        transaction.update(authorRef, {
          bits_balance: authorBalance + amount,
          xp_points: newXp
        });

        this.checkAndUnlockBadgesInTransaction(authorData, newXp, transaction, authorRef);

        // Increment applauseCount in article
        const currentClaps = articleData.applauseCount || 0;
        transaction.update(articleRef, {
          applauseCount: currentClaps + amount
        });

        // Logs
        const readerLog: GamificationLog = {
          id: logIdReader,
          userId: user.id,
          typeAction: 'spend',
          amount: amount,
          description: `Aplaudiu o artigo "${articleData.title}"`,
          createdAt: new Date().toISOString()
        };

        const authorLog: GamificationLog = {
          id: logIdAuthor,
          userId: authorId,
          typeAction: 'earn',
          amount: amount,
          description: `Recebeu aplausos no artigo "${articleData.title}"`,
          createdAt: new Date().toISOString()
        };

        transaction.set(logReaderRef, readerLog);
        transaction.set(logAuthorRef, authorLog);
      });

      return true;
    } catch (err: any) {
      console.error('Erro ao processar aplausos:', err);
      Swal.fire({
        icon: 'error',
        title: 'Falha ao Aplaudir',
        text: err.message || 'Erro transacional ao transferir Bits.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  private async checkLazyConsolidation(spotlight: ConfiguracaoHolofote) {
    if (typeof window === 'undefined') return;
    const todayStr = new Date().toISOString().split('T')[0];
    if (spotlight.dataDestaque < todayStr) {
      const yesterdayStr = spotlight.dataDestaque;
      console.log(`[Spotlight] Fechamento automático pendente detectado para: ${yesterdayStr}. Consolidando...`);
      await this.consolidarLeilaoDia(yesterdayStr);
    }
  }

  async placeBid(articleId: string, amount: number): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;

    const todayStr = new Date().toISOString().split('T')[0];
    const leilaoRef = doc(this.firestore, `leilao_holofote/${todayStr}`);
    const userRef = doc(this.firestore, `users/${user.id}`);
    const articleRef = doc(this.firestore, `articles/${articleId}`);

    try {
      await runTransaction(this.firestore, async (transaction) => {
        const leilaoDoc = await transaction.get(leilaoRef);
        const userDoc = await transaction.get(userRef);
        const articleDoc = await transaction.get(articleRef);

        if (!userDoc.exists() || !articleDoc.exists()) {
          throw new Error('Usuário ou artigo não encontrado');
        }

        const userData = userDoc.data() as User;
        const articleData = articleDoc.data() as Article;
        const leilaoData = leilaoDoc.exists() ? (leilaoDoc.data() as LeilaoDia) : {
          id: todayStr,
          maiorLanceAtual: 0,
          usuarioLiderId: '',
          usuarioLiderDisplayName: '',
          postLiderId: '',
          postLiderTitle: '',
          finalizado: false,
          historicoLances: []
        };

        if (leilaoData.finalizado) {
          throw new Error('O leilão de hoje já foi encerrado');
        }

        const currentHighest = leilaoData.maiorLanceAtual;
        const minRequired = currentHighest === 0 ? 10 : currentHighest + 10;
        if (amount < minRequired) {
          throw new Error(`O lance mínimo exigido é ${minRequired} Bits`);
        }

        let userBalance = userData.bits_balance || 0;
        const isAlreadyLeader = leilaoData.usuarioLiderId === user.id;
        
        if (isAlreadyLeader) {
          userBalance += leilaoData.maiorLanceAtual;
        }

        if (userBalance < amount) {
          throw new Error(`Saldo insuficiente de Bits. Você possui ${userBalance} Bits disponíveis.`);
        }

        if (leilaoData.usuarioLiderId && !isAlreadyLeader) {
          const prevLeaderRef = doc(this.firestore, `users/${leilaoData.usuarioLiderId}`);
          const prevLeaderSnap = await transaction.get(prevLeaderRef);
          if (prevLeaderSnap.exists()) {
            const prevLeaderData = prevLeaderSnap.data() as User;
            transaction.update(prevLeaderRef, {
              bits_balance: (prevLeaderData.bits_balance || 0) + leilaoData.maiorLanceAtual
            });
          }
        }

        transaction.update(userRef, {
          bits_balance: userBalance - amount
        });

        const newHistory = [
          ...leilaoData.historicoLances,
          {
            usuarioId: user.id,
            displayName: user.displayName,
            postId: articleId,
            amount: amount,
            timestamp: new Date().toISOString()
          }
        ];

        transaction.set(leilaoRef, {
          id: todayStr,
          maiorLanceAtual: amount,
          usuarioLiderId: user.id,
          usuarioLiderDisplayName: user.displayName,
          postLiderId: articleId,
          postLiderTitle: articleData.title,
          finalizado: false,
          historicoLances: newHistory
        });
      });

      Swal.fire({
        icon: 'success',
        title: '⚡ LANCE CONFIRMADO!',
        html: `Seu lance de <b style="color: #ffd700;">${amount} Bits</b> foi enviado com sucesso e você lidera o Holofote!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
      return true;
    } catch (err: any) {
      console.error('Erro ao enviar lance:', err);
      Swal.fire({
        icon: 'error',
        title: 'Lance Não Efetuado',
        text: err.message || 'Erro transacional ao registrar lance.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async consolidarLeilaoDia(dataOntem: string): Promise<boolean> {
    const leilaoRef = doc(this.firestore, `leilao_holofote/${dataOntem}`);
    const spotlightRef = doc(this.firestore, 'configuracoes/feed_spotlight');
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      await runTransaction(this.firestore, async (transaction) => {
        const leilaoSnap = await transaction.get(leilaoRef);

        if (!leilaoSnap.exists()) {
          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: '',
            autorUsername: '',
            maiorLanceVencedor: 0,
            dataDestaque: todayStr
          }, { merge: true });
          return;
        }

        const leilaoData = leilaoSnap.data() as LeilaoDia;
        if (leilaoData.finalizado) {
          return;
        }

        // Fetch winner user data BEFORE any transaction writes (reads must precede writes in Firestore transactions)
        let winnerUsername = '';
        if (leilaoData.usuarioLiderId) {
          const winnerRef = doc(this.firestore, `users/${leilaoData.usuarioLiderId}`);
          const winnerSnap = await transaction.get(winnerRef);
          const winnerData = winnerSnap.exists() ? (winnerSnap.data() as User) : null;
          winnerUsername = winnerData ? winnerData.username : '';
        }

        transaction.update(leilaoRef, { finalizado: true });

        if (leilaoData.usuarioLiderId) {
          const logId = 'glog_' + Date.now() + '_burn';
          const logRef = doc(this.firestore, `gamification_logs/${logId}`);
          const burnLog: GamificationLog = {
            id: logId,
            userId: leilaoData.usuarioLiderId,
            typeAction: 'spend',
            amount: leilaoData.maiorLanceAtual,
            description: `Queima de Bits: Venceu o Holofote para a matéria "${leilaoData.postLiderTitle}"`,
            createdAt: new Date().toISOString()
          };
          transaction.set(logRef, burnLog);

          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: leilaoData.postLiderId,
            autorUsername: winnerUsername,
            maiorLanceVencedor: leilaoData.maiorLanceAtual,
            dataDestaque: todayStr
          });
        } else {
          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: '',
            autorUsername: '',
            maiorLanceVencedor: 0,
            dataDestaque: todayStr
          });
        }
      });

      console.log(`[Spotlight] Leilão de ${dataOntem} consolidado com sucesso.`);
      return true;
    } catch (err) {
      console.error('Erro ao consolidar leilão:', err);
      return false;
    }
  }

  async grantBitsToUser(targetUserId: string, amount: number, description: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${targetUserId}`);
      const logId = 'glog_' + Date.now() + '_grant';
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;
        const newXp = Math.max(0, currentXp + (amount > 0 ? amount : 0));

        transaction.update(userRef, {
          bits_balance: Math.max(0, currentBalance + amount),
          xp_points: newXp
        });

        this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef);

        const grantLog: GamificationLog = {
          id: logId,
          userId: targetUserId,
          typeAction: amount >= 0 ? 'earn' : 'spend',
          amount: Math.abs(amount),
          description: description || 'Ajuste administrativo de saldo',
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, grantLog);
      });

      return true;
    } catch (err) {
      console.error('Erro ao conceder bits:', err);
      return false;
    }
  }

  async updateUserRole(userId: string, role: 'admin' | 'creator'): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      await updateDoc(userRef, { role });
      return true;
    } catch (err) {
      console.error('Erro ao atualizar cargo:', err);
      return false;
    }
  }

  async addXpToUser(userId: string, xpAmount: number, reason: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_xp_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentXp = userData.xp_points || 0;
        const newXp = currentXp + xpAmount;
        
        const badgeResult = this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef);
        const newUnlockedBadgesText = badgeResult.unlockedBadgesText;

        transaction.update(userRef, {
          xp_points: newXp
        });

        const xpLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'earn',
          amount: xpAmount,
          description: `Ganhou ${xpAmount} XP por: ${reason}` + (newUnlockedBadgesText ? `. Conquistas desbloqueadas: ${newUnlockedBadgesText}` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, xpLog);
      });

      return true;
    } catch (err) {
      console.error('Erro ao adicionar XP:', err);
      return false;
    }
  }

  private checkAndUnlockBadgesInTransaction(
    userData: User,
    newXp: number,
    transaction: any,
    userRef: any
  ): { unlockedBadgesText: string; newUnlocked: string[] } {
    const unlocked = userData.unlockedBadges || [];
    const newUnlocked = [...unlocked];
    const eligibleBadges = this.badges().filter(b => b.xpRequirement <= newXp && !unlocked.includes(b.id));
    
    let unlockedBadgesText = '';
    if (eligibleBadges.length > 0) {
      eligibleBadges.forEach(b => {
        if (!newUnlocked.includes(b.id)) {
          newUnlocked.push(b.id);
          if (unlockedBadgesText) unlockedBadgesText += ', ';
          unlockedBadgesText += b.name;
        }
      });
      transaction.update(userRef, {
        unlockedBadges: newUnlocked
      });
      
      // Celebrate badge unlocking!
      if (userData.id === this.currentUser()?.id) {
        setTimeout(() => {
          eligibleBadges.forEach(badge => {
            Swal.fire({
              title: '🏆 NOVO EMBLEMA DESBLOQUEADO!',
              text: `Parabéns! Você alcançou o marco de ${badge.xpRequirement} XP e ganhou o emblema: ${badge.name}!`,
              imageUrl: badge.iconUrl || '/images/default-badge.png',
              imageWidth: 100,
              imageHeight: 100,
              imageAlt: badge.name,
              background: '#121420',
              color: '#f1f5f9',
              confirmButtonText: 'Sensacional!',
              customClass: {
                popup: 'guiik-swal-popup',
                title: 'guiik-swal-title',
                confirmButton: 'guiik-swal-confirm-btn'
              },
              buttonsStyling: false
            });
          });
        }, 500);
      }
    }
    return { unlockedBadgesText, newUnlocked };
  }

  async unlockBadgesRetroactively(userId: string, badgesToUnlock: Badge[]): Promise<void> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_retro_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) return;

        const userData = userDoc.data() as User;
        const unlocked = userData.unlockedBadges || [];
        const newUnlocked = [...unlocked];
        
        let newUnlockedBadgesText = '';
        badgesToUnlock.forEach(b => {
          if (!newUnlocked.includes(b.id)) {
            newUnlocked.push(b.id);
            if (newUnlockedBadgesText) newUnlockedBadgesText += ', ';
            newUnlockedBadgesText += b.name;
          }
        });

        if (newUnlockedBadgesText) {
          transaction.update(userRef, {
            unlockedBadges: newUnlocked
          });

          const xpLog: GamificationLog = {
            id: logId,
            userId,
            typeAction: 'earn',
            amount: 0,
            description: `Desbloqueou conquistas retroativamente: ${newUnlockedBadgesText}`,
            createdAt: new Date().toISOString()
          };
          transaction.set(logRef, xpLog);
          
          // Celebrate!
          if (userId === this.currentUser()?.id) {
            setTimeout(() => {
              badgesToUnlock.forEach(badge => {
                Swal.fire({
                  title: '🏆 NOVO EMBLEMA DESBLOQUEADO!',
                  text: `Parabéns! Você alcançou o marco de ${badge.xpRequirement} XP e ganhou o emblema: ${badge.name}!`,
                  imageUrl: badge.iconUrl || '/images/default-badge.png',
                  imageWidth: 100,
                  imageHeight: 100,
                  imageAlt: badge.name,
                  background: '#121420',
                  color: '#f1f5f9',
                  confirmButtonText: 'Sensacional!',
                  customClass: {
                    popup: 'guiik-swal-popup',
                    title: 'guiik-swal-title',
                    confirmButton: 'guiik-swal-confirm-btn'
                  },
                  buttonsStyling: false
                });
              });
            }, 500);
          }
        }
      });
    } catch (err) {
      console.error('Erro ao desbloquear emblemas retroativamente:', err);
    }
  }

  async createBadge(name: string, description: string, xpRequirement: number, iconUrl: string): Promise<boolean> {
    try {
      const id = 'badge_' + Date.now();
      const newBadge: Badge = {
        id,
        name,
        description,
        xpRequirement,
        iconUrl: iconUrl || '/images/default-badge.png',
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(this.firestore, `badges/${id}`), newBadge);
      
      Swal.fire({
        icon: 'success',
        title: 'Emblema Criado!',
        text: `O emblema "${name}" foi cadastrado no sistema com sucesso.`,
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao criar emblema:', err);
      Swal.fire('Erro', 'Não foi possível cadastrar o emblema.', 'error');
      return false;
    }
  }

  async deleteBadge(badgeId: string): Promise<boolean> {
    try {
      await deleteDoc(doc(this.firestore, `badges/${badgeId}`));
      Swal.fire({
        icon: 'success',
        title: 'Emblema Excluído',
        text: 'O emblema foi removido do sistema.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao excluir emblema:', err);
      Swal.fire('Erro', 'Não foi possível excluir o emblema.', 'error');
      return false;
    }
  }

  async rewardPostReading(articleId: string, articleTitle: string): Promise<boolean> {
    const user = this.currentUser();
    if (!user) return false;

    // Prevent user from earning XP by reading their own articles
    const art = this.articles().find(a => a.id === articleId);
    if (art && art.authorId === user.id) {
      return false;
    }

    // Check memory cache first to prevent rapid concurrent scrolls on same page
    if (this.rewardedArticlesInMemory.has(articleId)) {
      return false;
    }

    // Check if user has already read this article using synced logs
    const alreadyRewarded = this.gamificationLogs().some(
      log => log.typeAction === 'earn' && log.description.includes(`Leitura completa do artigo: ${articleId}`)
    );

    if (alreadyRewarded) {
      this.rewardedArticlesInMemory.add(articleId);
      return false;
    }

    this.rewardedArticlesInMemory.add(articleId);
    const success = await this.addXpToUser(user.id, 5, `Leitura completa do artigo: ${articleId}`);
    if (success) {
      Swal.fire({
        icon: 'success',
        title: '⚡ CONHECIMENTO ADQUIRIDO!',
        html: `Você ganhou <b style="color: #ff007f;">+5 XP</b> por concluir a leitura de: <b>"${articleTitle}"</b>!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'bottom-end'
      });
      return true;
    } else {
      this.rewardedArticlesInMemory.delete(articleId);
    }
    return false;
  }
}
