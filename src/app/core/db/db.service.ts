import { Injectable, signal, computed, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, Article, Comment, BlogSettings, BlogStatus, ArticleNote, ArticleVersion } from '../models/interfaces';
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
  orderBy 
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
    authState(this.auth).subscribe(fbUser => {
      if (fbUser) {
        this.isAuthenticated.set(true);
        // Sync user doc from Firestore
        const userRef = doc(this.firestore, `users/${fbUser.uid}`);
        docData(userRef).subscribe({
          next: userData => {
            if (userData) {
              const u = userData as User;
              if (!u.email && fbUser.email) {
                updateDoc(userRef, { email: fbUser.email });
                u.email = fbUser.email;
              }
              this.currentUser.set(u);
            }
            this.isAuthLoading.set(false);
          },
          error: err => {
            console.error('Error fetching user profile:', err);
            this.isAuthLoading.set(false);
          }
        });
      } else {
        this.isAuthenticated.set(false);
        this.currentUser.set(null);
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
  async addArticle(title: string, summary: string, content: string, coverUrl: string, tags: string[], targetBlogId?: string, saveAsDraft: boolean = false, section?: string) {
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
      section: section || ''
    };

    await setDoc(doc(this.firestore, `articles/${id}`), newArticle);
    return newArticle;
  }

  async updateArticle(id: string, data: Partial<Article>) {
    await updateDoc(doc(this.firestore, `articles/${id}`), data);
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
}
