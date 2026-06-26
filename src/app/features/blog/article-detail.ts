import { Component, computed, inject, signal, effect, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { DbService } from '../../core/db/db.service';
import { Comment } from '../../core/models/comment';
import { SeoService } from '../../core/services/seo.service';
import { Subject, Subscription, debounceTime } from 'rxjs';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.scss'
})
export class ArticleDetailComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  public readonly db = inject(DbService);

  readonly scrollPercent = signal(0);
  readingRewardClaimed = false;

  // Claps / Gamification Local States
  readonly localClapsPending = signal<number>(0);
  readonly localClapIncrement = signal<number>(0);
  readonly showClapFloatingText = signal<boolean>(false);

  private readonly clapSubject = new Subject<number>();
  private clapSubscription?: Subscription;
  private animationTimeout: any;

  @HostListener('window:scroll')
  onWindowScroll() {
    if (typeof window === 'undefined') return;
    const docElement = document.documentElement;
    const docBody = document.body;
    const scrollTop = docElement.scrollTop || docBody.scrollTop;
    const scrollHeight = docElement.scrollHeight || docBody.scrollHeight;
    const clientHeight = docElement.clientHeight;
    const totalScroll = scrollHeight - clientHeight;
    if (totalScroll <= 0) {
      this.scrollPercent.set(0);
    } else {
      const percentage = (scrollTop / totalScroll) * 100;
      this.scrollPercent.set(percentage);
      
      if (percentage >= 99.5 && !this.readingRewardClaimed) {
        const art = this.article();
        const user = this.db.currentUser();
        if (art && this.db.isAuthenticated()) {
          this.readingRewardClaimed = true;
          if (user && art.authorId !== user.id) {
            this.db.rewardPostReading(art.id, art.title);
          }
        }
      }
    }
  }

  readonly estimatedReadingTime = computed(() => {
    const art = this.article();
    if (!art || !art.content) return 0;
    const text = art.content.replace(/<[^>]*>/g, ' ');
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    return Math.ceil(wordCount / 200);
  });

  // Convert route params to a Signal
  private readonly params = toSignal(this.route.params);

  // Extract author username and article slug
  readonly username = computed(() => {
    const p = this.params();
    return p ? p['username'] : this.route.snapshot.params['username'];
  });
  readonly postSlug = computed(() => {
    const p = this.params();
    return p ? p['slug'] : this.route.snapshot.params['slug'];
  });

  // Find blog owner
  readonly blogUser = computed(() => {
    const name = this.username().toLowerCase().trim();
    if (!name) return null;
    return this.db.users().find(u => u.username === name) || null;
  });

  // Find article
  readonly article = computed(() => {
    const slugStr = this.postSlug();
    if (!slugStr) return null;
    const art = this.db.articles().find(art => art.slug === slugStr) || null;
    if (!art) return null;
    
    const user = this.db.currentUser();
    const isAuthor = user && (art.authorId === user.id || (art.blogId || art.authorId) === user.id);

    if (art.status === 'pending' || art.status === 'draft') {
      if (!isAuthor) {
        return null; // Hide pending/draft article from public
      }
    }

    if (art.scheduledAt && new Date(art.scheduledAt).getTime() > Date.now()) {
      if (!isAuthor) {
        return null; // Hide scheduled article from public before release time
      }
    }
    return art;
  });

  // --- Paywall Logic ---
  readonly isPaywallLocked = computed(() => {
    const art = this.article();
    if (!art || !art.isPaywalled) return false;
    
    const user = this.db.currentUser();
    
    // Author or Sys-Admin always has access
    if (user && (art.authorId === user.id || user.role === 'admin')) return false;
    
    // Check if user purchased/unlocked it
    if (user && user.unlockedArticles?.includes(art.id)) return false;
    
    // Check if user has required VIP badge
    if (user && art.paywallRequiredBadgeId && user.unlockedBadges?.includes(art.paywallRequiredBadgeId)) return false;

    return true;
  });

  readonly renderedArticleContent = computed(() => {
    const art = this.article();
    if (!art) return '';
    
    if (!this.isPaywallLocked()) {
      return art.content;
    }

    // Article is locked, slice it based on preview percentage
    const htmlContent = art.content || '';
    const percentage = art.paywallPreviewPercentage || 40;
    
    // Simple slice for preview (Warning: can break HTML tags if cut in the middle, but works for PoC)
    // A better approach for real production is parsing the DOM tree, but we use a robust substring here.
    const sliceIndex = Math.floor(htmlContent.length * (percentage / 100));
    
    return htmlContent.substring(0, sliceIndex) + '... <div class="fade-out-overlay"></div>';
  });

  async purchaseArticle(isHackAttempt: boolean) {
    const art = this.article();
    const user = this.db.currentUser();
    
    if (!user) {
      Swal.fire({
        icon: 'info',
        title: 'Login Necessário',
        text: 'Você precisa estar logado para acessar o Terminal.',
        background: '#121420', color: '#f1f5f9'
      });
      return;
    }
    
    if (!art || !art.isPaywalled) return;
    
    const cost = isHackAttempt ? 2 : (art.paywallPrice || 0);
    const balance = user.bits_balance || 0;
    
    if (balance < cost) {
      Swal.fire({
        icon: 'error',
        title: 'Bits Insuficientes',
        text: `Você precisa de ${cost} Bits, mas possui apenas ${balance}.`,
        background: '#121420', color: '#f1f5f9'
      });
      return;
    }

    const actionText = isHackAttempt 
      ? 'Atenção: Você está apostando 2 Bits. Há apenas 35% de chance de sucesso. Continuar?' 
      : `Deseja transferir ${cost} Bits para descriptografar este arquivo?`;

    const confirm = await Swal.fire({
      title: isHackAttempt ? '👾 Iniciar Hack?' : '🔓 Autorizar Pagamento?',
      text: actionText,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Executar',
      cancelButtonText: 'Abortar',
      background: '#121420', color: '#f1f5f9'
    });

    if (confirm.isConfirmed) {
      const result = await this.db.unlockArticlePaywall(art.id, art.authorId, art.title, art.paywallPrice || 0, isHackAttempt);
      
      if (result.success) {
        Swal.fire({
          icon: 'success',
          title: 'Acesso Concedido',
          text: result.message,
          background: '#121420', color: '#4ade80'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Acesso Negado',
          text: result.message,
          background: '#121420', color: '#ef4444'
        });
      }
    }
  }

  async reportPaywallContent() {
    const art = this.article();
    if (!art) return;
    
    const { value: reason } = await Swal.fire({
      title: 'Acionar Garantia do Comprador',
      input: 'textarea',
      inputLabel: 'Qual o problema com esta matéria paga?',
      inputPlaceholder: 'Ex: Conteúdo falso, plágio, não entrega o que promete...',
      showCancelButton: true,
      confirmButtonText: 'Enviar Denúncia',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9'
    });

    if (reason) {
      const success = await this.db.submitReport(art.id, art.title, art.authorId, reason);
      if (success) {
        Swal.fire({
          icon: 'success',
          title: 'Denúncia Recebida',
          text: 'Nossos Sys-Admins analisarão o caso. Se a fraude for confirmada, seus Bits serão estornados e o criador perderá Reputação.',
          background: '#121420',
          color: '#4ade80'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Erro',
          text: 'Não foi possível enviar a denúncia. Tente novamente mais tarde.',
          background: '#121420',
          color: '#ef4444'
        });
      }
    }
  }


  // Get comments for this article
  readonly articleComments = computed(() => {
    const art = this.article();
    if (!art) return [];
    return this.db.comments().filter(c => c.articleId === art.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  readonly topLevelComments = computed(() => {
    return this.articleComments().filter(c => !c.parentId);
  });

  // Form Fields
  newCommentText = '';
  activeReplyCommentId: string | null = null;
  replyCommentText = '';

  // Build custom CSS variables map for the wrapper (matching parent blog theme!)
  readonly customStyleVariables = computed(() => {
    const user = this.blogUser();
    if (!user) return {};
    const s = user.blogSettings;

    let fontStr = 'var(--font-sans)';
    if (s.fontFamily === 'Space Grotesk') fontStr = 'var(--font-display)';
    else if (s.fontFamily === 'Fira Code') fontStr = 'var(--font-mono)';

    const vars: Record<string, string> = {
      '--blog-bg': s.bgColor,
      '--blog-card-bg': s.cardBgColor,
      '--blog-border': 'rgba(255, 255, 255, 0.08)',
      '--blog-primary': s.primaryColor,
      '--blog-accent': s.accentColor,
      '--blog-text': s.textColor,
      '--blog-text-muted': '#94a3b8',
      '--blog-font-family': fontStr,
      '--blog-glow': `0 0 20px ${s.accentColor}40`
    };

    // Overlay active shop theme settings if custom JSON config
    if (user.activeTheme && user.activeTheme.startsWith('{')) {
      try {
        const config = JSON.parse(user.activeTheme);
        if (config.primaryColor) vars['--blog-primary'] = config.primaryColor;
        if (config.bgColor) vars['--blog-bg'] = config.bgColor;
        if (config.cardBgColor) vars['--blog-card-bg'] = config.cardBgColor;
        if (config.textColor) vars['--blog-text'] = config.textColor;
        if (config.accentColor) vars['--blog-accent'] = config.accentColor;
        else if (config.primaryColor) vars['--blog-accent'] = config.primaryColor;
        
        if (config.primaryColor) {
          vars['--blog-glow'] = `0 0 20px ${config.primaryColor}50`;
        }
      } catch (e) {
        console.error('Error parsing custom activeTheme variables:', e);
      }
    }

    return vars;
  });

  private readonly seo = inject(SeoService);
  private viewRegisteredForUserId = '';

  constructor() {
    // Setup claps debouncing
    this.clapSubscription = this.clapSubject.pipe(
      debounceTime(1500)
    ).subscribe(async (accumulatedClaps) => {
      const art = this.article();
      if (art && accumulatedClaps > 0) {
        const success = await this.db.applaudArticle(art.id, art.authorId, accumulatedClaps);
        if (success) {
          this.localClapsPending.set(0);
        } else {
          this.localClapIncrement.update(v => Math.max(0, v - accumulatedClaps));
          this.localClapsPending.set(0);
        }
      }
    });

    effect(() => {
      this.postSlug();
      this.readingRewardClaimed = false;
    });

    effect(() => {
      const art = this.article();
      const user = this.blogUser();
      
      if (user && this.viewRegisteredForUserId !== user.id) {
        this.db.registerBlogView(user.id);
        this.viewRegisteredForUserId = user.id;
      }

      if (art) {
        const blogTitle = user?.blogSettings.title || art.authorDisplayName;
        
        this.seo.updateTags({
          title: `${art.title} — ${blogTitle}`,
          description: art.summary,
          image: art.coverUrl || 'https://guiikhub.com/images/logo-guiikhub.png',
          type: 'article',
          route: `/b/${user?.username}/post/${art.slug}`,
          tags: art.tags,
          author: art.authorDisplayName
        });
      }
    });
  }

  toggleLike() {
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    const art = this.article();
    if (art) {
      this.db.toggleLike(art.id);
    }
  }

  submitComment() {
    const art = this.article();
    if (!art || !this.newCommentText.trim()) return;

    this.db.addComment(art.id, this.newCommentText.trim());
    this.newCommentText = '';
  }

  getCommentReplies(commentId: string): Comment[] {
    const art = this.article();
    if (!art) return [];
    return this.db.comments()
      .filter(c => c.articleId === art.id && c.parentId === commentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  startReply(commentId: string) {
    this.activeReplyCommentId = commentId;
    this.replyCommentText = '';
  }

  cancelReply() {
    this.activeReplyCommentId = null;
    this.replyCommentText = '';
  }

  async submitReply(parentId: string) {
    const art = this.article();
    if (!art || !this.replyCommentText.trim()) return;

    await this.db.addComment(art.id, this.replyCommentText.trim(), parentId);
    this.cancelReply();
  }

  formatContent(content: string): string {
    if (!content) return '';
    return content
      .replace(/### (.*)/g, '<h3>$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\* ([^*]+)/g, '<li>$1</li>')
      .replace(/- ([^-]+)/g, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  }

  addClap() {
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    const art = this.article();
    const user = this.db.currentUser();
    if (!art || !user) return;

    if (user.id === art.authorId) {
      Swal.fire({
        icon: 'warning',
        title: 'Auto-Aplauso Bloqueado',
        text: 'Você não pode aplaudir seu próprio artigo!',
        toast: true,
        position: 'top-end',
        timer: 3000,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    // Calculate claps already given to this article from gamification logs
    const clapsGiven = this.db.gamificationLogs()
      .filter(log => log.typeAction === 'spend' && log.description === `Aplaudiu o artigo "${art.title}"`)
      .reduce((sum, log) => sum + log.amount, 0);

    const remainingAllowed = Math.max(0, 5 - clapsGiven);
    const currentBalance = user.bits_balance || 0;
    const allowedLimit = Math.min(remainingAllowed, currentBalance);
    const pending = this.localClapsPending();

    if (remainingAllowed === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Limite Máximo Atingido',
        text: 'Você já deu o limite máximo de 5 aplausos para este artigo!',
        toast: true,
        position: 'top-end',
        timer: 3000,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    if (pending >= allowedLimit) {
      if (allowedLimit === remainingAllowed) {
        Swal.fire({
          icon: 'warning',
          title: 'Limite Máximo Atingido',
          text: 'Você pode enviar no máximo 5 aplausos no total para este artigo!',
          toast: true,
          position: 'top-end',
          timer: 3000,
          showConfirmButton: false,
          background: '#121420',
          color: '#f1f5f9'
        });
      } else {
        Swal.fire({
          icon: 'warning',
          title: 'Saldo Insuficiente',
          text: `Você tem apenas ${currentBalance} Bits disponíveis para aplaudir!`,
          toast: true,
          position: 'top-end',
          timer: 3000,
          showConfirmButton: false,
          background: '#121420',
          color: '#f1f5f9'
        });
      }
      return;
    }

    this.localClapsPending.update(v => v + 1);
    this.localClapIncrement.update(v => v + 1);
    
    this.clapSubject.next(this.localClapsPending());
    this.showClapPopupAnimation();
  }

  showClapPopupAnimation() {
    this.showClapFloatingText.set(false);
    setTimeout(() => {
      this.showClapFloatingText.set(true);
      if (this.animationTimeout) clearTimeout(this.animationTimeout);
      this.animationTimeout = setTimeout(() => {
        this.showClapFloatingText.set(false);
      }, 800);
    }, 10);
  }

  ngOnDestroy() {
    if (this.clapSubscription) {
      this.clapSubscription.unsubscribe();
    }
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
    }
  }

  getUserBadges(user: any): any[] {
    if (!user || !user.unlockedBadges) return [];
    return this.db.badges().filter(b => user.unlockedBadges.includes(b.id));
  }

  getLinkedContract(articleId: string) {
    return this.db.pautaContracts().find(
      c => c.publishedArticleId === articleId && c.status === 'published'
    ) || null;
  }
}
