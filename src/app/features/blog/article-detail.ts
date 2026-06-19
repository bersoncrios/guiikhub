import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { DbService } from '../../core/db/db.service';

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.scss'
})
export class ArticleDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  public readonly db = inject(DbService);

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
    return this.db.articles().find(art => art.slug === slugStr) || null;
  });

  // Get comments for this article
  readonly articleComments = computed(() => {
    const art = this.article();
    if (!art) return [];
    return this.db.comments().filter(c => c.articleId === art.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  // Form Field
  newCommentText = '';

  // Build custom CSS variables map for the wrapper (matching parent blog theme!)
  readonly customStyleVariables = computed(() => {
    const user = this.blogUser();
    if (!user) return {};
    const s = user.blogSettings;

    let fontStr = 'var(--font-sans)';
    if (s.fontFamily === 'Space Grotesk') fontStr = 'var(--font-display)';
    else if (s.fontFamily === 'Fira Code') fontStr = 'var(--font-mono)';

    return {
      '--blog-bg': s.bgColor,
      '--blog-card-bg': s.cardBgColor,
      '--blog-border': 'rgba(255, 255, 255, 0.08)',
      '--blog-primary': s.primaryColor,
      '--blog-accent': s.accentColor,
      '--blog-text': s.textColor,
      '--blog-text-muted': '#94a3b8',
      '--blog-font-family': fontStr,
      '--blog-glow': `0 0 20px ${s.accentColor}40`
    } as Record<string, string>;
  });

  private viewRegisteredForUserId = '';

  constructor() {
    effect(() => {
      const art = this.article();
      const user = this.blogUser();
      
      if (user && this.viewRegisteredForUserId !== user.id) {
        this.db.registerBlogView(user.id);
        this.viewRegisteredForUserId = user.id;
      }

      if (art) {
        const blogTitle = user?.blogSettings.title || art.authorDisplayName;
        const fullTitle = `${art.title} — ${blogTitle}`;
        
        this.titleService.setTitle(fullTitle);
        
        this.metaService.updateTag({ property: 'og:title', content: fullTitle });
        this.metaService.updateTag({ property: 'og:description', content: art.summary });
        this.metaService.updateTag({ property: 'og:image', content: art.coverUrl || 'https://guiikhub.vercel.app/images/cyberpunk_cover.png' });
        this.metaService.updateTag({ property: 'og:type', content: 'article' });
        
        this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
        this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
        this.metaService.updateTag({ name: 'twitter:description', content: art.summary });
        this.metaService.updateTag({ name: 'twitter:image', content: art.coverUrl || 'https://guiikhub.vercel.app/images/cyberpunk_cover.png' });
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

  formatContent(content: string): string {
    if (!content) return '';
    return content
      .replace(/### (.*)/g, '<h3>$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\* ([^*]+)/g, '<li>$1</li>')
      .replace(/- ([^-]+)/g, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  }
}
