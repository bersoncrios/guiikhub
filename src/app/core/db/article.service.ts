import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { User, Article, Comment, ArticleNote, ArticleVersion } from '../models/interfaces';
import { Firestore, doc, getDoc, setDoc, updateDoc, deleteDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class ArticleService {
  private readonly firestore = inject(Firestore);
  private readonly router = inject(Router);

  async addArticle(
    user: User,
    title: string, 
    summary: string, 
    content: string, 
    coverUrl: string, 
    tags: string[], 
    targetBlogId?: string, 
    saveAsDraft: boolean = false, 
    section?: string,
    scheduledAt?: string | null,
    scheduledNewsletter?: boolean,
    addXpFn?: (userId: string, xpAmount: number, reason: string) => Promise<boolean>
  ): Promise<Article | null> {
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
    if (status !== 'draft' && addXpFn) {
      await addXpFn(user.id, 50, `Escreveu a matéria "${title}"`);
    }
    return newArticle;
  }

  async updateArticle(
    id: string, 
    data: Partial<Article>,
    addXpFn?: (userId: string, xpAmount: number, reason: string) => Promise<boolean>
  ) {
    const artDocRef = doc(this.firestore, `articles/${id}`);
    const snap = await getDoc(artDocRef);
    const oldData = snap.exists() ? (snap.data() as Article) : null;
    
    await updateDoc(artDocRef, data);
    
    if (oldData && oldData.status === 'draft' && data.status && data.status !== 'draft' && addXpFn) {
      await addXpFn(oldData.authorId, 50, `Publicou a matéria "${data.title || oldData.title}"`);
    }
  }

  async saveArticleVersion(article: Article, user: User) {
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

  async addArticleNote(articleId: string, content: string, user: User) {
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

  async deleteArticle(id: string, comments: Comment[], likes: Array<{ userId: string; articleId: string }>) {
    await deleteDoc(doc(this.firestore, `articles/${id}`));
    
    const relatedComments = comments.filter(c => c.articleId === id);
    for (const c of relatedComments) {
      await deleteDoc(doc(this.firestore, `comments/${c.id}`));
    }

    const relatedLikes = likes.filter(l => l.articleId === id);
    for (const l of relatedLikes) {
      await deleteDoc(doc(this.firestore, `likes/${l.userId}_${l.articleId}`));
    }
  }

  async approveArticle(articleId: string) {
    await updateDoc(doc(this.firestore, `articles/${articleId}`), {
      status: 'published'
    });
  }

  async addComment(
    articleId: string, 
    content: string, 
    user: User, 
    articlesList: Article[],
    addXpFn?: (userId: string, xpAmount: number, reason: string) => Promise<boolean>
  ): Promise<Comment | null> {
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
    
    const art = articlesList.find(a => a.id === articleId);
    if (art) {
      await updateDoc(doc(this.firestore, `articles/${articleId}`), {
        commentsCount: art.commentsCount + 1
      });
      if (art.authorId !== user.id && addXpFn) {
        await addXpFn(art.authorId, 10, `Recebeu comentário na matéria "${art.title}"`);
      }
    }

    return newComment;
  }

  async toggleLike(
    articleId: string, 
    user: User, 
    likesList: Array<{ userId: string; articleId: string }>, 
    articlesList: Article[]
  ) {
    const likeId = `${user.id}_${articleId}`;
    const isLiked = likesList.some(l => l.userId === user.id && l.articleId === articleId);
    const art = articlesList.find(a => a.id === articleId);
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

  isLiked(articleId: string, user: User | null, likesList: Array<{ userId: string; articleId: string }>): boolean {
    if (!user) return false;
    return likesList.some(l => l.userId === user.id && l.articleId === articleId);
  }

  async stumbleUpon(user: User | null, articlesList: Article[]) {
    const candidates = articlesList.filter(art => {
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
      const fallbackArticles = articlesList.filter(art => 
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
}
