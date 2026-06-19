import { Injectable, signal, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, Article, Comment, BlogSettings } from '../models/interfaces';
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

  // Writable Signals for application state
  readonly users = signal<User[]>([]);
  readonly articles = signal<Article[]>([]);
  readonly comments = signal<Comment[]>([]);
  readonly follows = signal<Array<{ followerId: string; followedId: string }>>([]);
  readonly likes = signal<Array<{ userId: string; articleId: string }>>([]);

  readonly isUsersLoading = signal<boolean>(true);
  readonly isArticlesLoading = signal<boolean>(true);

  // Active / Logged-in user signal (real authenticated user)
  readonly currentUser = signal<User | null>(null);
  readonly isAuthenticated = signal<boolean>(false);
  readonly isAuthLoading = signal<boolean>(true);

  constructor() {
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
              this.currentUser.set(userData as User);
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
          bannerUrl: '/images/cyberpunk_cover.png'
        };
        
        const userProfile: User = {
          id: fbUser.uid,
          username: ((fbUser.displayName || 'user').replace(/[^a-zA-Z0-9]+/g, '') + fbUser.uid.substring(0, 4)).toLowerCase(),
          displayName: fbUser.displayName || 'Criador',
          avatarUrl: fbUser.photoURL || '/images/default-avatar.svg',
          bio: 'Novo criador no GuiikHub!',
          bannerUrl: '/images/cyberpunk_cover.png',
          blogSettings: defaultSettings
        };

        await setDoc(userRef, userProfile);
        this.currentUser.set(userProfile);
      } else {
        this.currentUser.set(docSnap.data() as User);
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
        bannerUrl: '/images/cyberpunk_cover.png'
      };
      
      const userProfile: User = {
        id: fbUser.uid,
        username: cleanUsername,
        displayName: displayName,
        avatarUrl: '/images/default-avatar.svg', // Neutral placeholder avatar SVG
        bio: 'Novo criador no GuiikHub!',
        bannerUrl: '/images/cyberpunk_cover.png',
        blogSettings: defaultSettings
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
  async addArticle(title: string, summary: string, content: string, coverUrl: string, tags: string[]) {
    const user = this.currentUser();
    if (!user) return null;

    const id = 'art_' + Date.now();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
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
      createdAt: new Date().toISOString(),
      tags,
      likesCount: 0,
      commentsCount: 0
    };

    await setDoc(doc(this.firestore, `articles/${id}`), newArticle);
    return newArticle;
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

}
